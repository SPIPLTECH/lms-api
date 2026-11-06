# ProctorGuard backend AI

The Python part of the backend. The backend starts it, supervises it and is the only thing that calls it
(`src/modules/proctoring/ai-process.manager.ts`). It analyses exam webcam snapshots to produce **signals**: face count (absence, another person), approximate head pose, phones (EfficientDet-Lite0)
and, on request, a 1:1 identity feature (SFace) that the backend compares with the student's
pre-exam identity photo. It runs on the CPU, has no cloud dependency, sends no telemetry, and is
called only by the ProctorGuard backend.

> Results are **not proof of misconduct**. Voice activity detection does not run here: it runs in the
> student's browser and only sends durations (frontend/src/services/voiceActivity.ts).

## How it fits
```
browser webcam (existing) → backend /api/proctoring/snapshots (existing auth, ownership, rate limits)
  → backend HttpFaceDetectionAdapter → POST http://127.0.0.1:8008/v1/face-detection (Bearer token)
  → result stored in ProctoringEvidence.faceDetectionResult (existing column)
  → 2+ consecutive NO_FACE / MULTIPLE_FACES snapshots → one server-only review event per run
```
If the service is not configured, not running, slow or failing, snapshots are still saved and marked
"Face analysis unavailable (manual review)"; exams are never affected.

## Requirements
* Windows/macOS/Linux x64, **CPython 3.13** (tested 3.13.13 on Windows 11; 3.14 wheels also exist)
* No GPU. Measured on an AMD Ryzen 5 8500G (see "Performance").

## Setup (once)
```powershell
npm run ai:setup    # from backend/: creates ai/.venv, installs requirements.lock.txt, downloads the models
```
`scripts/download_models.py` fetches the pinned models (`models/models.json`) and deletes a file whose checksum
differs. The process also refuses to load a model whose checksum does not match.

## Turning it on
Add to the backend's env file (`backend/.env.local-dev` for `npm run dev`), then start the backend as usual:
```
AI_SERVICE_URL="http://127.0.0.1:8008"
AI_SERVICE_TOKEN="<at least 32 random characters>"
# optional: AI_SERVICE_TIMEOUT_MS=3000  AI_FACE_ABSENT_CONSECUTIVE=2  AI_FACE_MULTIPLE_CONSECUTIVE=1
```
The backend starts this process with those values, restarts it after a crash (1 s backoff, doubling to 30 s), replaces
it after 3 failed health checks, stops retrying after 5 restarts in 10 minutes, and logs each of those. The process
exits with the backend (`--parent-pid`). All settings come from the backend's env file; the backend's database URL,
JWT secret and seed passwords are not passed on. Without these variables snapshots are kept for manual review.

To run it some other way, set `AI_MANAGED=false` in the backend and start it by hand:
```powershell
.venv\Scripts\python -m proctor_ai --env-file FILE     # listens on 127.0.0.1:8008; stop with Ctrl+C
```

## API (v1, internal)
* `POST /v1/analyze[?objects=false][&identity=true]`: faces with head pose, configured objects and (opt-in)
  `identity: {status: OK|NOT_ONE_FACE|DISABLED|UNAVAILABLE|FAILED, embedding[128], model}`. The feature
  is only computed for exactly one face, never logged, and is a **biometric template**: the backend
  keeps it only for the pre-exam photo, only while the exam runs (see backend `identity.service.ts`).
  Identity model failures degrade to `UNAVAILABLE`/`FAILED` without failing the analysis.
  Disable with `AI_IDENTITY_ENABLED=false`.
* `POST /v1/face-detection`. Headers `Authorization: Bearer <token>`, `Content-Type: image/jpeg|png|webp`. Body: raw image bytes (≤ 2 MB, ≤ 4096×4096 px).
  Returns `{apiVersion, status:"OK", facesDetected, classification: NO_FACE|ONE_FACE|MULTIPLE_FACES, faces[{score, box{x,y,width,height}}], imageWidth, imageHeight, inferenceMs, model{name,version,sha256,scoreThreshold}}`. Boxes are normalised 0–1.
  Errors: `401` bad token · `413` too large · `415` wrong type or signature · `422` undecodable or too many pixels · `503` model not loaded, inference failure or busy. Errors return `{status:"ERROR", code, error, requestId}` without internal details.
* `GET /v1/health` (token required): `{status: ok|degraded, modelLoaded, model, objectModelLoaded, identityModelLoaded, ...}`.
* No CORS, no docs endpoints, loopback bind by default. Logs contain request ids, byte sizes, dimensions, face counts and timings only, never images or tokens.

## Tests and benchmark
```powershell
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python scripts\benchmark.py --runs 200
.venv\Scripts\python scripts\benchmark.py --runs 200 --url http://127.0.0.1:8008 --token <token>
```

## Performance (measured 2026-10-23, AMD Ryzen 5 8500G, Windows 11, 2 threads, 640×480 JPEG)
| Measure | Result |
|---|---|
| Model load (checksum + LiteRT allocate) | 39 ms first run (9 ms warm) |
| In-process decode + detect | p50 3.6 ms · p95 4.5–4.9 ms · max 5.5–7.5 ms (200 runs, two runs) |
| HTTP round trip (client side) | p50 17.2 ms · p95 33.3 ms · max 59.0 ms (200 requests) |
| Server-reported inference | p50 2.65 ms · p95 3.4 ms |
| Service memory (Windows working set) | 64.9 MB idle → 71.2 MB after 201 requests (peak 76.6 MB) |
| Network | 0 non-loopback TCP connections during the run |

These are single-machine measurements; re-run `benchmark.py` on the target hardware.

## Identity matching (SFace)
* Model: OpenCV Zoo `face_recognition_sface_2021dec.onnx` (MobileFaceNet, Apache-2.0, 38.7 MB, SHA-256 pinned
  in `models/models.json`), run with ONNX Runtime. Alignment uses four BlazeFace keypoints and a least-squares
  similarity transform onto the ArcFace template (no OpenCV dependency).
* Measured 2026-10-27 on public-domain NASA portraits (`tests/test_identity.py`): the same person across
  different photo sessions 0.51 and 0.72 cosine similarity; different people at most 0.23; the same photo
  darker/brighter/shifted/rotated/half-resolution 0.94-0.99. The backend threshold defaults to 0.363 (OpenCV's
  documented value). **Not validated on real webcam footage or across demographics**; calibrate before use.
* Legal: biometric processing needs a lawful basis and disclosure (the pre-exam page discloses it), and
  the training-data provenance of the weights is unconfirmed (see `THIRD_PARTY_NOTICES.md`).

## Limitations (read before relying on results)
* **Short-range model:** designed for faces that fill ≥ ~20% of the frame within ~2 m of the camera. A second person further back may **not** be detected (a test composite with ~15%-wide faces was counted as one face). Roll/pitch beyond ~45° and yaw beyond ~90° reduce detection.
* **False positives exist:** at the model's default threshold 0.5 a reflective helmet visor was detected as a face (score 0.516). The default here is 0.6; **calibrate on real webcam footage** before production.
* Quality degrades in poor light, noise and motion (model card). Fairness figures are Google's own (model card), not independently validated here.
* Snapshots are periodic (policy interval), so short events between snapshots are invisible.
* Browser capture can be manipulated (virtual cameras, photos). Results are signals for human review, never proof.
* The model card lists surveillance as an out-of-scope use. **Legal/product review required** (see audit R1).

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `Invalid AI service configuration: AI_SERVICE_TOKEN …` | Set `AI_SERVICE_TOKEN` (≥ 32 characters) in the backend env file |
| Health shows `degraded`, `modelLoaded:false` | Model missing or checksum mismatch: run `npm run ai:setup` |
| Backend gallery shows "Face analysis unavailable" | AI process down, Python environment missing (`npm run ai:setup`), wrong URL, or timeout; check the `[ai]` lines in the backend log |
| "Face analysis failed" with `UNAUTHORIZED` | Backend and service tokens differ |
| `503 BUSY` under load | Raise `AI_BUSY_TIMEOUT_SECONDS` or run more instances behind a private load balancer |
