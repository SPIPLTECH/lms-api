"""Download the pinned model files listed in models/models.json and verify their SHA-256.

    python scripts/download_models.py

A file whose checksum does not match is deleted and the script exits non-zero.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    manifest = json.loads((MODELS / "models.json").read_text(encoding="utf-8"))
    ok = True
    for name, spec in manifest.items():
        target = MODELS / spec["file"]
        if target.exists() and sha256_of(target) == spec["sha256"]:
            print(f"[models] {name}: present, checksum OK")
            continue
        print(f"[models] {name}: downloading v{spec['version']} ({spec['license']}) ...")
        tmp = target.with_suffix(".part")
        with urllib.request.urlopen(spec["url"], timeout=120) as resp, tmp.open("wb") as out:
            while chunk := resp.read(65536):
                out.write(chunk)
        if spec.get("archive") == "tar.gz":
            # Verify the archive itself first, then extract exactly one named member (no path handling).
            if sha256_of(tmp) != spec["archive_sha256"]:
                tmp.unlink(missing_ok=True)
                print(f"[models] {name}: ARCHIVE CHECKSUM MISMATCH; file removed", file=sys.stderr)
                ok = False
                continue
            with tarfile.open(tmp, "r:gz") as tar:
                member = tar.getmember(spec["archive_member"])
                if not member.isfile() or member.size > 64 * 1024 * 1024:
                    raise SystemExit(f"[models] {name}: unexpected archive member")
                data = tar.extractfile(member).read()  # type: ignore[union-attr]
            tmp.write_bytes(data)
        actual = sha256_of(tmp)
        if actual != spec["sha256"]:
            tmp.unlink(missing_ok=True)
            print(f"[models] {name}: CHECKSUM MISMATCH (got {actual}); file removed", file=sys.stderr)
            ok = False
            continue
        tmp.replace(target)
        print(f"[models] {name}: saved {target.name}, checksum OK")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
