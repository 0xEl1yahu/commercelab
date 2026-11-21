"""The stock-photo manifest: which image goes where, where it came from, and its bytes.

scripts/image_manifest.json maps each product slug to its images, in gallery
order. Each entry records the photo's source and licence (Unsplash or Pexels)
and the sha256 of the exact bytes, which becomes the image's key in
PostgreSQL. The bytes themselves are downloaded once into CACHE_DIR by
`uv run python -m scripts.fetch_images`; the seed reads them from there.

Paths are relative to the repo root: run scripts from there.
"""

import json
from dataclasses import dataclass
from pathlib import Path

MANIFEST_PATH = Path("scripts/image_manifest.json")
CACHE_DIR = Path(".cache/images")


@dataclass(frozen=True)
class ManifestImage:
    position: int  # 1 is the primary image
    sha256: str  # lowercase hex sha256 of the downloaded bytes
    content_type: str  # image/jpeg, image/png or image/webp
    download_url: str  # a sized file, at most 1600px wide
    source_url: str  # the photo's page on Unsplash or Pexels
    licence: str  # "Unsplash License" or "Pexels License"
    credit: str  # the photographer, as the licence asks
    alt: str


def load_manifest() -> dict[str, list[ManifestImage]]:
    """{slug: [ManifestImage, ...]}, each list in position order."""
    raw = json.loads(MANIFEST_PATH.read_text())
    return {
        slug: sorted((ManifestImage(**entry) for entry in entries), key=lambda i: i.position)
        for slug, entries in raw.items()
    }


def cached_bytes(sha256: str) -> bytes:
    """The downloaded bytes for one manifest image. Raises FileNotFoundError if not cached."""
    path = CACHE_DIR / sha256
    if not path.is_file():
        raise FileNotFoundError(
            f"Image {sha256} is not in {CACHE_DIR}/; run: uv run python -m scripts.fetch_images"
        )
    return path.read_bytes()
