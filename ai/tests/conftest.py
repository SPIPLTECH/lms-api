import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proctor_ai.config import load_settings  # noqa: E402
from proctor_ai.detectors.base import BoundingBox, FaceDetection, FaceDetectionResult, ModelInfo  # noqa: E402

TOKEN = "test-token-" + "x" * 40
FIXTURES = ROOT / "tests" / "fixtures"
MODEL_PATH = ROOT / "models" / "blaze_face_short_range.tflite"
MANIFEST = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))["blaze_face_short_range"]


def make_settings(**overrides):
    env = {"AI_SERVICE_TOKEN": TOKEN}
    env.update({k: str(v) for k, v in overrides.items()})
    return load_settings(env)


def jpeg_bytes(arr: np.ndarray, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    return buf.getvalue()


class FakeDetector:
    """Returns a scripted number of faces; records calls. Used to test the API without the model."""

    def __init__(self, faces: int = 1, error: Exception | None = None):
        self.faces = faces
        self.error = error
        self.calls = 0

    @property
    def info(self) -> ModelInfo:
        return ModelInfo(name="fake", version="0", sha256="0" * 64, score_threshold=0.6)

    def detect(self, rgb):
        self.calls += 1
        if self.error:
            raise self.error
        faces = [FaceDetection(score=0.9, box=BoundingBox(0.1 * i, 0.1, 0.2, 0.2)) for i in range(self.faces)]
        return FaceDetectionResult(faces=faces, inference_ms=1.0)


@pytest.fixture
def small_image() -> np.ndarray:
    return np.full((48, 64, 3), 120, dtype=np.uint8)


def load_fixture(name: str) -> np.ndarray:
    return np.asarray(Image.open(FIXTURES / name).convert("RGB"))


def two_face_composite() -> np.ndarray:
    """Two public-domain portraits cropped around the face and placed side by side (600x300).
    Each face covers ~23% of the image width, inside the short-range model's documented domain."""

    def crop(name, x, y, w, h):
        im = Image.open(FIXTURES / name).convert("RGB")
        return im.crop((int(x - 0.6 * w), int(y - 0.6 * h), int(x + 1.6 * w), int(y + 1.6 * h))).resize((300, 300))

    comp = Image.new("RGB", (600, 300))
    comp.paste(crop("face_raja_chari.jpg", 200, 130, 202, 201), (0, 0))
    comp.paste(crop("face_victor_glover.jpg", 236, 150, 192, 192), (300, 0))
    return np.asarray(comp)
