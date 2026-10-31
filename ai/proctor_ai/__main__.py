"""The backend's AI process. The backend normally starts it itself (src/modules/proctoring/ai-process.manager.ts).

To run it by hand:  python -m proctor_ai [--env-file FILE]

Binds to 127.0.0.1:8008 by default. Stop with Ctrl+C.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

from .config import SERVICE_ROOT, ConfigError, load_settings, read_env_file


def build_app(settings):
    from .api import create_app
    from .detectors.blazeface import BlazeFaceDetector
    from .detectors.efficientdet import EfficientDetObjectDetector
    from .detectors.sface import SFaceEmbedder

    manifests = json.loads((SERVICE_ROOT / "models" / "models.json").read_text(encoding="utf-8"))
    manifest = manifests["blaze_face_short_range"]
    object_manifest = manifests["efficientdet_lite0"]
    identity_manifest = manifests["face_recognition_sface"]

    def factory():
        return BlazeFaceDetector(
            model_path=settings.model_path,
            expected_sha256=manifest["sha256"],
            version=manifest["version"],
            score_threshold=settings.score_threshold,
            num_threads=settings.num_threads,
        )

    def object_factory():
        return EfficientDetObjectDetector(
            model_path=settings.object_model_path,
            expected_sha256=object_manifest["sha256"],
            version=object_manifest["version"],
            score_threshold=settings.object_score_threshold,
            labels=settings.object_labels,
            num_threads=settings.num_threads,
        )

    def identity_factory():
        return SFaceEmbedder(
            model_path=settings.identity_model_path,
            expected_sha256=identity_manifest["sha256"],
            version=identity_manifest["version"],
            num_threads=settings.num_threads,
        )

    return create_app(
        settings,
        factory,
        object_factory if settings.objects_enabled else None,
        identity_factory if settings.identity_enabled else None,
    )


def _wait_for_process_exit(pid: int) -> None:
    if sys.platform == "win32":
        # Not os.kill(pid, 0): on Windows that terminates the process. Holding a handle also rules out
        # a reused pid. A pid that no longer exists gives no handle, which counts as already gone.
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.OpenProcess.argtypes = (ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong)
        kernel32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_ulong)
        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        handle = kernel32.OpenProcess(synchronize, 0, pid)
        if handle:
            kernel32.WaitForSingleObject(handle, infinite)
        return
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            pass
        time.sleep(1)


def exit_with_parent(pid: int) -> None:
    """Exits when the given process ends, however it ends, so an orphan never keeps the port.

    The pid is passed in because os.getppid() is the virtualenv launcher on Windows, which outlives the
    backend. Stdin is not used as the signal: on Windows a blocking read on it hangs native library
    loading (numpy's import never returned)."""

    def watch() -> None:
        _wait_for_process_exit(pid)
        os._exit(0)

    threading.Thread(target=watch, name="parent-watch", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="proctor_ai")
    parser.add_argument("--env-file", type=Path, help="optional KEY=VALUE file")
    parser.add_argument("--parent-pid", type=int, help="exit when this process ends (used by the backend)")
    args = parser.parse_args(argv)

    if args.parent_pid is not None:
        exit_with_parent(args.parent_pid)

    env = dict(os.environ)
    if args.env_file:
        env.update(read_env_file(args.env_file))
    try:
        settings = load_settings(env)
    except ConfigError as exc:
        print(f"[proctor_ai] {exc}", file=sys.stderr)
        return 2

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    import uvicorn

    # access_log=False: the default access log adds nothing useful and we keep logs minimal.
    uvicorn.run(build_app(settings), host=settings.host, port=settings.port, access_log=False, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
