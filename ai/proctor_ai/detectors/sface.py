"""SFace face embeddings (identity consistency) on ONNX Runtime.

Model: OpenCV Zoo `face_recognition_sface_2021dec.onnx` (Apache-2.0): a MobileFaceNet trained with the
SFace loss. It maps an aligned 112x112 face crop to a 128-d feature; two crops of the same person have
a high cosine similarity. The comparison itself happens in the backend (it holds the baseline); this
module only produces the feature for the single face in a snapshot.

Alignment (no OpenCV needed): a similarity transform (rotation, uniform scale, translation) fitted by
least squares (Umeyama) maps four BlazeFace keypoints (both eyes, nose tip, mouth centre) onto the
standard ArcFace 112x112 template. BlazeFace has no mouth corners, so the template's mouth point is
the midpoint of its two mouth corners.

Model input: RGB, float32 in 0..255, NCHW (as OpenCV's FaceRecognizerSF feeds it:
blobFromImage(scale 1, no mean, swapRB=true)). The output is L2-normalised here, so the cosine
similarity of two features is their dot product.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from .base import FaceDetection, ModelInfo
from .blazeface import ModelLoadError, sha256_of

ALIGNED_SIZE = 112
EMBEDDING_DIM = 128
#: OpenCV's documented cosine threshold for SFace ("same identity" at >= 0.363). Reported as the model's
#: reference value only; the backend applies its own configured threshold.
REFERENCE_COSINE_THRESHOLD = 0.363

# ArcFace 5-point template in the 112x112 crop, in image order: image-left eye, image-right eye, nose
# tip, image-left mouth corner, image-right mouth corner.
_ARCFACE = np.asarray(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float64,
)
#: Targets for BlazeFace keypoints 0-3. BlazeFace's "right eye" is the subject's right eye, which is on
#: the image left in an unmirrored photo, so keypoint 0 maps to the image-left template eye.
ALIGN_TEMPLATE = np.vstack([_ARCFACE[0], _ARCFACE[1], _ARCFACE[2], (_ARCFACE[3] + _ARCFACE[4]) / 2])


def similarity_transform(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform (Umeyama 1991) mapping `src` (N x 2) onto `dst` (N x 2).
    Returns the 2 x 3 matrix M with dst ~= M @ [x, y, 1]. Reflections are excluded."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    mu_s, mu_d = src.mean(axis=0), dst.mean(axis=0)
    s_c, d_c = src - mu_s, dst - mu_d
    var_s = (s_c**2).sum() / len(src)
    if var_s <= 1e-12:
        raise ValueError("degenerate keypoints")
    u, sing, vt = np.linalg.svd(d_c.T @ s_c / len(src))
    d = np.ones(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        d[1] = -1.0
    rot = u @ np.diag(d) @ vt
    scale = (sing * d).sum() / var_s
    trans = mu_d - scale * rot @ mu_s
    return np.hstack([scale * rot, trans[:, None]])


def align_face(rgb: np.ndarray, face: FaceDetection) -> np.ndarray:
    """Returns the 112 x 112 x 3 uint8 aligned crop for one detected face."""
    if len(face.keypoints) < 4:
        raise ValueError("face has no keypoints to align")
    h, w = rgb.shape[:2]
    src = np.asarray([(x * w, y * h) for x, y in face.keypoints[:4]], dtype=np.float64)
    m = similarity_transform(src, ALIGN_TEMPLATE)
    # PIL's affine transform maps each OUTPUT pixel to an INPUT position: use the inverse of M.
    a = m[:, :2]
    inv_a = np.linalg.inv(a)
    inv_t = -inv_a @ m[:, 2]
    coeffs = (inv_a[0, 0], inv_a[0, 1], inv_t[0], inv_a[1, 0], inv_a[1, 1], inv_t[1])
    crop = Image.fromarray(rgb).transform((ALIGNED_SIZE, ALIGNED_SIZE), Image.AFFINE, coeffs, resample=Image.BILINEAR)
    return np.asarray(crop, dtype=np.uint8)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@dataclass(frozen=True)
class EmbeddingResult:
    #: L2-normalised float32 feature of length EMBEDDING_DIM.
    vector: np.ndarray
    inference_ms: float


class SFaceEmbedder:
    """One ONNX Runtime session; the API gives each worker its own instance (one call at a time)."""

    def __init__(self, model_path: Path, expected_sha256: str, version: str, num_threads: int = 2):
        if not model_path.is_file():
            raise ModelLoadError(f"Model file not found: {model_path.name}. Run scripts/download_models.py.")
        actual = sha256_of(model_path)
        if actual != expected_sha256:
            raise ModelLoadError("Model checksum mismatch; refusing to load an unverified model.")
        try:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = num_threads
            options.inter_op_num_threads = 1
            options.log_severity_level = 3  # the converted graph emits harmless initializer warnings
            self._session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
        except Exception as exc:  # noqa: BLE001 - any runtime failure is a load failure
            raise ModelLoadError(f"Model could not be loaded: {type(exc).__name__}") from exc

        inputs = self._session.get_inputs()
        outputs = self._session.get_outputs()
        if len(inputs) != 1 or list(inputs[0].shape) != [1, 3, ALIGNED_SIZE, ALIGNED_SIZE]:
            raise ModelLoadError("Unexpected model input shape.")
        if len(outputs) != 1 or list(outputs[0].shape) != [1, EMBEDDING_DIM]:
            raise ModelLoadError("Unexpected model output shape.")
        self._input_name = inputs[0].name
        self._info = ModelInfo(
            name="face_recognition_sface", version=version, sha256=actual, score_threshold=REFERENCE_COSINE_THRESHOLD
        )

    @property
    def info(self) -> ModelInfo:
        return self._info

    def embed(self, rgb: np.ndarray, face: FaceDetection) -> EmbeddingResult:
        if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
            raise ValueError("expected an H x W x 3 uint8 RGB array")
        started = time.perf_counter()
        crop = align_face(rgb, face)
        blob = crop.astype(np.float32).transpose(2, 0, 1)[np.newaxis, ...]
        feature = np.asarray(self._session.run(None, {self._input_name: blob})[0][0], dtype=np.float32)
        norm = float(np.linalg.norm(feature))
        if not np.isfinite(norm) or norm == 0.0:
            raise ValueError("model returned an invalid feature")
        return EmbeddingResult(vector=feature / norm, inference_ms=round((time.perf_counter() - started) * 1000, 2))
