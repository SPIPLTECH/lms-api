"""Real-model tests: BlazeFace short range via LiteRT on public-domain fixtures.

Requires the pinned model (python scripts/download_models.py). Fixture licences: tests/fixtures/README.md.
"""

import shutil

import numpy as np
import pytest
from fastapi.testclient import TestClient

from conftest import MANIFEST, MODEL_PATH, TOKEN, jpeg_bytes, load_fixture, make_settings, two_face_composite
from proctor_ai.api import create_app
from proctor_ai.detectors.blazeface import BlazeFaceDetector, ModelLoadError

pytestmark = pytest.mark.skipif(not MODEL_PATH.is_file(), reason="model not downloaded (run scripts/download_models.py)")


@pytest.fixture(scope="module")
def detector():
    return BlazeFaceDetector(MODEL_PATH, MANIFEST["sha256"], MANIFEST["version"], score_threshold=0.6)


@pytest.mark.parametrize("name", ["face_raja_chari.jpg", "face_victor_glover.jpg", "face_sunita_williams.jpg"])
def test_single_portrait_is_one_face(detector, name):
    result = detector.detect(load_fixture(name))
    assert result.classification == "ONE_FACE"
    face = result.faces[0]
    assert face.score >= 0.8
    # the face is in the upper-central part of these portraits
    assert 0.2 < face.box.x + face.box.width / 2 < 0.8 and face.box.y < 0.5


def test_two_portraits_side_by_side_are_multiple_faces(detector):
    result = detector.detect(two_face_composite())
    assert result.faces_detected == 2 and result.classification == "MULTIPLE_FACES"
    centres = sorted(f.box.x + f.box.width / 2 for f in result.faces)
    assert centres[0] < 0.5 < centres[1]


@pytest.mark.parametrize(
    "image",
    [
        np.full((480, 640, 3), 128, dtype=np.uint8),
        np.zeros((480, 640, 3), dtype=np.uint8),
        np.random.default_rng(7).integers(0, 256, (480, 640, 3), dtype=np.uint8),
    ],
    ids=["grey", "black", "noise"],
)
def test_images_without_people_are_no_face(detector, image):
    assert detector.detect(image).classification == "NO_FACE"


def test_threshold_is_configurable_and_documents_a_known_false_positive():
    # At the model's default 0.5 a reflective helmet visor in this portrait is detected as a face (0.516).
    loose = BlazeFaceDetector(MODEL_PATH, MANIFEST["sha256"], MANIFEST["version"], score_threshold=0.5)
    assert loose.detect(load_fixture("face_sunita_williams.jpg")).faces_detected == 2


def test_checksum_mismatch_is_refused(tmp_path):
    bad = tmp_path / "model.tflite"
    shutil.copy(MODEL_PATH, bad)
    data = bytearray(bad.read_bytes())
    data[1000] ^= 0xFF
    bad.write_bytes(bytes(data))
    with pytest.raises(ModelLoadError, match="checksum"):
        BlazeFaceDetector(bad, MANIFEST["sha256"], MANIFEST["version"])


def test_missing_model_file_is_a_load_error(tmp_path):
    with pytest.raises(ModelLoadError, match="not found"):
        BlazeFaceDetector(tmp_path / "absent.tflite", MANIFEST["sha256"], MANIFEST["version"])


def test_end_to_end_http_with_the_real_model(detector):
    client = TestClient(create_app(make_settings(), lambda: detector))
    res = client.post(
        "/v1/face-detection",
        content=jpeg_bytes(load_fixture("face_victor_glover.jpg")),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "image/jpeg"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["classification"] == "ONE_FACE"
    assert body["model"]["sha256"] == MANIFEST["sha256"]
    assert body["inferenceMs"] > 0
