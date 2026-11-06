"""/v1/analyze contract: faces + head pose + objects, partial degradation, auth, and the real models."""

import json

import pytest
from fastapi.testclient import TestClient

from conftest import MANIFEST, MODEL_PATH, ROOT, TOKEN, FakeDetector, jpeg_bytes, load_fixture, make_settings
from proctor_ai.api import create_app
from proctor_ai.detectors.base import BoundingBox, FaceDetection, FaceDetectionResult, ModelInfo, ObjectDetection, ObjectDetectionResult

AUTH = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "image/jpeg"}


class KeypointFaceDetector(FakeDetector):
    """One frontal face with keypoints (nose shifted by `nose_dx` pixels on a 64 px wide image)."""

    def __init__(self, nose_dx: float = 0.0):
        super().__init__(1)
        self.nose_dx = nose_dx

    def detect(self, rgb):
        self.calls += 1
        h, w = rgb.shape[:2]
        cx, cy = w / 2, h / 2
        pts = [(cx - 8, cy), (cx + 8, cy), (cx + self.nose_dx, cy + 6), (cx, cy + 10), (cx - 18, cy + 2), (cx + 18, cy + 2)]
        kps = tuple((x / w, y / h) for x, y in pts)
        return FaceDetectionResult(faces=[FaceDetection(0.9, BoundingBox(0.3, 0.3, 0.4, 0.4), kps)], inference_ms=1.0)


class FakeObjects:
    def __init__(self, found=1, error=None):
        self.found, self.error, self.calls = found, error, 0

    @property
    def info(self):
        return ModelInfo(name="fake-objects", version="0", sha256="1" * 64, score_threshold=0.4)

    @property
    def labels(self):
        return ("cell phone",)

    def detect(self, rgb):
        self.calls += 1
        if self.error:
            raise self.error
        return ObjectDetectionResult([ObjectDetection("cell phone", 0.8, BoundingBox(0.5, 0.5, 0.1, 0.2))] * self.found, 2.0)


def client(faces=None, objects_factory=None, **settings):
    return TestClient(create_app(make_settings(**settings), lambda: faces or KeypointFaceDetector(), objects_factory))


def analyze(c, data, query="", headers=AUTH):
    return c.post(f"/v1/analyze{query}", content=data, headers=headers)


def test_faces_head_pose_and_objects_in_one_response(small_image):
    res = analyze(client(KeypointFaceDetector(nose_dx=9), lambda: FakeObjects(1)), jpeg_bytes(small_image))
    assert res.status_code == 200
    body = res.json()
    assert body["faces"]["count"] == 1 and body["faces"]["classification"] == "ONE_FACE"
    pose = body["faces"]["items"][0]["headPose"]
    assert pose["reliable"] is True and pose["yawDeg"] == pytest.approx(30.0, abs=0.5)
    assert body["objects"]["status"] == "OK" and body["objects"]["labels"] == ["cell phone"]
    assert [o["label"] for o in body["objects"]["items"]] == ["cell phone"]
    assert body["totalMs"] == pytest.approx(3.0)


def test_objects_can_be_skipped_per_request(small_image):
    objs = []

    def factory():
        objs.append(FakeObjects(1))
        return objs[-1]

    body = analyze(client(objects_factory=factory), jpeg_bytes(small_image), "?objects=false").json()
    assert body["objects"]["status"] == "DISABLED" and sum(o.calls for o in objs) == 0
    assert body["faces"]["count"] == 1


def test_object_model_failure_keeps_face_analysis_working(small_image):
    def broken():
        raise RuntimeError("object model missing")

    c = client(objects_factory=broken)
    health = c.get("/v1/health", headers=AUTH).json()
    assert health["status"] == "ok" and health["modelLoaded"] is True
    assert health["objectModelLoaded"] is False and health["objectReason"] == "model not loaded"
    body = analyze(c, jpeg_bytes(small_image)).json()
    assert body["faces"]["count"] == 1 and body["objects"]["status"] == "UNAVAILABLE"


def test_objects_disabled_by_configuration(small_image):
    c = client(objects_factory=lambda: FakeObjects(1), AI_OBJECTS_ENABLED="false")
    assert analyze(c, jpeg_bytes(small_image)).json()["objects"]["status"] == "DISABLED"
    assert c.get("/v1/health", headers=AUTH).json()["objectReason"] == "disabled"


def test_object_inference_error_is_a_503_without_details(small_image):
    c = client(objects_factory=lambda: FakeObjects(error=RuntimeError("secret detail")))
    res = analyze(c, jpeg_bytes(small_image))
    assert res.status_code == 503 and res.json()["code"] == "INFERENCE_FAILED" and "secret detail" not in res.text


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong", "Content-Type": "image/jpeg"}])
def test_analyze_requires_the_service_token(small_image, headers):
    det = KeypointFaceDetector()
    res = analyze(client(det), jpeg_bytes(small_image), headers=headers)
    assert res.status_code == 401 and det.calls == 0


def test_invalid_images_never_reach_the_models():
    det = KeypointFaceDetector()
    assert analyze(client(det), b"not an image").status_code == 415 and det.calls == 0


def test_face_model_failure_degrades_to_503(small_image):
    def broken():
        raise RuntimeError("no model")

    c = TestClient(create_app(make_settings(), broken, lambda: FakeObjects()))
    res = analyze(c, jpeg_bytes(small_image))
    assert res.status_code == 503 and res.json()["code"] == "MODEL_UNAVAILABLE"


def test_end_to_end_with_both_real_models():
    from proctor_ai.detectors.blazeface import BlazeFaceDetector
    from proctor_ai.detectors.efficientdet import EfficientDetObjectDetector

    om = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))["efficientdet_lite0"]
    c = TestClient(
        create_app(
            make_settings(AI_WORKERS=1),
            lambda: BlazeFaceDetector(MODEL_PATH, MANIFEST["sha256"], MANIFEST["version"], 0.6),
            lambda: EfficientDetObjectDetector(ROOT / "models" / om["file"], om["sha256"], om["version"], 0.4, ("cell phone",)),
        )
    )
    portrait = analyze(c, jpeg_bytes(load_fixture("face_victor_glover.jpg"))).json()
    assert portrait["faces"]["classification"] == "ONE_FACE" and portrait["objects"]["items"] == []
    assert abs(portrait["faces"]["items"][0]["headPose"]["yawDeg"]) < 35
    phone = analyze(c, jpeg_bytes(load_fixture("phone_hand_closeup.jpg"))).json()
    assert phone["faces"]["classification"] == "NO_FACE"
    assert [o["label"] for o in phone["objects"]["items"]] == ["cell phone"]
    health = c.get("/v1/health", headers=AUTH).json()
    assert health["objectModelLoaded"] is True and health["objectModel"]["name"] == "efficientdet_lite0"
