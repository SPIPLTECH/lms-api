"""EfficientDet-Lite0 object detection on real photos (CC0 / public domain fixtures)."""

import json

import pytest

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
