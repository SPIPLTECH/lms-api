"""Detector interfaces shared by all AI features.

Face detection (with the keypoints used for the geometric head-pose estimate) and object
detection each sit behind a small protocol, so the API and tests do not depend on a model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np

FaceClassification = Literal["NO_FACE", "ONE_FACE", "MULTIPLE_FACES"]


@dataclass(frozen=True)
class BoundingBox:
    """Normalised to the original image: 0..1, origin top-left."""

    x: float
    y: float
    width: float
    height: float


# BlazeFace keypoint order (the subject's left/right): right eye, left eye, nose tip, mouth centre,
# right ear tragion, left ear tragion. Normalised to the original image like BoundingBox.
KEYPOINT_NAMES = ("right_eye", "left_eye", "nose_tip", "mouth_center", "right_ear", "left_ear")


@dataclass(frozen=True)
class FaceDetection:
    score: float
    box: BoundingBox
    keypoints: tuple[tuple[float, float], ...] = ()


@dataclass(frozen=True)
class ModelInfo:
    name: str
    version: str
    sha256: str
    score_threshold: float


@dataclass(frozen=True)
class FaceDetectionResult:
    faces: list[FaceDetection] = field(default_factory=list)
    inference_ms: float = 0.0

    @property
    def faces_detected(self) -> int:
        return len(self.faces)

    @property
    def classification(self) -> FaceClassification:
        return classify_face_count(self.faces_detected)


def classify_face_count(count: int) -> FaceClassification:
    if count < 0:
        raise ValueError("face count cannot be negative")
    if count == 0:
        return "NO_FACE"
    if count == 1:
        return "ONE_FACE"
    return "MULTIPLE_FACES"


class FaceDetector(Protocol):
    """Implementations must be safe to call from one thread at a time (the API serialises calls)."""

    @property
    def info(self) -> ModelInfo: ...

    def detect(self, rgb: np.ndarray) -> FaceDetectionResult:
        """`rgb` is an H x W x 3 uint8 array. Raises on internal model failure."""
        ...


@dataclass(frozen=True)
class ObjectDetection:
    label: str
    score: float
    box: BoundingBox


@dataclass(frozen=True)
class ObjectDetectionResult:
    objects: list[ObjectDetection] = field(default_factory=list)
    inference_ms: float = 0.0


class ObjectDetector(Protocol):
    """Same threading contract as FaceDetector: one call at a time per instance."""

    @property
    def info(self) -> ModelInfo: ...

    @property
    def labels(self) -> tuple[str, ...]:
        """The labels this detector reports; every other class is discarded."""
        ...

    def detect(self, rgb: np.ndarray) -> ObjectDetectionResult:
        """`rgb` is an H x W x 3 uint8 array. Raises on internal model failure."""
        ...


class FaceEmbedder(Protocol):
    """Identity feature for one detected face (same threading contract as FaceDetector)."""

    @property
    def info(self) -> ModelInfo: ...

    def embed(self, rgb: np.ndarray, face: FaceDetection):
        """Returns an object with `vector` (L2-normalised 1-d float array) and `inference_ms`.
        Raises on internal model failure or a face without keypoints."""
        ...
