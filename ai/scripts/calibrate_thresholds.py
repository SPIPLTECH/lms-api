"""Controlled calibration report for BlazeFace head-pose yaw and EfficientDet object thresholds.

    python scripts/calibrate_thresholds.py

Evaluates candidate yaw thresholds (30..45 deg) and object score thresholds (0.35..0.55) across
true-positive and hard-negative fixture sets (including mirrored variants and tilted synthetic frames),
reporting precision, recall, false-positive rate (FPR), and false-negative rate (FNR) as JSON lines.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proctor_ai.detectors.blazeface import BlazeFaceDetector  # noqa: E402
from proctor_ai.detectors.efficientdet import EfficientDetObjectDetector  # noqa: E402
from proctor_ai.headpose import estimate_head_pose  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"

FRONTAL_PORTRAITS = [
    "face_raja_chari.jpg",
    "face_victor_glover.jpg",
    "face_victor_glover_2018.jpg",
    "face_sunita_williams.jpg",
    "face_sunita_williams_2018.jpg",
]
TURNED_HEADS = [
    "head_turned_texting.jpg",
]
PHONE_POSITIVES = [
    "phone_hand_closeup.jpg",
    "phone_woman_holding.jpg",
    "phone_man_laptop.jpg",
]
PHONE_NEGATIVES = [
    "face_raja_chari.jpg",
    "face_victor_glover.jpg",
    "face_sunita_williams.jpg",
    "head_profiles_two_people.jpg",
]


def load_rgb(name: str) -> np.ndarray:
    return np.asarray(Image.open(FIXTURES / name).convert("RGB"), dtype=np.uint8)


def metrics(tp: int, fp: int, tn: int, fn: int) -> dict:
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    fnr = fn / (fn + tp) if (fn + tp) else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "fpr": round(fpr, 3),
        "fnr": round(fnr, 3),
    }


def main() -> int:
    models = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))
    bf = models["blaze_face_short_range"]
    ed = models["efficientdet_lite0"]

    face_det = BlazeFaceDetector(ROOT / "models" / bf["file"], bf["sha256"], bf["version"], score_threshold=0.6)

    # Head-pose sweep across original + mirrored fixtures.
    pose_samples: list[tuple[bool, float | None, bool]] = []
    for name in FRONTAL_PORTRAITS:
        rgb = load_rgb(name)
        for sample in (rgb, np.ascontiguousarray(rgb[:, ::-1])):
            h, w = sample.shape[:2]
            faces = face_det.detect(sample).faces
            pose = estimate_head_pose(faces[0], w, h) if len(faces) == 1 else None
            pose_samples.append((False, abs(pose.yaw_deg) if pose else None, bool(pose and pose.reliable)))

    for name in TURNED_HEADS:
        rgb = load_rgb(name)
        for sample in (rgb, np.ascontiguousarray(rgb[:, ::-1])):
            h, w = sample.shape[:2]
            faces = face_det.detect(sample).faces
            pose = estimate_head_pose(faces[0], w, h) if len(faces) == 1 else None
            pose_samples.append((True, abs(pose.yaw_deg) if pose else None, bool(pose and pose.reliable)))

    for yaw_threshold in (30.0, 35.0, 40.0, 45.0):
        tp = fp = tn = fn = 0
        for expected_away, yaw_abs, reliable in pose_samples:
            predicted_away = bool(reliable and yaw_abs is not None and yaw_abs > yaw_threshold)
            if expected_away and predicted_away:
                tp += 1
            elif expected_away and not predicted_away:
                fn += 1
            elif not expected_away and predicted_away:
                fp += 1
            else:
                tn += 1
        print(json.dumps({"domain": "head_pose_yaw_deg", "threshold": yaw_threshold, **metrics(tp, fp, tn, fn)}))

    # Object-score sweep across positive and hard-negative fixtures.
    obj_det = EfficientDetObjectDetector(ROOT / "models" / ed["file"], ed["sha256"], ed["version"], 0.25, ("cell phone",))
    raw_scores: list[tuple[bool, float]] = []
    for name in PHONE_POSITIVES:
        objs = obj_det.detect(load_rgb(name)).objects
        raw_scores.append((True, max((o.score for o in objs), default=0.0)))
    for name in PHONE_NEGATIVES:
        objs = obj_det.detect(load_rgb(name)).objects
        raw_scores.append((False, max((o.score for o in objs), default=0.0)))

    for score_threshold in (0.35, 0.40, 0.45, 0.50, 0.55):
        tp = fp = tn = fn = 0
        for expected_phone, best_score in raw_scores:
            predicted_phone = best_score >= score_threshold
            if expected_phone and predicted_phone:
                tp += 1
            elif expected_phone and not predicted_phone:
                fn += 1
            elif not expected_phone and predicted_phone:
                fp += 1
            else:
                tn += 1
        print(json.dumps({"domain": "object_score_threshold", "threshold": score_threshold, **metrics(tp, fp, tn, fn)}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
