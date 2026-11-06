"""Approximate head orientation from BlazeFace's 6 face keypoints (no extra model).

Geometry, in pixels (so the image aspect ratio does not distort angles):
  * roll  = angle of the eye line;
  * the face is then measured in its own frame: u = along the eye line, v = perpendicular (down);
  * yaw   = where the nose tip sits between the two ear tragions along u. Frontal = halfway (t = 0.5);
            yaw = asin(2t - 1), so a nose at either ear is +/-90 degrees. Positive = nose towards the
            image's right edge (the subject turned to their left);
  * pitch = nose tip depth along v relative to the eye-to-mouth distance. Frontal portraits measured
            0.57-0.62 (NEUTRAL_PITCH_RATIO = 0.6). pitch = asin((r - 0.6) / 0.4); positive = looking
            down. Pitch is uncalibrated and is reported for review only; see docs/AI_PROCTORING.md.

These are coarse estimates for "is the student facing the screen", not a 3D pose solver. Measured on
real public-domain portraits: frontal |yaw| <= 5 degrees, a three-quarter portrait 22-29 degrees, a
turned head 35-47 degrees, a profile 90 degrees (tests/test_headpose.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .detectors.base import FaceDetection

NEUTRAL_PITCH_RATIO = 0.6
PITCH_RATIO_SPAN = 0.4
MIN_EYE_DISTANCE_PX = 6.0
MIN_EYE_WIDTH_FRACTION = 0.018
MIN_EAR_SPAN_EYE_RATIO = 0.75
MAX_RELIABLE_ROLL_DEG = 45.0


@dataclass(frozen=True)
class HeadPose:
    yaw_deg: float
    pitch_deg: float
    roll_deg: float
    #: False when the keypoints are too small or degenerate for a meaningful estimate.
    reliable: bool


def _clip(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def estimate_head_pose(face: FaceDetection, image_width: int, image_height: int) -> HeadPose | None:
    """Returns None when the detection has no keypoints."""
    if len(face.keypoints) != 6 or image_width <= 0 or image_height <= 0:
        return None
    pts = [(x * image_width, y * image_height) for x, y in face.keypoints]
    (rex, rey), (lex, ley), (nx, ny), (mx, my), (rrx, rry), (lrx, lry) = pts

    ex, ey = lex - rex, ley - rey
    eye_dist = math.hypot(ex, ey)
    if eye_dist < 1e-6:
        return HeadPose(0.0, 0.0, 0.0, reliable=False)
    ux, uy = ex / eye_dist, ey / eye_dist
    vx, vy = -uy, ux  # perpendicular; points "down the face" when the eye line runs left-to-right
    if vy < 0:
        vx, vy = -vx, -vy
    roll = math.degrees(math.atan2(ey, ex))

    def along_u(px: float, py: float) -> float:
        return px * ux + py * uy

    def along_v(px: float, py: float) -> float:
        return px * vx + py * vy

    ear_span = along_u(lrx, lry) - along_u(rrx, rry)
    t = (along_u(nx, ny) - along_u(rrx, rry)) / ear_span if abs(ear_span) > 1e-6 else 0.5
    yaw = math.degrees(math.asin(_clip(2.0 * t - 1.0)))

    mid_x, mid_y = (rex + lex) / 2.0, (rey + ley) / 2.0
    mouth_depth = along_v(mx, my) - along_v(mid_x, mid_y)
    nose_depth = along_v(nx, ny) - along_v(mid_x, mid_y)
    if mouth_depth > 1e-6:
        ratio = nose_depth / mouth_depth
        pitch = math.degrees(math.asin(_clip((ratio - NEUTRAL_PITCH_RATIO) / PITCH_RATIO_SPAN)))
    else:
        pitch = 0.0

    min_eye_dist = max(MIN_EYE_DISTANCE_PX, MIN_EYE_WIDTH_FRACTION * image_width)
    reliable = (
        eye_dist >= min_eye_dist
        and mouth_depth > 0
        and abs(ear_span) >= MIN_EAR_SPAN_EYE_RATIO * eye_dist
        and abs(roll) <= MAX_RELIABLE_ROLL_DEG
    )
    return HeadPose(round(yaw, 1), round(pitch, 1), round(roll, 1), reliable=reliable)
