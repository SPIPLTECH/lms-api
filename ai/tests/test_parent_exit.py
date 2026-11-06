"""The backend starts this process with --parent-pid. If the backend dies for any reason (crash, kill,
`tsx watch` restart), the AI process must not be left behind holding the port."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN = "p" * 40


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _healthy(port: int) -> bool:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/health", headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError):
        return False


def _start_ai(port: int, parent_pid: int) -> subprocess.Popen:
    env = {**os.environ, "AI_SERVICE_TOKEN": TOKEN, "AI_PORT": str(port), "AI_HOST": "127.0.0.1"}
    return subprocess.Popen(
        [sys.executable, "-m", "proctor_ai", "--parent-pid", str(parent_pid)],
        cwd=ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.kill()
        process.wait()


def test_exits_when_the_parent_is_killed():
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    port = _free_port()
    ai = _start_ai(port, parent.pid)
    try:
        deadline = time.monotonic() + 30
        while not _healthy(port):
            assert ai.poll() is None, "the service exited during startup"
            assert time.monotonic() < deadline, "the service did not become healthy"
            time.sleep(0.2)

        parent.kill()
        parent.wait()
        ai.wait(timeout=10)
        assert not _healthy(port)
    finally:
        _stop(ai)
        _stop(parent)


def test_exits_at_once_when_the_parent_is_already_gone():
    parent = subprocess.Popen([sys.executable, "-c", "pass"])
    parent.wait()
    ai = _start_ai(_free_port(), parent.pid)
    try:
        ai.wait(timeout=10)
    finally:
        _stop(ai)
