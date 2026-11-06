"""Identity consistency (Phase 3): alignment math, the real SFace model on public-domain portraits, and
the opt-in `identity` section of /v1/analyze."""

import itertools
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageEnhance

from conftest import FIXTURES, MANIFEST, MODEL_PATH, ROOT, TOKEN, FakeDetector, jpeg_bytes, load_fixture, make_settings
from proctor_ai.api import create_app
from proctor_ai.detectors.base import BoundingBox, FaceDetection, FaceDetectionResult, ModelInfo
from proctor_ai.detectors.blazeface import BlazeFaceDetector, ModelLoadError
from proctor_ai.detectors.sface import (
    ALIGN_TEMPLATE,
    EMBEDDING_DIM,
    REFERENCE_COSINE_THRESHOLD,
    SFaceEmbedder,
    align_face,
    cosine_similarity,
    similarity_transform,
)

ID_MANIFEST = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))["face_recognition_sface"]
ID_PATH = ROOT / "models" / ID_MANIFEST["file"]
AUTH = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "image/jpeg"}

# Two different official NASA portrait sessions per person (see fixtures/README.md).
SAME_PERSON = [
    ("face_sunita_williams.jpg", "face_sunita_williams_2018.jpg"),
    ("face_victor_glover.jpg", "face_victor_glover_2018.jpg"),
]
PEOPLE = {
    "sunita": ["face_sunita_williams.jpg", "face_sunita_williams_2018.jpg"],
    "glover": ["face_victor_glover.jpg", "face_victor_glover_2018.jpg"],
    "chari": ["face_raja_chari.jpg"],
}


# ----------------------------------------------------------------------------- alignment math
def test_similarity_transform_recovers_a_known_transform():
    angle, scale, t = np.deg2rad(17), 1.7, np.array([12.0, -5.0])
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    src = np.array([[0, 0], [10, 0], [5, 8], [5, 14]], dtype=float)
    dst = (scale * rot @ src.T).T + t
    m = similarity_transform(src, dst)
    assert np.allclose(m[:, :2], scale * rot, atol=1e-9) and np.allclose(m[:, 2], t, atol=1e-9)


def test_similarity_transform_never_reflects():
    src = np.array([[0, 0], [10, 0], [5, 8], [5, 14]], dtype=float)
    mirrored = src * np.array([-1, 1])
    assert np.linalg.det(similarity_transform(src, mirrored)[:, :2]) > 0


def test_similarity_transform_rejects_degenerate_points():
    with pytest.raises(ValueError):
        similarity_transform(np.ones((4, 2)), ALIGN_TEMPLATE)


def test_align_face_maps_keypoints_onto_the_template():
    """Paint dots at the keypoints of a synthetic tilted face; after alignment they land on the template."""
    h, w = 400, 300
    angle = np.deg2rad(-20)
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    pts = (2.2 * rot @ (ALIGN_TEMPLATE - 56).T).T + np.array([150, 210])
    img = np.zeros((h, w, 3), dtype=np.uint8)
    for x, y in pts:
        img[int(round(y)) - 2 : int(round(y)) + 3, int(round(x)) - 2 : int(round(x)) + 3] = 255
    face = FaceDetection(0.9, BoundingBox(0.2, 0.2, 0.6, 0.6), tuple((x / w, y / h) for x, y in pts) + ((0, 0), (0, 0)))
    crop = align_face(img, face)
    assert crop.shape == (112, 112, 3)
    for tx, ty in ALIGN_TEMPLATE:
        patch = crop[int(ty) - 2 : int(ty) + 3, int(tx) - 2 : int(tx) + 3]
        assert patch.max() > 100, (tx, ty)


def test_align_face_requires_keypoints(small_image):
    with pytest.raises(ValueError):
        align_face(small_image, FaceDetection(0.9, BoundingBox(0.1, 0.1, 0.5, 0.5)))


def test_cosine_similarity_handles_zero_vectors():
    assert cosine_similarity(np.zeros(3), np.ones(3)) == 0.0
    assert cosine_similarity(np.array([1.0, 0]), np.array([2.0, 0])) == pytest.approx(1.0)


# ----------------------------------------------------------------------------- real model
@pytest.fixture(scope="module")
def detector():
    return BlazeFaceDetector(MODEL_PATH, MANIFEST["sha256"], MANIFEST["version"])


@pytest.fixture(scope="module")
def embedder():
    return SFaceEmbedder(ID_PATH, ID_MANIFEST["sha256"], ID_MANIFEST["version"])


@pytest.fixture(scope="module")
def features(detector, embedder):
    out = {}
    for files in PEOPLE.values():
        for name in files:
            img = load_fixture(name)
            faces = detector.detect(img).faces
            assert len(faces) == 1, name
            out[name] = embedder.embed(img, faces[0]).vector
    return out


def test_feature_is_unit_length_and_128_d(features):
    for vec in features.values():
        assert vec.shape == (EMBEDDING_DIM,) and np.linalg.norm(vec) == pytest.approx(1.0, abs=1e-5)


@pytest.mark.parametrize("a,b", SAME_PERSON)
def test_same_person_in_different_photo_sessions_matches(features, a, b):
    # Measured 2026-10-27: 0.512 (Williams, ~10 years apart, different hair) and 0.717 (Glover).
    assert cosine_similarity(features[a], features[b]) > REFERENCE_COSINE_THRESHOLD + 0.1


def test_different_people_do_not_match(features):
    # Measured 2026-10-27: every cross-person pair is <= 0.225.
    names = {n: person for person, files in PEOPLE.items() for n in files}
    cross = [(a, b) for a, b in itertools.combinations(names, 2) if names[a] != names[b]]
    assert len(cross) == 8
    for a, b in cross:
        assert cosine_similarity(features[a], features[b]) < REFERENCE_COSINE_THRESHOLD - 0.1, (a, b)


@pytest.mark.parametrize(
    "transform",
    [
        lambda im: ImageEnhance.Brightness(im).enhance(0.5),
        lambda im: ImageEnhance.Brightness(im).enhance(1.4),
        lambda im: im.crop((60, 40, 600, 640)).resize((480, 533)),
        lambda im: im.rotate(8),
        lambda im: im.resize((320, im.height * 320 // im.width)),
    ],
    ids=["darker", "brighter", "shift-and-scale", "rotated", "half-resolution"],
)
def test_same_photo_under_webcam_like_changes_stays_a_strong_match(detector, embedder, features, transform):
    im = transform(Image.open(FIXTURES / "face_victor_glover.jpg").convert("RGB"))
    arr = np.asarray(im)
    faces = detector.detect(arr).faces
    assert len(faces) == 1
    assert cosine_similarity(features["face_victor_glover.jpg"], embedder.embed(arr, faces[0]).vector) > 0.85


def test_checksum_mismatch_and_missing_file_are_refused(tmp_path):
    with pytest.raises(ModelLoadError):
        SFaceEmbedder(tmp_path / "missing.onnx", ID_MANIFEST["sha256"], "x")
    bogus = tmp_path / "bogus.onnx"
    bogus.write_bytes(b"not a model")
    with pytest.raises(ModelLoadError, match="checksum"):
        SFaceEmbedder(bogus, ID_MANIFEST["sha256"], "x")


# ----------------------------------------------------------------------------- API contract
class OneFace(FakeDetector):
    def __init__(self, faces=1):
        super().__init__(faces)

    def detect(self, rgb):
        self.calls += 1
        kps = ((0.4, 0.4), (0.6, 0.4), (0.5, 0.5), (0.5, 0.6), (0.3, 0.45), (0.7, 0.45))
        return FaceDetectionResult(faces=[FaceDetection(0.9, BoundingBox(0.3, 0.3, 0.4, 0.4), kps)] * self.faces, inference_ms=1.0)


class FakeEmbedder:
    def __init__(self, error=None):
        self.error, self.calls = error, 0

    @property
    def info(self):
        return ModelInfo(name="fake-sface", version="0", sha256="2" * 64, score_threshold=0.363)

    def embed(self, rgb, face):
        self.calls += 1
        if self.error:
            raise self.error
        vec = np.zeros(EMBEDDING_DIM, dtype=np.float32)
        vec[0] = 1.0

        class R:
            vector = vec
            inference_ms = 4.0

        return R()


def client(faces=1, embedder=None, embedder_factory="default", **settings):
    factory = (lambda: embedder or FakeEmbedder()) if embedder_factory == "default" else embedder_factory
    return TestClient(create_app(make_settings(**settings), lambda: OneFace(faces), None, factory))


def test_identity_is_opt_in(small_image):
    emb = FakeEmbedder()
    body = client(embedder=emb).post("/v1/analyze", content=jpeg_bytes(small_image), headers=AUTH).json()
    assert body["identity"] == {"status": "DISABLED", "embedding": None, "inferenceMs": 0.0, "model": None}
    assert emb.calls == 0


def test_identity_feature_for_a_single_face(small_image):
    body = client().post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH).json()
    ident = body["identity"]
    assert ident["status"] == "OK" and len(ident["embedding"]) == EMBEDDING_DIM and ident["embedding"][0] == 1.0
    assert ident["model"]["name"] == "fake-sface"
    assert body["totalMs"] == pytest.approx(1.0 + 4.0)


@pytest.mark.parametrize("faces", [0, 2])
def test_no_feature_unless_exactly_one_face(small_image, faces):
    emb = FakeEmbedder()
    body = client(faces=faces, embedder=emb).post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH).json()
    assert body["identity"]["status"] == "NOT_ONE_FACE" and body["identity"]["embedding"] is None
    assert emb.calls == 0


def test_embedding_failure_keeps_the_rest_of_the_analysis(small_image):
    res = client(embedder=FakeEmbedder(error=RuntimeError("boom"))).post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["faces"]["count"] == 1 and body["identity"]["status"] == "FAILED" and body["identity"]["embedding"] is None
    assert "boom" not in res.text


def test_identity_model_load_failure_is_reported_and_isolated(small_image):
    def broken():
        raise ModelLoadError("missing")

    c = client(embedder_factory=broken)
    body = c.post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH).json()
    assert body["faces"]["count"] == 1 and body["identity"]["status"] == "UNAVAILABLE"
    health = c.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert health["status"] == "ok" and health["identityModelLoaded"] is False and health["identityReason"] == "model not loaded"


def test_identity_disabled_by_configuration(small_image):
    emb = FakeEmbedder()
    c = client(embedder=emb, AI_IDENTITY_ENABLED="false")
    body = c.post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH).json()
    assert body["identity"]["status"] == "DISABLED" and emb.calls == 0
    assert c.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()["identityReason"] == "disabled"


def test_health_reports_the_identity_model():
    health = client().get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert health["identityModelLoaded"] is True and health["identityModel"]["name"] == "fake-sface"


def test_feature_is_never_logged(small_image, caplog):
    caplog.set_level("INFO", logger="proctor_ai")
    client().post("/v1/analyze?identity=true", content=jpeg_bytes(small_image), headers=AUTH)
    analyze_logs = [r.getMessage() for r in caplog.records if '"event": "analyze"' in r.getMessage()]
    assert analyze_logs and all("embedding" not in m and '"identity": "OK"' in m for m in analyze_logs)


def test_end_to_end_same_and_different_person_with_the_real_models():
    from proctor_ai.__main__ import build_app

    c = TestClient(build_app(make_settings(AI_WORKERS=1, AI_OBJECTS_ENABLED="false")))

    def feature(name):
        body = c.post("/v1/analyze?identity=true&objects=false", content=(FIXTURES / name).read_bytes(), headers=AUTH).json()
        assert body["identity"]["status"] == "OK", body["identity"]
        assert body["identity"]["model"]["sha256"] == ID_MANIFEST["sha256"]
        return np.asarray(body["identity"]["embedding"])

    baseline = feature("face_victor_glover.jpg")
    assert cosine_similarity(baseline, feature("face_victor_glover_2018.jpg")) > REFERENCE_COSINE_THRESHOLD
    assert cosine_similarity(baseline, feature("face_raja_chari.jpg")) < REFERENCE_COSINE_THRESHOLD
