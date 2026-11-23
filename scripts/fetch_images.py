"""Download the stock photos listed in scripts/image_manifest.json into the cache.

Run from the repo root:

    uv run python -m scripts.fetch_images

Every manifest entry whose file `.cache/images/<sha256>` is missing, or whose
cached bytes no longer hash to that name, is downloaded from its `download_url`,
checked against its sha256 and written there. An entry with a blank sha256 is
new: its download is hashed, cached and the hash written back into the
manifest. A mismatch or a failed download stops with a non-zero exit naming the
product and position. Prints "Fetched N, cached M".

Files are written to a temporary name and renamed into place, so an interrupted
run never leaves a partial file under a hash name. The cache is not committed;
the seed reads it through image_manifest.cached_bytes.
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx

from scripts import image_manifest

USER_AGENT = "commercelab-image-fetcher/1.0 (learning project)"


def _download(client: httpx.Client, url: str) -> bytes:
    response = client.get(url, follow_redirects=True, timeout=60)
    response.raise_for_status()
    return response.content


def _write_atomic(path: Path, data: bytes) -> None:
    """Write via a temp file in the same directory, then rename over `path`."""
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _is_cached(cache_dir: Path, sha256: str) -> bool:
    path = cache_dir / sha256
    return bool(sha256) and path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == sha256


def main(argv: list[str] | None = None, client: httpx.Client | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args(argv)

    manifest_path = image_manifest.MANIFEST_PATH
    cache_dir = image_manifest.CACHE_DIR
    raw = json.loads(manifest_path.read_text())
    cache_dir.mkdir(parents=True, exist_ok=True)
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT})

    fetched = cached = 0
    filled = False
    for slug, entries in raw.items():
        for entry in entries:
            expected = entry["sha256"]
            if _is_cached(cache_dir, expected):
                cached += 1
                continue
            try:
                data = _download(client, entry["download_url"])
            except httpx.HTTPError as exc:
                raise SystemExit(
                    f"download failed for {slug}, position {entry['position']}: {exc}"
                ) from exc
            actual = hashlib.sha256(data).hexdigest()
            if not expected:
                entry["sha256"] = expected = actual
                filled = True
            elif actual != expected:
                raise SystemExit(
                    f"sha256 mismatch for {slug}, position {entry['position']}: "
                    f"manifest says {expected}, download is {actual}"
                )
            _write_atomic(cache_dir / expected, data)
            fetched += 1
            print(f"  {slug} #{entry['position']}: {len(data) // 1024} KB", file=sys.stderr, flush=True)

    if filled:
        _write_atomic(manifest_path, (json.dumps(raw, indent=2, ensure_ascii=False) + "\n").encode())
    print(f"Fetched {fetched}, cached {cached}")


if __name__ == "__main__":
    main()
