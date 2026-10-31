# Third-party notices: ProctorGuard AI service

Versions are pinned in `requirements.lock.txt` (resolved 2026-10-23, CPython 3.13.13, Windows x64).
Licence identifiers are taken from each package's own metadata and were checked against the upstream
repository where the metadata was empty. **This is an engineering inventory, not legal advice.** See
`docs/AI_STAGE1_AUDIT.md` §3–4 for evidence and open questions.

## Model weights
| Artefact | Licence | Source | Notes |
|---|---|---|---|
| `models/blaze_face_short_range.tflite` (v1, SHA-256 `b4578f35…0152f`) | Apache-2.0 | Google MediaPipe, `storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/` | Model card states Apache-2.0 and training on consented images. The model card lists surveillance/identity recognition as out-of-scope uses (intended-use statement, not a licence term). The file is downloaded at setup and not committed |

Apache-2.0 attribution: "BlazeFace short-range face detection model © Google LLC, licensed under the Apache License, Version 2.0."

| Model | Licence | Source | Notes |
|---|---|---|---|
| `models/face_recognition_sface_2021dec.onnx` (2021dec, SHA-256 `0ba9fbfa…7c34e79`) | Apache-2.0 | OpenCV Zoo (`github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface`), mirrored at `huggingface.co/opencv/face_recognition_sface` | MobileFaceNet trained with the SFace loss (Zhong et al.). The model card does not name the training set; the SFace paper reports experiments on research face datasets (CASIA-WebFace / MS1M family) whose terms restrict use, and the provenance of these exact weights is unconfirmed: **legal review required before production**. Biometric template processing (identity consistency). Downloaded at setup and not committed |

Apache-2.0 attribution: "SFace face recognition model, OpenCV Zoo, licensed under the Apache License, Version 2.0."

## Python runtime packages
| Package | Version | Licence |
|---|---|---|
| ai-edge-litert | 2.3.0 | Apache-2.0 (© Google LLC) |
| flatbuffers | 25.12.19 | Apache-2.0 |
| ml_dtypes | 0.6.0 | Apache-2.0 |
| protobuf | 7.36.2 | BSD-3-Clause |
| tqdm | 4.70.1 | MPL-2.0 AND MIT (unmodified; source available on PyPI) |
| backports.strenum | 1.2.8 | MIT |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| pillow | 13.0.0 | MIT-CMU |
| onnxruntime | 1.31.1 | MIT (© Microsoft Corporation) |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| fastapi | 0.161.1 | MIT |
| starlette | 1.9.0 | BSD-3-Clause |
| pydantic / pydantic_core | 2.14.1 / 2.50.1 | MIT |
| annotated-types / annotated-doc / typing-inspection | 0.8.0 / 0.0.5 / 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| anyio | 4.15.1 | MIT |
| idna | 3.20 | BSD-3-Clause |
| opentelemetry-api | 1.45.1 | Apache-2.0 (API only, no exporter/SDK, so nothing is sent; 0 non-loopback connections observed) |
| uvicorn | 0.54.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| colorama | 0.4.6 | BSD-3-Clause |

## Test-only packages (not required to run the service)
pytest 9.1.1 (MIT), pluggy 1.7.0 (MIT), iniconfig 2.3.1 (MIT), Pygments 2.21.0 (BSD-2-Clause),
packaging 26.3 (Apache-2.0 OR BSD-2-Clause), httpx 0.28.1 and httpcore 1.0.9 (BSD-3-Clause),
certifi 2026.10.19 (MPL-2.0, unmodified).

## Test fixture images
Public-domain NASA portraits from Wikimedia Commons; see `tests/fixtures/README.md`.

## Redistribution
If this service is ever redistributed in packaged form (installer, container image), include this file,
the Apache-2.0 licence text, the MIT/BSD notices of the packages above, and keep MPL-2.0 sources
(tqdm, certifi) available unmodified.
