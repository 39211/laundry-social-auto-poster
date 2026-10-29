#!/usr/bin/env python3
"""Pack product-kit-v1.1 into a deliverable zip with a secrets gate.

Fails if the archive would include any real secrets/*.json (non-example),
__pycache__, or .pyc/.pyo. Clean pack also skips _tmp* junk paths.
Runnable on Linux and Windows (Python 3.11+).
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

KIT_ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = KIT_ROOT.parent / "output" / "p3-line-oa-product-kit-v1.1.zip"

# secrets/<name>.json directly under a secrets/ folder — examples end with .example
FORBIDDEN_SECRET_JSON = re.compile(r"(?:^|/)secrets/[^/]+\.json$")

SKIP_DIR_NAMES = {"__pycache__", ".git"}
SKIP_SUFFIXES = {".pyc", ".pyo"}
SKIP_NAME_PREFIXES = ("_tmp",)


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("./")



def utf8_arcname(path: Path, root: Path) -> str:
    """Build a zip member name that is valid UTF-8.

    After a naive ``unzip`` on Linux, Chinese filenames may land as
    surrogate-escaped or latin-1-misdecoded strings. Recover original
    bytes and decode as UTF-8 so box-side repacks still work.
    """
    rel = path.relative_to(root)
    parts: list[str] = []
    for part in rel.parts:
        try:
            part.encode("utf-8")
            parts.append(part)
            continue
        except UnicodeEncodeError:
            pass
        raw: bytes | None = None
        try:
            raw = part.encode("utf-8", errors="surrogateescape")
        except UnicodeEncodeError:
            raw = None
        if raw is None:
            try:
                # Common unzip mojibake: each byte became a U+00xx code point
                raw = part.encode("latin-1")
            except UnicodeEncodeError as exc:
                raise RuntimeError(
                    "Pack failed: path is not valid UTF-8 "
                    f"(fix filename encoding or re-extract with Python zipfile): {part!r}"
                ) from exc
        decoded = None
        for encoding in ("utf-8", "cp950", "big5hkscs", "gbk"):
            try:
                candidate = raw.decode(encoding)
                candidate.encode("utf-8")
                decoded = candidate
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            raise RuntimeError(
                "Pack failed: path is not valid UTF-8 "
                f"(fix filename encoding or re-extract with Python zipfile): {part!r}"
            )
        parts.append(decoded)
    return "/".join(parts)


def forbidden_secret_members(namelist: list[str]) -> list[str]:
    """Return zip member names that look like real secrets JSON (not *.example)."""
    bad: list[str] = []
    for name in namelist:
        norm = normalize_member(name)
        if FORBIDDEN_SECRET_JSON.search(norm) and not norm.endswith(".example"):
            bad.append(norm)
    return bad


def forbidden_pycache_members(namelist: list[str]) -> list[str]:
    """Return zip members that contain __pycache__ or .pyc/.pyo bytecode."""
    bad: list[str] = []
    for name in namelist:
        norm = normalize_member(name)
        parts = norm.split("/")
        if "__pycache__" in parts or norm.endswith((".pyc", ".pyo")):
            bad.append(norm)
    return bad


def should_skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    if any(part in SKIP_DIR_NAMES for part in rel.parts):
        return True
    if any(part.startswith(SKIP_NAME_PREFIXES) for part in rel.parts):
        return True
    if path.name.startswith(SKIP_NAME_PREFIXES):
        return True
    if path.suffix in SKIP_SUFFIXES:
        return True
    # Never pack real secret JSON files from the workspace
    if len(rel.parts) >= 2 and rel.parts[0] == "secrets" and path.suffix == ".json":
        return True
    return False


def collect_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if should_skip(path, root):
            continue
        files.append(path)
    return files


def build_zip(root: Path, out: Path) -> list[str]:
    out.parent.mkdir(parents=True, exist_ok=True)
    members: list[str] = []
    # Write to a temp sibling then replace, so a failed gate does not leave a bad zip
    tmp = out.with_suffix(out.suffix + ".tmp")
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in collect_files(root):
                arcname = utf8_arcname(path, root)
                # Ensure ZipInfo language encoding flag for non-ASCII names
                info = zipfile.ZipInfo(arcname)
                info.compress_type = zipfile.ZIP_DEFLATED
                if any(ord(ch) > 127 for ch in arcname):
                    info.flag_bits |= 0x800  # UTF-8
                with path.open("rb") as src:
                    zf.writestr(info, src.read())
                members.append(arcname)
        bad = forbidden_secret_members(members)
        if bad:
            raise RuntimeError(
                "Pack gate failed: zip must not include real secrets/*.json "
                f"(allowed: *.example). Found: {bad}"
            )
        junk = forbidden_pycache_members(members)
        if junk:
            raise RuntimeError(
                "Pack gate failed: zip must not include __pycache__ or .pyc/.pyo. "
                f"Found: {junk}"
            )
        tmp.replace(out)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    return members


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pack product-kit-v1.1 with secrets gate")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output zip path (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=KIT_ROOT,
        help="Kit root to pack (default: this script's directory)",
    )
    args = parser.parse_args(argv)
    root = args.root.resolve()
    out = args.out if args.out.is_absolute() else (Path.cwd() / args.out).resolve()
    try:
        members = build_zip(root, out)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(f"Packed {len(members)} files -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
