"""BlazeFace (short range) face detector running on the LiteRT (TFLite) CPU runtime.

Re-implements MediaPipe's documented post-processing for this model so the `mediapipe` package
(which sends usage metrics to Google) is not needed:
  * input 128x128x3 float32 in [-1, 1], aspect ratio kept by letterboxing (padding = 0.0);
  * 896 SSD anchors: strides [8, 16, 16, 16], two anchors per cell per layer, fixed anchor size;
  * box decode with scale 128, `reverse_output_order` (x, y, w, h);
  * sigmoid scores (clipped at +/-100), threshold, weighted non-max suppression (IoU 0.3);
  * letterbox removal back to the original image coordinates;
  * the 6 face keypoints are decoded like the box centre and merged by the same weighted NMS
    (they feed the geometric head-pose estimate in proctor_ai/headpose.py).
"""

from __future__ import annotations

import hashlib
import math
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

from .base import BoundingBox, FaceDetection, FaceDetectionResult, ModelInfo

INPUT_SIZE = 128
NUM_ANCHORS = 896
STRIDES = (8, 16, 16, 16)
COORD_SCALE = 128.0
SCORE_CLIP = 100.0
NMS_IOU_THRESHOLD = 0.45


class ModelLoadError(Exception):
    pass


def generate_anchors() -> np.ndarray:
    """Returns (896, 2) anchor centres (x, y) in [0, 1]; anchor width/height are fixed at 1."""
    anchors: list[tuple[float, float]] = []
    layer = 0
    while layer < len(STRIDES):
        per_cell = 0
        last = layer
        while last < len(STRIDES) and STRIDES[last] == STRIDES[layer]:
            per_cell += 2  # aspect ratio 1.0 + interpolated scale anchor
            last += 1
        size = math.ceil(INPUT_SIZE / STRIDES[layer])
        for y in range(size):
            for x in range(size):
                for _ in range(per_cell):
                    anchors.append(((x + 0.5) / size, (y + 0.5) / size))
        layer = last
    arr = np.asarray(anchors, dtype=np.float32)
    assert arr.shape == (NUM_ANCHORS, 2), arr.shape
    return arr


ANCHORS = generate_anchors()


def letterbox(rgb: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Resize keeping aspect ratio into a 128x128 float tensor in [-1, 1].
    Returns (tensor[1,128,128,3], pad_x, pad_y) where pads are fractions of the tensor side."""
    h, w = rgb.shape[:2]
    scale = INPUT_SIZE / max(h, w)
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    resized = np.asarray(Image.fromarray(rgb).resize((new_w, new_h), Image.BILINEAR), dtype=np.float32)
    tensor = np.zeros((INPUT_SIZE, INPUT_SIZE, 3), dtype=np.float32)
    off_x = (INPUT_SIZE - new_w) // 2
    off_y = (INPUT_SIZE - new_h) // 2
    tensor[off_y : off_y + new_h, off_x : off_x + new_w] = resized / 127.5 - 1.0
    pad_x = off_x / INPUT_SIZE
    pad_y = off_y / INPUT_SIZE
    return tensor[np.newaxis, ...], pad_x, pad_y


def decode_boxes(raw: np.ndarray) -> np.ndarray:
    """raw: (896, 16) regressors -> (896, 4) boxes as (xmin, ymin, xmax, ymax) in tensor space."""
    x_c = raw[:, 0] / COORD_SCALE + ANCHORS[:, 0]
    y_c = raw[:, 1] / COORD_SCALE + ANCHORS[:, 1]
    w = raw[:, 2] / COORD_SCALE
    h = raw[:, 3] / COORD_SCALE
    return np.stack([x_c - w / 2, y_c - h / 2, x_c + w / 2, y_c + h / 2], axis=1)


NUM_KEYPOINTS = 6


def decode_keypoints(raw: np.ndarray, anchors: np.ndarray = ANCHORS) -> np.ndarray:
    """raw: (N, 16) regressors, anchors: (N, 2) -> (N, 12) keypoints (x0, y0, ..., x5, y5) in tensor space."""
    out = np.empty((raw.shape[0], 2 * NUM_KEYPOINTS), dtype=np.float64)
    for k in range(NUM_KEYPOINTS):
        out[:, 2 * k] = raw[:, 4 + 2 * k] / COORD_SCALE + anchors[:, 0]
        out[:, 2 * k + 1] = raw[:, 5 + 2 * k] / COORD_SCALE + anchors[:, 1]
    return out


def sigmoid_scores(raw: np.ndarray) -> np.ndarray:
    # float64: exp(100) overflows float32.
    clipped = np.clip(raw.reshape(-1).astype(np.float64), -SCORE_CLIP, SCORE_CLIP)
    return 1.0 / (1.0 + np.exp(-clipped))


def iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    ix1 = np.maximum(box[0], boxes[:, 0])
    iy1 = np.maximum(box[1], boxes[:, 1])
    ix2 = np.minimum(box[2], boxes[:, 2])
    iy2 = np.minimum(box[3], boxes[:, 3])
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    union = area + areas - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-12), 0.0)


def weighted_nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = NMS_IOU_THRESHOLD):
    """MediaPipe 'WEIGHTED' NMS: overlapping candidates are merged (score-weighted average box);
    the merged detection keeps the highest score of its cluster."""
    order = list(np.argsort(-scores))
    out: list[tuple[float, np.ndarray]] = []
    while order:
        top = order[0]
        idx = np.asarray(order)
        overlaps = iou(boxes[top], boxes[idx])
        cluster = idx[overlaps > iou_threshold]
        if cluster.size == 0:
            cluster = np.asarray([top])
        weights = scores[cluster]
        merged = (boxes[cluster] * weights[:, None]).sum(axis=0) / weights.sum()
        out.append((float(scores[top]), merged))
        clustered = set(cluster.tolist())
        order = [i for i in order if i not in clustered]
    return out


def remove_letterbox_points(points: np.ndarray, pad_x: float, pad_y: float) -> np.ndarray:
    """points: (12,) x/y pairs in tensor space -> original-image space, clipped to [0, 1]."""
    out = points.astype(np.float64).copy()
    out[0::2] = (out[0::2] - pad_x) / (1.0 - 2 * pad_x)
    out[1::2] = (out[1::2] - pad_y) / (1.0 - 2 * pad_y)
    return np.clip(out, 0.0, 1.0)


def remove_letterbox(box: np.ndarray, pad_x: float, pad_y: float) -> np.ndarray:
    sx = 1.0 - 2 * pad_x
    sy = 1.0 - 2 * pad_y
    x1 = (box[0] - pad_x) / sx
    y1 = (box[1] - pad_y) / sy
    x2 = (box[2] - pad_x) / sx
    y2 = (box[3] - pad_y) / sy
    return np.clip(np.asarray([x1, y1, x2, y2]), 0.0, 1.0)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


class BlazeFaceDetector:
    """Thread-safe: inference is serialised with an internal lock (LiteRT interpreters are not)."""

    def __init__(self, model_path: Path, expected_sha256: str, version: str, score_threshold: float = 0.6, num_threads: int = 2):
        if not model_path.is_file():
            raise ModelLoadError(f"Model file not found: {model_path.name}. Run scripts/download_models.py.")
        actual = sha256_of(model_path)
        if actual != expected_sha256:
            raise ModelLoadError("Model checksum mismatch; refusing to load an unverified model.")
        try:
            from ai_edge_litert.interpreter import Interpreter

            self._interpreter = Interpreter(model_path=str(model_path), num_threads=num_threads)
            self._interpreter.allocate_tensors()
        except Exception as exc:  # noqa: BLE001 - any runtime failure is a load failure
            raise ModelLoadError(f"Model could not be loaded: {type(exc).__name__}") from exc

        inputs = self._interpreter.get_input_details()
        outputs = {d["name"]: d for d in self._interpreter.get_output_details()}
        if len(inputs) != 1 or list(inputs[0]["shape"]) != [1, INPUT_SIZE, INPUT_SIZE, 3]:
            raise ModelLoadError("Unexpected model input shape.")
        if "regressors" not in outputs or "classificators" not in outputs:
            raise ModelLoadError("Unexpected model outputs.")
        self._input_index = inputs[0]["index"]
        self._boxes_index = outputs["regressors"]["index"]
        self._scores_index = outputs["classificators"]["index"]
        self._score_threshold = score_threshold
        self._lock = threading.Lock()
        self._info = ModelInfo(name="blaze_face_short_range", version=version, sha256=actual, score_threshold=score_threshold)

    @property
    def info(self) -> ModelInfo:
        return self._info

    def detect(self, rgb: np.ndarray) -> FaceDetectionResult:
        if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
            raise ValueError("expected an H x W x 3 uint8 RGB array")
        started = time.perf_counter()
        tensor, pad_x, pad_y = letterbox(rgb)
        with self._lock:
            self._interpreter.set_tensor(self._input_index, tensor)
            self._interpreter.invoke()
            raw_boxes = self._interpreter.get_tensor(self._boxes_index)[0].copy()
            raw_scores = self._interpreter.get_tensor(self._scores_index)[0].copy()

        scores = sigmoid_scores(raw_scores)
        keep = scores >= self._score_threshold
        faces: list[FaceDetection] = []
        if keep.any():
            # Box (4 columns) + keypoints (12 columns): NMS clusters on the box and merges all 16.
            boxes = np.concatenate([decode_boxes(raw_boxes)[keep], decode_keypoints(raw_boxes[keep], ANCHORS[keep])], axis=1)
            for score, merged in weighted_nms(boxes, scores[keep]):
                b = remove_letterbox(merged[:4], pad_x, pad_y)
                if b[2] - b[0] <= 0 or b[3] - b[1] <= 0:
                    continue
                kps = remove_letterbox_points(merged[4:], pad_x, pad_y)
                faces.append(
                    FaceDetection(
                        score=round(score, 4),
                        box=BoundingBox(
                            x=round(float(b[0]), 4),
                            y=round(float(b[1]), 4),
                            width=round(float(b[2] - b[0]), 4),
                            height=round(float(b[3] - b[1]), 4),
                        ),
                        keypoints=tuple(
                            (round(float(kps[2 * k]), 4), round(float(kps[2 * k + 1]), 4)) for k in range(NUM_KEYPOINTS)
                        ),
                    )
                )
        faces.sort(key=lambda f: f.score, reverse=True)
        return FaceDetectionResult(faces=faces, inference_ms=round((time.perf_counter() - started) * 1000, 2))
