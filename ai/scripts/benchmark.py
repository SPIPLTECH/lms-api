"""Measure CPU latency of the Stage 1 face detector on this machine.

    python scripts/benchmark.py                       # in-process only
    python scripts/benchmark.py --url http://127.0.0.1:8008 --token <AI_SERVICE_TOKEN>   # plus HTTP round trip

Reports load time and p50/p95/max latency over N runs on a 640x480 JPEG built from a public-domain
fixture. No numbers are hard-coded anywhere: re-run on the target machine.
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proctor_ai.detectors.blazeface import BlazeFaceDetector  # noqa: E402
from proctor_ai.imaging import decode_image  # noqa: E402


def webcam_like_jpeg() -> bytes:
    """640x480 frame: a fixture portrait centred on a grey background (typical webcam framing)."""
    face = Image.open(ROOT / "tests" / "fixtures" / "face_victor_glover.jpg").convert("RGB")
    face = face.resize((360, 480))
    frame = Image.new("RGB", (640, 480), (128, 128, 128))
    frame.paste(face, (140, 0))
    buf = io.BytesIO()
    frame.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def summarise(label: str, samples_ms: list[float]) -> dict:
    s = sorted(samples_ms)
    out = {
        "label": label,
        "runs": len(s),
        "p50_ms": round(statistics.median(s), 2),
        "p95_ms": round(s[int(0.95 * (len(s) - 1))], 2),
        "max_ms": round(s[-1], 2),
        "mean_ms": round(statistics.fmean(s), 2),
    }
    print(json.dumps(out))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=200)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--url")
    ap.add_argument("--token")
    args = ap.parse_args()

    manifest = json.loads((ROOT / "models" / "models.json").read_text(encoding="utf-8"))["blaze_face_short_range"]
    t0 = time.perf_counter()
    det = BlazeFaceDetector(ROOT / "models" / manifest["file"], manifest["sha256"], manifest["version"], num_threads=args.threads)
    print(json.dumps({"label": "model_load", "ms": round((time.perf_counter() - t0) * 1000, 1), "threads": args.threads}))

    jpeg = webcam_like_jpeg()
    first = det.detect(decode_image(jpeg, "image/jpeg", 2 << 20, 4096 * 4096).rgb)
    print(json.dumps({"label": "sanity", "jpeg_bytes": len(jpeg), "faces": first.faces_detected, "classification": first.classification}))

    samples = []
    for _ in range(args.runs):
        t = time.perf_counter()
        det.detect(decode_image(jpeg, "image/jpeg", 2 << 20, 4096 * 4096).rgb)
        samples.append((time.perf_counter() - t) * 1000)
    summarise("in_process_decode_and_detect_640x480", samples)

    if args.url and args.token:
        samples = []
        server_ms = []
        for _ in range(args.runs):
            req = urllib.request.Request(
                args.url.rstrip("/") + "/v1/face-detection",
                data=jpeg,
                headers={"Authorization": f"Bearer {args.token}", "Content-Type": "image/jpeg"},
                method="POST",
            )
            t = time.perf_counter()
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read())
            samples.append((time.perf_counter() - t) * 1000)
            server_ms.append(body["inferenceMs"])
        summarise("http_round_trip_640x480", samples)
        summarise("server_reported_inference", server_ms)
    return 0


if __name__ == "__main__":
    sys.exit(main())
