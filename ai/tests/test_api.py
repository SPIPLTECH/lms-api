"""HTTP API contract with a fake detector: classification, auth, validation and failure handling."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from conftest import TOKEN, FakeDetector, jpeg_bytes, make_settings
from proctor_ai.api import create_app

AUTH = {"Authorization": f"Bearer {TOKEN}"}


def client_for(detector=None, factory=None, **settings):
    app = create_app(make_settings(**settings), factory or (lambda: detector))
    return TestClient(app)


def post_image(client, data, ctype="image/jpeg", headers=AUTH):
    return client.post("/v1/face-detection", content=data, headers={**headers, "Content-Type": ctype})


@pytest.mark.parametrize("faces,classification", [(0, "NO_FACE"), (1, "ONE_FACE"), (3, "MULTIPLE_FACES")])
def test_face_count_classification_in_response(small_image, faces, classification):
    res = post_image(client_for(FakeDetector(faces)), jpeg_bytes(small_image))
    assert res.status_code == 200
    body = res.json()
    assert body["apiVersion"] == "v1" and body["status"] == "OK"
    assert body["facesDetected"] == faces and body["classification"] == classification
    assert len(body["faces"]) == faces
    assert (body["imageWidth"], body["imageHeight"]) == (64, 48)
    assert body["model"]["name"] == "fake"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}])
def test_requests_without_a_valid_token_are_rejected(small_image, headers):
    det = FakeDetector(1)
    c = client_for(det)
    assert post_image(c, jpeg_bytes(small_image), headers=headers).status_code == 401
    assert c.get("/v1/health", headers=headers).status_code == 401
    assert det.calls == 0


def test_health_reports_loaded_model():
    res = client_for(FakeDetector(1)).get("/v1/health", headers=AUTH)
    assert res.status_code == 200 and res.json()["status"] == "ok" and res.json()["modelLoaded"] is True


def test_model_load_failure_degrades_safely(small_image):
    def broken():
        raise RuntimeError("model file missing")

    c = client_for(factory=broken)
    health = c.get("/v1/health", headers=AUTH).json()
    assert health["status"] == "degraded" and health["modelLoaded"] is False
    res = post_image(c, jpeg_bytes(small_image))
    assert res.status_code == 503 and res.json()["code"] == "MODEL_UNAVAILABLE"


def test_inference_error_returns_503_without_leaking_details(small_image):
    res = post_image(client_for(FakeDetector(error=RuntimeError("secret internal detail"))), jpeg_bytes(small_image))
    assert res.status_code == 503 and res.json()["code"] == "INFERENCE_FAILED"
    assert "secret internal detail" not in res.text


def test_invalid_images_are_rejected_before_inference(small_image):
    det = FakeDetector(1)
    c = client_for(det)
    assert post_image(c, b"not an image").status_code == 415
    assert post_image(c, jpeg_bytes(small_image), ctype="text/html").status_code == 415
    assert post_image(c, jpeg_bytes(small_image)[:30]).status_code == 422
    assert det.calls == 0


def test_oversized_upload_is_rejected_with_413(small_image):
    c = client_for(FakeDetector(1), AI_MAX_IMAGE_BYTES=2048)
    big = b"\xff\xd8\xff" + b"\0" * 5000
    res = post_image(c, big)
    assert res.status_code == 413 and res.json()["code"] == "IMAGE_TOO_LARGE"


def test_busy_service_returns_503_instead_of_queueing_forever(small_image):
    class SlowDetector(FakeDetector):
        def detect(self, rgb):
            time.sleep(0.6)
            return super().detect(rgb)

    # One model instance: the second concurrent request cannot get it within the busy timeout.
    c = client_for(SlowDetector(1), AI_BUSY_TIMEOUT_SECONDS=0.1, AI_WORKERS=1)
    results = []
    threads = [threading.Thread(target=lambda: results.append(post_image(c, jpeg_bytes(small_image)).status_code)) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 503]


def test_worker_pool_serves_concurrent_requests_up_to_its_size(small_image):
    class SlowDetector(FakeDetector):
        def detect(self, rgb):
            time.sleep(0.6)
            return super().detect(rgb)

    made = []

    def factory():
        made.append(SlowDetector(1))
        return made[-1]

    c = client_for(factory=factory, AI_BUSY_TIMEOUT_SECONDS=0.1, AI_WORKERS=2)
    assert len(made) == 2  # one independent instance per worker
    results = []
    threads = [threading.Thread(target=lambda: results.append(post_image(c, jpeg_bytes(small_image)).status_code)) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 200, 503]
    assert sum(d.calls for d in made) == 2


def test_no_cors_headers_are_emitted(small_image):
    res = post_image(client_for(FakeDetector(1)), jpeg_bytes(small_image), headers={**AUTH, "Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in res.headers}
