"""Input validation and fail-closed configuration."""

import numpy as np
import pytest

from conftest import TOKEN, jpeg_bytes, png_bytes
from proctor_ai.config import ConfigError, load_settings
from proctor_ai.imaging import ImageRejected, decode_image

LIMIT = 2 * 1024 * 1024


def rejected(data, ctype, max_bytes=LIMIT, max_pixels=4096 * 4096) -> ImageRejected:
    with pytest.raises(ImageRejected) as info:
        decode_image(data, ctype, max_bytes, max_pixels)
    return info.value


def test_valid_jpeg_and_png_decode_to_rgb(small_image):
    for data, ctype in ((jpeg_bytes(small_image), "image/jpeg"), (png_bytes(small_image), "image/png")):
        img = decode_image(data, ctype, LIMIT, 4096 * 4096)
        assert img.rgb.shape == (48, 64, 3) and img.rgb.dtype == np.uint8
        assert (img.width, img.height) == (64, 48)


def test_empty_body_is_rejected():
    assert rejected(b"", "image/jpeg").code == "EMPTY_IMAGE"


def test_oversized_body_is_rejected(small_image):
    r = rejected(jpeg_bytes(small_image), "image/jpeg", max_bytes=100)
    assert (r.status, r.code) == (413, "IMAGE_TOO_LARGE")


def test_unsupported_content_type_is_rejected(small_image):
    r = rejected(jpeg_bytes(small_image), "image/gif")
    assert (r.status, r.code) == (415, "UNSUPPORTED_MEDIA_TYPE")


def test_declared_type_must_match_file_signature(small_image):
    r = rejected(png_bytes(small_image), "image/jpeg")
    assert (r.status, r.code) == (415, "CONTENT_MISMATCH")


def test_html_disguised_as_jpeg_is_rejected():
    assert rejected(b"<html><script>alert(1)</script></html>", "image/jpeg").code == "CONTENT_MISMATCH"


def test_truncated_jpeg_is_undecodable(small_image):
    data = jpeg_bytes(small_image)[:40]
    assert rejected(data, "image/jpeg").code == "IMAGE_UNDECODABLE"


def test_pixel_bomb_is_rejected_from_header_before_decoding():
    big = np.zeros((300, 300, 3), dtype=np.uint8)
    r = rejected(png_bytes(big), "image/png", max_pixels=200 * 200)
    assert (r.status, r.code) == (422, "IMAGE_DIMENSIONS_REJECTED")


def test_service_refuses_to_start_without_a_strong_token():
    with pytest.raises(ConfigError, match="AI_SERVICE_TOKEN"):
        load_settings({})
    with pytest.raises(ConfigError, match="AI_SERVICE_TOKEN"):
        load_settings({"AI_SERVICE_TOKEN": "short"})


def test_service_refuses_non_loopback_bind_without_explicit_opt_in():
    with pytest.raises(ConfigError, match="loopback"):
        load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_HOST": "0.0.0.0"})
    assert load_settings({"AI_SERVICE_TOKEN": TOKEN}).host == "127.0.0.1"


def test_invalid_numeric_settings_are_rejected():
    with pytest.raises(ConfigError, match="AI_FACE_SCORE_THRESHOLD"):
        load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_FACE_SCORE_THRESHOLD": "2"})
    with pytest.raises(ConfigError, match="AI_WORKERS"):
        load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_WORKERS": "0"})
    with pytest.raises(ConfigError, match="AI_OBJECT_SCORE_THRESHOLD"):
        load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_OBJECT_SCORE_THRESHOLD": "1.5"})
    with pytest.raises(ConfigError, match="AI_OBJECT_LABELS"):
        load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_OBJECT_LABELS": ",".join(f"label{i}" for i in range(11))})


def test_object_and_pool_defaults_and_overrides():
    s = load_settings({"AI_SERVICE_TOKEN": TOKEN})
    assert s.workers == 2 and s.objects_enabled and s.object_labels == ("cell phone",) and s.object_score_threshold == 0.4
    s = load_settings({"AI_SERVICE_TOKEN": TOKEN, "AI_OBJECT_LABELS": "cell phone, book ,cell phone", "AI_OBJECTS_ENABLED": "false"})
    assert s.object_labels == ("cell phone", "book") and s.objects_enabled is False
