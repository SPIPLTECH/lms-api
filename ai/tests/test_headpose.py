"""Head-pose geometry (synthetic keypoints) and its behaviour on real public-domain photos."""

import math

import numpy as np
import pytest

from conftest import MANIFEST, MODEL_PATH, load_fixture
from proctor_ai.detectors.base import BoundingBox, FaceDetection
from proctor_ai.detectors.blazeface import BlazeFaceDetector
from proctor_ai.headpose import estimate_head_pose

W, H = 640, 480


def face_from_pixels(points, w=W, h=H):
    return FaceDetection(score=0.9, box=BoundingBox(0.3, 0.3, 0.3, 0.3), keypoints=tuple((x / w, y / h) for x, y in points))


def frontal(cx=320.0, cy=240.0, nose_dx=0.0):
    """Right eye, left eye, nose, mouth, right ear, left ear for a frontal face (nose at 0.6 of eye-mouth)."""
    return [(cx - 40, cy), (cx + 40, cy), (cx + nose_dx, cy + 36), (cx, cy + 60), (cx - 90, cy + 10), (cx + 90, cy + 10)]


def rotate(points, deg, cx=320.0, cy=240.0):
    a = math.radians(deg)
    return [(cx + (x - cx) * math.cos(a) - (y - cy) * math.sin(a), cy + (x - cx) * math.sin(a) + (y - cy) * math.cos(a)) for x, y in points]


def test_frontal_face_is_zero_yaw_pitch_roll():
    pose = estimate_head_pose(face_from_pixels(frontal()), W, H)
    assert pose is not None and pose.reliable
    assert abs(pose.yaw_deg) < 0.5 and abs(pose.pitch_deg) < 0.5 and abs(pose.roll_deg) < 0.5


def test_in_plane_tilt_changes_roll_only():
    pose = estimate_head_pose(face_from_pixels(rotate(frontal(), 30)), W, H)
    assert abs(pose.roll_deg - 30) < 0.5
    assert abs(pose.yaw_deg) < 0.5 and abs(pose.pitch_deg) < 0.5


@pytest.mark.parametrize("dx,sign", [(45, 1), (-45, -1)])
def test_nose_towards_an_ear_gives_signed_yaw(dx, sign):
    pose = estimate_head_pose(face_from_pixels(frontal(nose_dx=dx)), W, H)
    assert sign * pose.yaw_deg == pytest.approx(math.degrees(math.asin(45 / 90)), abs=0.5)


def test_nose_beyond_the_ear_saturates_at_90_degrees():
    assert estimate_head_pose(face_from_pixels(frontal(nose_dx=150)), W, H).yaw_deg == 90.0


def test_missing_keypoints_give_no_estimate_and_degenerate_eyes_are_unreliable():
    assert estimate_head_pose(FaceDetection(score=0.9, box=BoundingBox(0, 0, 1, 1)), W, H) is None
    same = [(320, 240)] * 6
    assert estimate_head_pose(face_from_pixels(same), W, H).reliable is False


def test_extreme_roll_or_compressed_ears_or_tiny_face_is_marked_unreliable():
    # A tilted hand-held webcam (> 45 deg roll) must not trigger false head-pose warnings.
    tilted = estimate_head_pose(face_from_pixels(rotate(frontal(), 65)), W, H)
    assert tilted is not None and tilted.reliable is False

    # Degenerate ear span narrower than 0.75 * eye distance is geometrically unreliable.
    compressed_ears = [(280, 240), (360, 240), (320, 276), (320, 300), (305, 250), (335, 250)]
    assert estimate_head_pose(face_from_pixels(compressed_ears), W, H).reliable is False

    # Distant background face with < 1.8% image-width eye distance is unreliable.
    tiny = [(316, 240), (324, 240), (320, 244), (320, 248), (310, 241), (330, 241)]
    assert estimate_head_pose(face_from_pixels(tiny), W, H).reliable is False


# ---- real model, real photos (public domain / CC0; see tests/fixtures/README.md) ----

DEFAULT_YAW_THRESHOLD = 35.0  # backend default AI_HEAD_POSE_YAW_DEG


@pytest.fixture(scope="module")
def detector():
    return BlazeFaceDetector(MODEL_PATH, MANIFEST["sha256"], MANIFEST["version"], score_threshold=0.6)


def poses(detector, rgb):
    h, w = rgb.shape[:2]
    return [estimate_head_pose(f, w, h) for f in detector.detect(rgb).faces]


@pytest.mark.parametrize("name", ["face_raja_chari.jpg", "face_victor_glover.jpg", "face_sunita_williams.jpg"])
@pytest.mark.parametrize("mirror", [False, True])
def test_portraits_facing_the_camera_stay_below_the_default_threshold(detector, name, mirror):
    rgb = load_fixture(name)
    if mirror:
        rgb = np.ascontiguousarray(rgb[:, ::-1])
    (pose,) = poses(detector, rgb)
    assert pose.reliable and abs(pose.yaw_deg) < DEFAULT_YAW_THRESHOLD


@pytest.mark.parametrize("mirror,sign", [(False, 1), (True, -1)])
def test_a_turned_head_exceeds_the_threshold_with_the_right_direction(detector, mirror, sign):
    rgb = load_fixture("head_turned_texting.jpg")
    if mirror:
        rgb = np.ascontiguousarray(rgb[:, ::-1])
    (pose,) = poses(detector, rgb)
    assert sign * pose.yaw_deg >= DEFAULT_YAW_THRESHOLD


def test_two_profiles_facing_each_other_are_plus_and_minus_90(detector):
    yaws = sorted(p.yaw_deg for p in poses(detector, load_fixture("head_profiles_two_people.jpg")))
    assert yaws == [-90.0, 90.0]
