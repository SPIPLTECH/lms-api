"""EfficientDet-Lite0 object detector (COCO classes) on the LiteRT CPU runtime.

Model: TensorFlow `efficientdet/tfLite/lite0-detection-metadata` v1 (Kaggle Models, licence recorded
as Apache 2.0). It has post-processing built in:
  * input  1x320x320x3 uint8 (plain resize, no letterbox; quantisation is inside the model);
  * output boxes [1,25,4] (ymin, xmin, ymax, xmax normalised), classes [1,25], scores [1,25], count [1].
The 90-entry COCO label map is embedded in the .tflite file (TFLite metadata is a zip appendix).

Only the configured labels (default: "cell phone") are reported; everything else is discarded, so
people, furniture and the exam laptop itself never reach the backend.
"""

from __future__ import annotations

import threading
import time
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from .base import BoundingBox, ModelInfo, ObjectDetection, ObjectDetectionResult
from .blazeface import ModelLoadError, sha256_of

INPUT_SIZE = 320
MAX_DETECTIONS = 25
# Output tensor names of the pinned model (verified at load time by shape).
OUT_BOXES = "StatefulPartitionedCall:3"
OUT_CLASSES = "StatefulPartitionedCall:2"
OUT_SCORES = "StatefulPartitionedCall:1"
OUT_COUNT = "StatefulPartitionedCall:0"


def read_embedded_labels(model_path: Path) -> list[str]:
    try:
        with zipfile.ZipFile(model_path) as zf:
            return zf.read("labelmap.txt").decode("utf-8").splitlines()
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ModelLoadError("Object model has no embedded label map.") from exc


class EfficientDetObjectDetector:
    """Thread-safe: inference is serialised with an internal lock (LiteRT interpreters are not)."""

    def __init__(
        self,
        model_path: Path,
        expected_sha256: str,
        version: str,
        score_threshold: float = 0.4,
        labels: tuple[str, ...] = ("cell phone",),
        num_threads: int = 2,
    ):
        if not model_path.is_file():
            raise ModelLoadError(f"Model file not found: {model_path.name}. Run scripts/download_models.py.")
        actual = sha256_of(model_path)
        if actual != expected_sha256:
            raise ModelLoadError("Model checksum mismatch; refusing to load an unverified model.")

        label_map = read_embedded_labels(model_path)
        unknown = [label for label in labels if label not in label_map]
        if unknown or not labels:
            raise ModelLoadError(f"Unknown object labels: {', '.join(unknown) or '(none configured)'}")
        self._wanted = {label_map.index(label): label for label in labels}

        try:
            from ai_edge_litert.interpreter import Interpreter

            self._interpreter = Interpreter(model_path=str(model_path), num_threads=num_threads)
            self._interpreter.allocate_tensors()
        except Exception as exc:  # noqa: BLE001 - any runtime failure is a load failure
            raise ModelLoadError(f"Model could not be loaded: {type(exc).__name__}") from exc

        inputs = self._interpreter.get_input_details()
        outputs = {d["name"]: d for d in self._interpreter.get_output_details()}
        if len(inputs) != 1 or list(inputs[0]["shape"]) != [1, INPUT_SIZE, INPUT_SIZE, 3] or inputs[0]["dtype"] != np.uint8:
            raise ModelLoadError("Unexpected object model input.")
        expected = {OUT_BOXES: [1, MAX_DETECTIONS, 4], OUT_CLASSES: [1, MAX_DETECTIONS], OUT_SCORES: [1, MAX_DETECTIONS], OUT_COUNT: [1]}
        for name, shape in expected.items():
            if name not in outputs or list(outputs[name]["shape"]) != shape:
                raise ModelLoadError("Unexpected object model outputs.")
        self._input_index = inputs[0]["index"]
        self._out = {name: outputs[name]["index"] for name in expected}
        self._score_threshold = score_threshold
        self._labels = tuple(labels)
        self._lock = threading.Lock()
        self._info = ModelInfo(name="efficientdet_lite0", version=version, sha256=actual, score_threshold=score_threshold)

    @property
    def info(self) -> ModelInfo:
        return self._info

    @property
    def labels(self) -> tuple[str, ...]:
        return self._labels

    def detect(self, rgb: np.ndarray) -> ObjectDetectionResult:
        if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
            raise ValueError("expected an H x W x 3 uint8 RGB array")
        started = time.perf_counter()
        tensor = np.asarray(Image.fromarray(rgb).resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR), dtype=np.uint8)[np.newaxis]
        with self._lock:
            self._interpreter.set_tensor(self._input_index, tensor)
            self._interpreter.invoke()
            boxes = self._interpreter.get_tensor(self._out[OUT_BOXES])[0].copy()
            classes = self._interpreter.get_tensor(self._out[OUT_CLASSES])[0].copy()
            scores = self._interpreter.get_tensor(self._out[OUT_SCORES])[0].copy()
            count = int(self._interpreter.get_tensor(self._out[OUT_COUNT])[0])

        found: list[ObjectDetection] = []
        for i in range(min(count, MAX_DETECTIONS)):
            label = self._wanted.get(int(classes[i]))
            score = float(scores[i])
            if label is None or score < self._score_threshold:
                continue
            ymin, xmin, ymax, xmax = (float(np.clip(v, 0.0, 1.0)) for v in boxes[i])
            if xmax <= xmin or ymax <= ymin:
                continue
            found.append(
                ObjectDetection(
                    label=label,
                    score=round(score, 4),
                    box=BoundingBox(x=round(xmin, 4), y=round(ymin, 4), width=round(xmax - xmin, 4), height=round(ymax - ymin, 4)),
                )
            )
        found.sort(key=lambda o: o.score, reverse=True)
        return ObjectDetectionResult(objects=found, inference_ms=round((time.perf_counter() - started) * 1000, 2))
