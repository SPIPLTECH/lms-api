"""Checks that the AI can run: every pinned model loads (its SHA-256 is verified on load) and
answers one call. Used by the Docker build, so an image whose models cannot load is never made.

    python scripts/verify_models.py

Exit code 0 when all three models work, 1 otherwise. Uses a blank synthetic image; no photo of
a person is needed or used.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proctor_ai.detectors.base import BoundingBox, FaceDetection  # noqa: E402
from proctor_ai.detectors.blazeface import BlazeFaceDetector  # noqa: E402
from proctor_ai.detectors.efficientdet import EfficientDetObjectDetector  # noqa: E402
from proctor_ai.detectors.sface import SFaceEmbedder  # noqa: E402


def main() -> int:
    manifests = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))
    blank = np.full((480, 640, 3), 128, dtype=np.uint8)
    try:
        face = manifests["blaze_face_short_range"]
        faces = BlazeFaceDetector(ROOT / "models" / face["file"], face["sha256"], face["version"]).detect(blank)
        print(f"[verify-models] blaze_face_short_range: loaded, {len(faces.faces)} face(s) on a blank image")

        obj = manifests["efficientdet_lite0"]
        objects = EfficientDetObjectDetector(ROOT / "models" / obj["file"], obj["sha256"], obj["version"]).detect(blank)
        print(f"[verify-models] efficientdet_lite0: loaded, {len(objects.objects)} object(s) on a blank image")

        ident = manifests["face_recognition_sface"]
        embedder = SFaceEmbedder(ROOT / "models" / ident["file"], ident["sha256"], ident["version"])
        # A made-up face box with plausible keypoints, only to prove the model runs.
        keypoints = ((0.42, 0.42), (0.58, 0.42), (0.5, 0.52), (0.5, 0.62), (0.36, 0.45), (0.64, 0.45))
        result = embedder.embed(blank, FaceDetection(0.9, BoundingBox(0.3, 0.3, 0.4, 0.45), keypoints))
        print(f"[verify-models] face_recognition_sface: loaded, template of {len(result.vector)} values")
    except Exception as error:  # noqa: BLE001 - any failure means the image must not be built
        print(f"[verify-models] FAILED: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print("[verify-models] all models load and run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
