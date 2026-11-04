"""EfficientDet-Lite0 object detection on real photos (CC0 / public domain fixtures)."""

import json

import numpy as np
import pytest
from PIL import Image

from conftest import ROOT, load_fixture
from proctor_ai.detectors.blazeface import ModelLoadError
from proctor_ai.detectors.efficientdet import EfficientDetObjectDetector

OBJ_MANIFEST = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))["efficientdet_lite0"]
OBJ_PATH = ROOT / "models" / OBJ_MANIFEST["file"]


def make(threshold=0.4, labels=("cell phone",)):
    return EfficientDetObjectDetector(OBJ_PATH, OBJ_MANIFEST["sha256"], OBJ_MANIFEST["version"], threshold, labels)


@pytest.fixture(scope="module")
def phones():
    return make()


@pytest.mark.parametrize("name", ["phone_hand_closeup.jpg", "phone_woman_holding.jpg", "phone_man_laptop.jpg"])
def test_phones_in_real_photos_are_detected(phones, name):
    result = phones.detect(load_fixture(name))
    assert result.objects and all(o.label == "cell phone" and o.score >= 0.4 for o in result.objects)
    for o in result.objects:
        b = o.box
        assert 0 <= b.x <= 1 and 0 <= b.y <= 1 and 0 < b.width <= 1 and 0 < b.height <= 1


@pytest.mark.parametrize(
    "name", ["face_raja_chari.jpg", "face_victor_glover.jpg", "face_sunita_williams.jpg", "head_profiles_two_people.jpg"]
)
def test_portraits_without_phones_report_nothing(phones, name):
    assert phones.detect(load_fixture(name)).objects == []


def wide_frame(phone=True):
    """A wide webcam-like frame: a portrait on the left and, optionally, a phone photo on the right."""
    canvas = Image.new("RGB", (1920, 480), (235, 235, 235))
    canvas.paste(Image.fromarray(load_fixture("face_raja_chari.jpg")).resize((384, 480)), (0, 0))
    if phone:
        canvas.paste(Image.fromarray(load_fixture("phone_hand_closeup.jpg")), (1280, 26))
    return np.asarray(canvas, dtype=np.uint8)


def test_a_phone_the_model_names_a_remote_is_reported_as_a_phone(phones):
    # The model calls a phone held up to text a "remote" (0.43-0.52), as it did with a phone held
    # to a real exam webcam; its own "cell phone" score stays under 0.1.
    assert {o.label for o in phones.detect(load_fixture("head_turned_texting.jpg")).objects} == {"cell phone"}


def test_a_phone_in_a_wide_frame_survives_the_square_resize(phones):
    # Squeezed into 320x320 the phone scores ~0.16; seen undistorted it scores over 0.5.
    found = phones.detect(wide_frame()).objects
    assert found and found[0].label == "cell phone"
    assert found[0].box.x >= 0.6 and found[0].box.x + found[0].box.width <= 1


def test_a_wide_frame_without_a_phone_reports_nothing(phones):
    assert phones.detect(wide_frame(phone=False)).objects == []


def test_raising_object_threshold_blindly_causes_false_negatives_on_angled_phones():
    # Controlled calibration guard: 0.40 catches all real phone fixtures without portrait false positives,
    # whereas an aggressive jump (e.g. 0.75) drops real phone detections.
    strict = make(threshold=0.75)
    detected_at_040 = sum(1 for n in ("phone_hand_closeup.jpg", "phone_woman_holding.jpg", "phone_man_laptop.jpg") if make(0.4).detect(load_fixture(n)).objects)
    detected_at_075 = sum(1 for n in ("phone_hand_closeup.jpg", "phone_woman_holding.jpg", "phone_man_laptop.jpg") if strict.detect(load_fixture(n)).objects)
    assert detected_at_040 == 3
    assert detected_at_075 < detected_at_040


def test_only_configured_labels_are_reported():
    # The laptop in this photo scores ~0.41; it is reported only when asked for.
    assert {o.label for o in make(0.4).detect(load_fixture("phone_man_laptop.jpg")).objects} == {"cell phone"}
    assert "laptop" in {o.label for o in make(0.4, ("cell phone", "laptop")).detect(load_fixture("phone_man_laptop.jpg")).objects}


def test_unknown_labels_and_bad_checksums_refuse_to_load(tmp_path):
    with pytest.raises(ModelLoadError):
        make(labels=("smartwatch",))
    bad = tmp_path / "x.tflite"
    data = bytearray(OBJ_PATH.read_bytes())
    data[1000] ^= 0xFF
    bad.write_bytes(bytes(data))
    with pytest.raises(ModelLoadError):
        EfficientDetObjectDetector(bad, OBJ_MANIFEST["sha256"], "1")
