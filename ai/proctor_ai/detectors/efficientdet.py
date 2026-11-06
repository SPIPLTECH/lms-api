"""EfficientDet-Lite0 object detector (COCO classes) on the LiteRT CPU runtime.

Model: TensorFlow `efficientdet/tfLite/lite0-detection-metadata` v1 (Kaggle Models, licence recorded
as Apache 2.0). It has post-processing built in:
  * input  1x320x320x3 uint8 (plain resize, no letterbox; quantisation is inside the model);
  * output boxes [1,25,4] (ymin, xmin, ymax, xmax normalised), classes [1,25], scores [1,25], count [1].
The 90-entry COCO label map is embedded in the .tflite file (TFLite metadata is a zip appendix).

Only the configured labels (default: "cell phone") are reported; everything else is discarded, so
people, furniture and the exam laptop itself never reach the backend.

A phone held up to a webcam was missed on real exam frames: squeezed into the square input it scored
0.21, and from the back the model called it a "remote". So each frame is looked at four ways (the plain
resize, the whole frame undistorted, and its left and right parts), the best score wins, and a "remote"
counts as a phone. About 20 ms per view on a laptop CPU.
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
# Classes the model gives a wanted object instead. Faces, rooms and portraits keep "remote" under
# 0.25; a phone held to text scores 0.43-0.52 as one (head_turned_texting.jpg).
LOOKALIKES = {"cell phone": ("remote",)}
# Each side crop is 5/8 of the width, so an object on the centre line is whole in at least one.
SIDE_CROP = 0.625
# Detections of one label from different views overlapping this much are the same object.
SAME_OBJECT_IOU = 0.5
LETTERBOX_FILL = (114, 114, 114)


def _undistorted(image: Image.Image, left: int, width: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """A full-height strip padded to a square, and how its normalised boxes map back to frame pixels."""
    height = image.height
    side = max(width, height)
    pad_x, pad_y = (side - width) // 2, (side - height) // 2
    square = Image.new("RGB", (side, side), LETTERBOX_FILL)
    square.paste(image.crop((left, 0, left + width, height)), (pad_x, pad_y))
    return square, (left - pad_x, -pad_y, side, side)


def _views(image: Image.Image) -> list[tuple[Image.Image, tuple[int, int, int, int]]]:
    """Each view with (left, top, span_x, span_y): frame pixel = left + normalised x * span_x."""
    width, height = image.size
    crop = round(width * SIDE_CROP)
    return [
        (image, (0, 0, width, height)),
        _undistorted(image, 0, width),
        _undistorted(image, 0, crop),
        _undistorted(image, width - crop, crop),
    ]


def _iou(a: BoundingBox, b: BoundingBox) -> float:
    w = min(a.x + a.width, b.x + b.width) - max(a.x, b.x)
    h = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
    if w <= 0 or h <= 0:
        return 0.0
    overlap = w * h
    return overlap / (a.width * a.height + b.width * b.height - overlap)


def _distinct(found: list[ObjectDetection]) -> list[ObjectDetection]:
    """One detection per object: the best-scoring view of it."""
    kept: list[ObjectDetection] = []
    for o in sorted(found, key=lambda o: o.score, reverse=True):
        if not any(k.label == o.label and _iou(k.box, o.box) >= SAME_OBJECT_IOU for k in kept):
            kept.append(o)
    return kept


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
        for label in labels:
            for lookalike in LOOKALIKES.get(label, ()):
                if lookalike in label_map and lookalike not in labels:
                    self._wanted.setdefault(label_map.index(lookalike), label)

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
        image = Image.fromarray(rgb)
        frame_w, frame_h = image.size
        found: list[ObjectDetection] = []
        for view, (left, top, span_x, span_y) in _views(image):
            tensor = np.asarray(view.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR), dtype=np.uint8)[np.newaxis]
            with self._lock:
                self._interpreter.set_tensor(self._input_index, tensor)
                self._interpreter.invoke()
                boxes = self._interpreter.get_tensor(self._out[OUT_BOXES])[0].copy()
                classes = self._interpreter.get_tensor(self._out[OUT_CLASSES])[0].copy()
                scores = self._interpreter.get_tensor(self._out[OUT_SCORES])[0].copy()
                count = int(self._interpreter.get_tensor(self._out[OUT_COUNT])[0])

            for i in range(min(count, MAX_DETECTIONS)):
                label = self._wanted.get(int(classes[i]))
                score = float(scores[i])
                if label is None or score < self._score_threshold:
                    continue
                ymin, xmin, ymax, xmax = (float(v) for v in boxes[i])
                x0, x1 = (float(np.clip((left + v * span_x) / frame_w, 0.0, 1.0)) for v in (xmin, xmax))
                y0, y1 = (float(np.clip((top + v * span_y) / frame_h, 0.0, 1.0)) for v in (ymin, ymax))
                if x1 <= x0 or y1 <= y0:
                    continue
                found.append(
                    ObjectDetection(
                        label=label,
                        score=round(score, 4),
                        box=BoundingBox(x=round(x0, 4), y=round(y0, 4), width=round(x1 - x0, 4), height=round(y1 - y0, 4)),
                    )
                )
        return ObjectDetectionResult(objects=_distinct(found), inference_ms=round((time.perf_counter() - started) * 1000, 2))
