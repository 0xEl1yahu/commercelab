"""Download the stock photos listed in scripts/image_manifest.json into the cache.

Run from the repo root:

    uv run python -m scripts.fetch_images

Every manifest entry whose file `.cache/images/<sha256>` is missing is
downloaded from its `download_url`, checked against its sha256 and written
there. An entry with a blank sha256 is new: its download is hashed, cached and
the hash written back into the manifest. A mismatch stops with a non-zero exit
naming the product and position. Prints "Fetched N, cached M".

The cache is not committed; the seed reads it through image_manifest.cached_bytes.
"""

import argparse
import hashlib
import json
import sys

import httpx

from scripts import image_manifest

USER_AGENT = "commercelab-image-fetcher/1.0 (learning project)"


def _download(client: httpx.Client, url: str) -> bytes:
    response = client.get(url, follow_redirects=True, timeout=60)
    response.raise_for_status()
    return response.content


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
            if expected and (cache_dir / expected).is_file():
                cached += 1
                continue
            data = _download(client, entry["download_url"])
            actual = hashlib.sha256(data).hexdigest()
            if not expected:
                entry["sha256"] = expected = actual
                filled = True
            elif actual != expected:
                raise SystemExit(
                    f"sha256 mismatch for {slug}, position {entry['position']}: "
                    f"manifest says {expected}, download is {actual}"
                )
            (cache_dir / expected).write_bytes(data)
            fetched += 1
            print(f"  {slug} #{entry['position']}: {len(data) // 1024} KB", file=sys.stderr, flush=True)

    if filled:
        manifest_path.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    print(f"Fetched {fetched}, cached {cached}")


if __name__ == "__main__":
    main()
