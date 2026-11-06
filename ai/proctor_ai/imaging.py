"""Strict validation and decoding of uploaded images.

Only JPEG, PNG and WebP are accepted. The declared content type must match the file signature,
the byte size is capped, and the pixel count is checked from the header *before* decoding
(decompression-bomb guard). Images are processed in memory and never written to disk or logged.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, UnidentifiedImageError

ALLOWED_CONTENT_TYPES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


class ImageRejected(Exception):
    """Raised for client errors; `status` maps to the HTTP status code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def sniff_format(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "JPEG"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


@dataclass(frozen=True)
class DecodedImage:
    rgb: np.ndarray  # H x W x 3, uint8
    width: int
    height: int


def decode_image(data: bytes, content_type: str | None, max_bytes: int, max_pixels: int) -> DecodedImage:
    if not data:
        raise ImageRejected(422, "EMPTY_IMAGE", "Request body is empty.")
    if len(data) > max_bytes:
        raise ImageRejected(413, "IMAGE_TOO_LARGE", f"Image exceeds {max_bytes} bytes.")

    declared = (content_type or "").split(";")[0].strip().lower()
    if declared not in ALLOWED_CONTENT_TYPES:
        raise ImageRejected(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be image/jpeg, image/png or image/webp.")

    sniffed = sniff_format(data)
    if sniffed is None or sniffed != ALLOWED_CONTENT_TYPES[declared]:
        raise ImageRejected(415, "CONTENT_MISMATCH", "File signature does not match the declared image type.")

    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format != sniffed:
                raise ImageRejected(415, "CONTENT_MISMATCH", "Decoded format does not match the declared image type.")
            width, height = img.size  # header only; nothing decoded yet
            if width <= 0 or height <= 0 or width * height > max_pixels:
                raise ImageRejected(422, "IMAGE_DIMENSIONS_REJECTED", f"Image dimensions {width}x{height} are not allowed.")
            rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    except ImageRejected:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageRejected(422, "IMAGE_UNDECODABLE", "Image could not be decoded.") from exc

    return DecodedImage(rgb=rgb, width=width, height=height)
