"""Configuration from environment variables. Fails closed: the service will not start without a
strong shared token, and it binds to loopback unless explicitly told otherwise."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MIN_TOKEN_LENGTH = 32


class ConfigError(Exception):
    pass


def _int(env: dict[str, str], key: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} must be an integer") from exc
    if not lo <= value <= hi:
        raise ConfigError(f"{key} must be between {lo} and {hi}")
    return value


def _float(env: dict[str, str], key: str, default: float, lo: float, hi: float) -> float:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} must be a number") from exc
    if not lo <= value <= hi:
        raise ConfigError(f"{key} must be between {lo} and {hi}")
    return value


@dataclass(frozen=True)
class Settings:
    token: str
    host: str
    port: int
    model_path: Path
    max_image_bytes: int
    max_pixels: int
    score_threshold: float
    num_threads: int
    busy_timeout_seconds: float
    #: Number of independent model instances (each serves one request at a time). Bounds CPU use.
    workers: int = 1
    objects_enabled: bool = True
    object_model_path: Path = SERVICE_ROOT / "models" / "efficientdet_lite0.tflite"
    object_score_threshold: float = 0.4
    object_labels: tuple[str, ...] = ("cell phone",)
    #: Identity consistency: SFace feature of the single face, returned when a request asks for it.
    identity_enabled: bool = True
    identity_model_path: Path = SERVICE_ROOT / "models" / "face_recognition_sface_2021dec.onnx"


def _labels(env: dict[str, str], key: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    labels = tuple(dict.fromkeys(part.strip() for part in raw.split(",") if part.strip()))
    if not labels or len(labels) > 10 or any(len(label) > 40 for label in labels):
        raise ConfigError(f"{key} must be a comma-separated list of up to 10 COCO labels")
    return labels


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if env is None else env)
    problems: list[str] = []

    token = env.get("AI_SERVICE_TOKEN", "")
    if len(token) < MIN_TOKEN_LENGTH:
        problems.append(f"AI_SERVICE_TOKEN is required and must be at least {MIN_TOKEN_LENGTH} characters")

    host = env.get("AI_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost", "::1") and env.get("AI_ALLOW_NON_LOOPBACK") != "true":
        problems.append("AI_HOST must be a loopback address (set AI_ALLOW_NON_LOOPBACK=true only behind a private network)")

    try:
        settings = Settings(
            token=token,
            host=host,
            port=_int(env, "AI_PORT", 8008, 1, 65535),
            model_path=Path(env.get("AI_MODEL_PATH") or SERVICE_ROOT / "models" / "blaze_face_short_range.tflite"),
            max_image_bytes=_int(env, "AI_MAX_IMAGE_BYTES", 2 * 1024 * 1024, 1024, 10 * 1024 * 1024),
            max_pixels=_int(env, "AI_MAX_PIXELS", 4096 * 4096, 64 * 64, 8192 * 8192),
            # 0.6 (not the model default 0.5): a reflective helmet visor scored 0.516 in a fixture while real
            # faces scored 0.88-0.96. Calibrate on real webcam data before production use.
            score_threshold=_float(env, "AI_FACE_SCORE_THRESHOLD", 0.52, 0.05, 0.99),
            num_threads=_int(env, "AI_NUM_THREADS", 2, 1, 16),
            busy_timeout_seconds=_float(env, "AI_BUSY_TIMEOUT_SECONDS", 2.0, 0.1, 30.0),
            workers=_int(env, "AI_WORKERS", 2, 1, 16),
            objects_enabled=env.get("AI_OBJECTS_ENABLED", "true").strip().lower() != "false",
            object_model_path=Path(env.get("AI_OBJECT_MODEL_PATH") or SERVICE_ROOT / "models" / "efficientdet_lite0.tflite"),
            # 0.4: phones in real photos scored 0.41-0.74; no phone was reported in any portrait fixture.
            object_score_threshold=_float(env, "AI_OBJECT_SCORE_THRESHOLD", 0.4, 0.05, 0.99),
            object_labels=_labels(env, "AI_OBJECT_LABELS", ("cell phone",)),
            identity_enabled=env.get("AI_IDENTITY_ENABLED", "true").strip().lower() != "false",
            identity_model_path=Path(
                env.get("AI_IDENTITY_MODEL_PATH") or SERVICE_ROOT / "models" / "face_recognition_sface_2021dec.onnx"
            ),
        )
    except ConfigError as exc:
        problems.append(str(exc))
        settings = None  # type: ignore[assignment]

    if problems:
        raise ConfigError("Invalid AI service configuration: " + "; ".join(problems))
    return settings


def read_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE reader (no dependency). Lines starting with # are ignored."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values
