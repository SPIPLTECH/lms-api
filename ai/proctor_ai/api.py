"""Versioned, authenticated HTTP API (internal use by the ProctorGuard Node.js backend only).

Security properties:
  * every route requires `Authorization: Bearer <AI_SERVICE_TOKEN>` (constant-time comparison);
  * request bodies are streamed with a hard byte cap (no unbounded buffering);
  * images are validated (type, signature, size, pixel count) and processed in memory only;
  * inference runs on a fixed pool of AI_WORKERS model instances; a request that cannot get a free
    instance within the busy timeout gets 503 (bounded CPU and memory under load);
  * logs contain request ids, sizes, timings and counts only, never images or tokens;
  * no CORS: browsers cannot call this service directly.

Routes:
  * GET  /v1/health          model status;
  * POST /v1/face-detection  Stage 1 contract (face count), kept for compatibility;
  * POST /v1/analyze         faces + per-face head pose + configured objects (one image decode);
                             with `?identity=true`, also the SFace identity feature of a single face.
"""

from __future__ import annotations

import hmac
import json
import logging
import queue
import uuid
from typing import Callable, Literal, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import API_VERSION
from .config import Settings
from .detectors.base import FaceDetection, FaceDetector, FaceEmbedder, ModelInfo, ObjectDetector, classify_face_count
from .headpose import estimate_head_pose
from .imaging import ImageRejected, decode_image

log = logging.getLogger("proctor_ai")


class BoxOut(BaseModel):
    x: float
    y: float
    width: float
    height: float


class HeadPoseOut(BaseModel):
    yawDeg: float
    pitchDeg: float
    rollDeg: float
    reliable: bool


class FaceOut(BaseModel):
    score: float
    box: BoxOut


class AnalyzedFaceOut(FaceOut):
    headPose: Optional[HeadPoseOut] = None


class ModelOut(BaseModel):
    name: str
    version: str
    sha256: str
    scoreThreshold: float


class FaceDetectionResponse(BaseModel):
    apiVersion: Literal["v1"] = "v1"
    status: Literal["OK"] = "OK"
    facesDetected: int
    classification: Literal["NO_FACE", "ONE_FACE", "MULTIPLE_FACES"]
    faces: list[FaceOut]
    imageWidth: int
    imageHeight: int
    inferenceMs: float
    model: ModelOut


class ObjectOut(BaseModel):
    label: str
    score: float
    box: BoxOut


class FacesSection(BaseModel):
    count: int
    classification: Literal["NO_FACE", "ONE_FACE", "MULTIPLE_FACES"]
    items: list[AnalyzedFaceOut]
    inferenceMs: float
    model: ModelOut


class ObjectsSection(BaseModel):
    #: DISABLED = turned off by configuration or request; UNAVAILABLE = model not loaded.
    status: Literal["OK", "DISABLED", "UNAVAILABLE"]
    labels: list[str] = []
    items: list[ObjectOut] = []
    inferenceMs: float = 0.0
    model: Optional[ModelOut] = None


class IdentitySection(BaseModel):
    #: OK = feature of the single face; NOT_ONE_FACE = no face or several (no feature); DISABLED = not
    #: requested or turned off; UNAVAILABLE = model not loaded; FAILED = the face could not be embedded.
    status: Literal["OK", "NOT_ONE_FACE", "DISABLED", "UNAVAILABLE", "FAILED"]
    #: L2-normalised 128-d feature (biometric template): never logged; the backend keeps only the baseline.
    embedding: Optional[list[float]] = None
    inferenceMs: float = 0.0
    model: Optional[ModelOut] = None


class AnalyzeResponse(BaseModel):
    apiVersion: Literal["v1"] = "v1"
    status: Literal["OK"] = "OK"
    imageWidth: int
    imageHeight: int
    faces: FacesSection
    objects: ObjectsSection
    identity: IdentitySection = IdentitySection(status="DISABLED")
    totalMs: float


class HealthResponse(BaseModel):
    apiVersion: Literal["v1"] = "v1"
    status: Literal["ok", "degraded"]
    modelLoaded: bool
    model: Optional[ModelOut] = None
    reason: Optional[str] = None
    workers: int = 0
    objectModelLoaded: bool = False
    objectModel: Optional[ModelOut] = None
    objectReason: Optional[str] = None
    identityModelLoaded: bool = False
    identityModel: Optional[ModelOut] = None
    identityReason: Optional[str] = None


def _model_out(info: ModelInfo) -> ModelOut:
    return ModelOut(name=info.name, version=info.version, sha256=info.sha256, scoreThreshold=info.score_threshold)


def _box(b) -> BoxOut:
    return BoxOut(x=b.x, y=b.y, width=b.width, height=b.height)


def _error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"apiVersion": API_VERSION, "status": "ERROR", "code": code, "error": message, "requestId": request_id},
    )


class _Worker:
    """One independent set of model instances; used by one request at a time."""

    def __init__(self, faces: FaceDetector, objects: ObjectDetector | None, embedder: FaceEmbedder | None = None):
        self.faces = faces
        self.objects = objects
        self.embedder = embedder


def create_app(
    settings: Settings,
    detector_factory: Callable[[], FaceDetector],
    object_detector_factory: Callable[[], ObjectDetector] | None = None,
    embedder_factory: Callable[[], FaceEmbedder] | None = None,
) -> FastAPI:
    """Factories are called once per worker at startup. If the face model cannot load, the service
    still starts but reports `degraded` and answers 503, so the backend can fall back safely. If only
    the object or identity model cannot load, face analysis keeps working and that section reports
    UNAVAILABLE."""
    app = FastAPI(title="ProctorGuard AI service", version="2.1.0", docs_url=None, redoc_url=None, openapi_url=None)

    pool: "queue.Queue[_Worker]" = queue.Queue()
    state: dict[str, object] = {
        "face_info": None,
        "load_error": None,
        "object_info": None,
        "object_error": None,
        "identity_info": None,
        "identity_error": None,
    }
    workers: list[_Worker] = []
    try:
        for _ in range(settings.workers):
            face = detector_factory()
            obj = None
            if settings.objects_enabled and object_detector_factory is not None and state["object_error"] is None:
                try:
                    obj = object_detector_factory()
                except Exception as exc:  # noqa: BLE001 - objects degrade independently of faces
                    state["object_error"] = str(exc)
                    log.error("object model load failed: %s", exc)
            emb = None
            if settings.identity_enabled and embedder_factory is not None and state["identity_error"] is None:
                try:
                    emb = embedder_factory()
                except Exception as exc:  # noqa: BLE001 - identity degrades independently of faces
                    state["identity_error"] = str(exc)
                    log.error("identity model load failed: %s", exc)
            workers.append(_Worker(face, obj, emb))
    except Exception as exc:  # noqa: BLE001 - surfaced as a degraded health state
        workers.clear()
        state["load_error"] = str(exc)
        log.error("model load failed: %s", exc)
    for w in workers:
        # All-or-nothing, so every worker answers the same way.
        if state["object_error"] is not None:
            w.objects = None
        if state["identity_error"] is not None:
            w.embedder = None
    for w in workers:
        pool.put(w)
    if workers:
        state["face_info"] = workers[0].faces.info
        if workers[0].objects is not None:
            state["object_info"] = workers[0].objects.info
        if workers[0].embedder is not None:
            state["identity_info"] = workers[0].embedder.info

    def optional_reason(info_key: str, enabled: bool, factory) -> Optional[str]:
        if state[info_key] is not None:
            return None
        return "disabled" if not enabled or factory is None else "model not loaded"

    def authorised(request: Request) -> bool:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            return False
        return hmac.compare_digest(header[len("Bearer ") :].encode(), settings.token.encode())

    async def read_capped(request: Request) -> bytes:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > settings.max_image_bytes:
                    raise ImageRejected(413, "IMAGE_TOO_LARGE", f"Image exceeds {settings.max_image_bytes} bytes.")
            except ValueError as exc:
                raise ImageRejected(400, "BAD_CONTENT_LENGTH", "Invalid Content-Length.") from exc
        chunks: list[bytes] = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > settings.max_image_bytes:
                raise ImageRejected(413, "IMAGE_TOO_LARGE", f"Image exceeds {settings.max_image_bytes} bytes.")
            chunks.append(chunk)
        return b"".join(chunks)

    async def run_on_worker(job: Callable[[_Worker], object]):
        """Runs `job` on a free worker in the thread pool. Returns None when all workers stay busy."""

        def run():
            try:
                worker = pool.get(timeout=settings.busy_timeout_seconds)
            except queue.Empty:
                return None
            try:
                return job(worker)
            finally:
                pool.put(worker)

        return await run_in_threadpool(run)

    async def read_image(request: Request, request_id: str):
        body = await read_capped(request)
        image = decode_image(body, request.headers.get("content-type"), settings.max_image_bytes, settings.max_pixels)
        return body, image

    @app.get("/v1/health", response_model=HealthResponse)
    async def health(request: Request):
        request_id = uuid.uuid4().hex[:12]
        if not authorised(request):
            return _error(401, "UNAUTHORIZED", "Missing or invalid service token.", request_id)
        face_info = state["face_info"]
        if face_info is None:
            return HealthResponse(status="degraded", modelLoaded=False, reason="model not loaded")
        object_info = state["object_info"]
        identity_info = state["identity_info"]
        return HealthResponse(
            status="ok",
            modelLoaded=True,
            model=_model_out(face_info),  # type: ignore[arg-type]
            workers=len(workers),
            objectModelLoaded=object_info is not None,
            objectModel=_model_out(object_info) if object_info is not None else None,  # type: ignore[arg-type]
            objectReason=optional_reason("object_info", settings.objects_enabled, object_detector_factory),
            identityModelLoaded=identity_info is not None,
            identityModel=_model_out(identity_info) if identity_info is not None else None,  # type: ignore[arg-type]
            identityReason=optional_reason("identity_info", settings.identity_enabled, embedder_factory),
        )

    @app.post("/v1/face-detection", response_model=FaceDetectionResponse)
    async def face_detection(request: Request):
        request_id = uuid.uuid4().hex[:12]
        if not authorised(request):
            return _error(401, "UNAUTHORIZED", "Missing or invalid service token.", request_id)
        if state["face_info"] is None:
            return _error(503, "MODEL_UNAVAILABLE", "Face detection model is not loaded.", request_id)

        try:
            body, image = await read_image(request, request_id)
        except ImageRejected as rej:
            log.info(json.dumps({"requestId": request_id, "event": "rejected", "code": rej.code}))
            return _error(rej.status, rej.code, rej.message, request_id)

        try:
            out = await run_on_worker(lambda w: (w.faces.detect(image.rgb), w.faces.info))
        except Exception as exc:  # noqa: BLE001 - model/runtime failure
            log.error(json.dumps({"requestId": request_id, "event": "inference_error", "type": type(exc).__name__}))
            return _error(503, "INFERENCE_FAILED", "Face detection failed.", request_id)
        if out is None:
            return _error(503, "BUSY", "Service is busy; retry later.", request_id)
        result, info = out

        log.info(
            json.dumps(
                {
                    "requestId": request_id,
                    "event": "face_detection",
                    "bytes": len(body),
                    "width": image.width,
                    "height": image.height,
                    "faces": result.faces_detected,
                    "ms": result.inference_ms,
                }
            )
        )
        return FaceDetectionResponse(
            facesDetected=result.faces_detected,
            classification=result.classification,
            faces=[FaceOut(score=f.score, box=_box(f.box)) for f in result.faces],
            imageWidth=image.width,
            imageHeight=image.height,
            inferenceMs=result.inference_ms,
            model=_model_out(info),
        )

    @app.post("/v1/analyze", response_model=AnalyzeResponse)
    async def analyze(request: Request):
        request_id = uuid.uuid4().hex[:12]
        if not authorised(request):
            return _error(401, "UNAUTHORIZED", "Missing or invalid service token.", request_id)
        if state["face_info"] is None:
            return _error(503, "MODEL_UNAVAILABLE", "Face detection model is not loaded.", request_id)
        want_objects = request.query_params.get("objects", "true").lower() != "false"
        # Opt-in: the feature is a biometric template, so it is computed only when the caller asks.
        want_identity = request.query_params.get("identity", "false").lower() == "true"

        try:
            body, image = await read_image(request, request_id)
        except ImageRejected as rej:
            log.info(json.dumps({"requestId": request_id, "event": "rejected", "code": rej.code}))
            return _error(rej.status, rej.code, rej.message, request_id)

        def identity_of(w: _Worker, faces) -> IdentitySection:
            if not want_identity or not settings.identity_enabled or embedder_factory is None:
                return IdentitySection(status="DISABLED")
            if w.embedder is None:
                return IdentitySection(status="UNAVAILABLE")
            if faces.faces_detected != 1:
                return IdentitySection(status="NOT_ONE_FACE", model=_model_out(w.embedder.info))
            try:
                result = w.embedder.embed(image.rgb, faces.faces[0])
            except Exception as exc:  # noqa: BLE001 - one bad crop must not fail the whole analysis
                log.error(json.dumps({"requestId": request_id, "event": "identity_error", "type": type(exc).__name__}))
                return IdentitySection(status="FAILED", model=_model_out(w.embedder.info))
            return IdentitySection(
                status="OK",
                embedding=[round(float(v), 6) for v in result.vector],
                inferenceMs=result.inference_ms,
                model=_model_out(w.embedder.info),
            )

        def job(w: _Worker):
            faces = w.faces.detect(image.rgb)
            objects = w.objects.detect(image.rgb) if (want_objects and w.objects is not None) else None
            identity = identity_of(w, faces)
            return faces, w.faces.info, objects, (w.objects.info if w.objects is not None else None), (w.objects.labels if w.objects else ()), identity

        try:
            out = await run_on_worker(job)
        except Exception as exc:  # noqa: BLE001 - model/runtime failure
            log.error(json.dumps({"requestId": request_id, "event": "inference_error", "type": type(exc).__name__}))
            return _error(503, "INFERENCE_FAILED", "Image analysis failed.", request_id)
        if out is None:
            return _error(503, "BUSY", "Service is busy; retry later.", request_id)
        faces, face_info, objects, object_info, labels, identity = out

        def face_out(f: FaceDetection) -> AnalyzedFaceOut:
            pose = estimate_head_pose(f, image.width, image.height)
            return AnalyzedFaceOut(
                score=f.score,
                box=_box(f.box),
                headPose=HeadPoseOut(yawDeg=pose.yaw_deg, pitchDeg=pose.pitch_deg, rollDeg=pose.roll_deg, reliable=pose.reliable)
                if pose is not None
                else None,
            )

        if objects is not None:
            objects_section = ObjectsSection(
                status="OK",
                labels=list(labels),
                items=[ObjectOut(label=o.label, score=o.score, box=_box(o.box)) for o in objects.objects],
                inferenceMs=objects.inference_ms,
                model=_model_out(object_info),
            )
        elif want_objects and settings.objects_enabled and object_detector_factory is not None:
            objects_section = ObjectsSection(status="UNAVAILABLE")
        else:
            objects_section = ObjectsSection(status="DISABLED")

        count = faces.faces_detected
        total_ms = round(faces.inference_ms + (objects.inference_ms if objects is not None else 0.0) + identity.inferenceMs, 2)
        log.info(
            json.dumps(
                {
                    "requestId": request_id,
                    "event": "analyze",
                    "bytes": len(body),
                    "width": image.width,
                    "height": image.height,
                    "faces": count,
                    "objects": len(objects_section.items),
                    "identity": identity.status,  # status only: the feature itself is never logged
                    "ms": total_ms,
                }
            )
        )
        return AnalyzeResponse(
            imageWidth=image.width,
            imageHeight=image.height,
            faces=FacesSection(
                count=count,
                classification=classify_face_count(count),
                items=[face_out(f) for f in faces.faces],
                inferenceMs=faces.inference_ms,
                model=_model_out(face_info),
            ),
            objects=objects_section,
            identity=identity,
            totalMs=total_ms,
        )

    return app
