"""Tests for the stock-photo manifest and the fetch script.

The manifest is checked against the shared catalogue identity: every active
product has its images, each with a licence, a credit and a source page. The
cache tests need the downloaded files and skip with a reason until
`uv run python -m scripts.fetch_images` has been run.
"""

import hashlib
import json
import re

import httpx
import pytest

from scripts import catalogue_data as cd
from scripts import fetch_images, image_manifest
from scripts.image_manifest import CACHE_DIR, load_manifest

SHA256 = re.compile(r"^[0-9a-f]{64}$")
LICENCES = {"Unsplash License", "Pexels License"}
MAX_BYTES = 600 * 1024


def active_rows():
    return [row for row in cd.PRODUCTS if row[0] != cd.DISCONTINUED_SKU]


def highlighted_skus() -> set[str]:
    return {sku for slug, _, _, skus in cd.COLLECTIONS if slug in ("spotlight", "featured") for sku in skus}


def expected_count(sku: str) -> int:
    if sku in cd.IMAGE_COUNT_OVERRIDES:
        return cd.IMAGE_COUNT_OVERRIDES[sku]
    return cd.IMAGE_COUNT["spotlight or featured" if sku in highlighted_skus() else "other"]


def cache_is_populated() -> bool:
    return CACHE_DIR.is_dir() and any(CACHE_DIR.iterdir())


needs_cache = pytest.mark.skipif(
    not cache_is_populated(),
    reason="no downloaded images in .cache/images; run: uv run python -m scripts.fetch_images",
)


def test_manifest_covers_every_active_product_with_the_right_count():
    manifest = load_manifest()
    expected = {slug: expected_count(sku) for sku, slug, *_ in active_rows()}
    assert len(expected) == 54
    assert {slug: len(images) for slug, images in manifest.items()} == expected


def test_alt_text_is_brand_and_name_with_a_suffix_for_later_positions():
    manifest = load_manifest()
    suffixes = {1: "", 2: ", side view", 3: ", in use"}
    # A product with an image-count override keeps its hero and its "in use" photo.
    two_photo_suffixes = {1: "", 2: ", in use"}
    for sku, slug, name, brand, _ in active_rows():
        table = two_photo_suffixes if cd.IMAGE_COUNT_OVERRIDES.get(sku) == 2 else suffixes
        for image in manifest[slug]:
            assert image.alt == f"{brand} {name}{table[image.position]}", (slug, image.position)


def test_every_entry_has_licence_credit_and_source():
    for slug, images in load_manifest().items():
        for image in images:
            where = (slug, image.position)
            assert image.licence in LICENCES, where
            assert image.credit.strip(), where
            assert image.source_url.startswith(("https://unsplash.com/photos/", "https://www.pexels.com/photo/")), where
            assert image.licence.split()[0].lower() in image.source_url, where


def test_download_urls_request_a_sized_jpeg():
    for slug, images in load_manifest().items():
        for image in images:
            url = httpx.URL(image.download_url)
            where = (slug, image.position)
            assert url.scheme == "https", where
            assert url.host in ("images.unsplash.com", "images.pexels.com"), where
            assert url.params.get("w") == "1600", where
            if url.host == "images.unsplash.com":
                assert url.params.get("fm") == "jpg", where
            assert image.content_type == "image/jpeg", where


def test_keys_are_unique_and_well_formed():
    manifest = load_manifest()
    keys = []
    for slug, images in manifest.items():
        assert [i.position for i in images] == list(range(1, len(images) + 1)), slug
        for image in images:
            assert SHA256.match(image.sha256), (slug, image.position)
            keys.append(image.sha256)
    # every image is a distinct photo, so every key is unique across the whole manifest
    assert len(set(keys)) == len(keys) == sum(expected_count(sku) for sku, *_ in active_rows())


@needs_cache
def test_cached_files_match_their_keys():
    for slug, images in load_manifest().items():
        for image in images:
            data = (CACHE_DIR / image.sha256).read_bytes()
            assert hashlib.sha256(data).hexdigest() == image.sha256, (slug, image.position)


@needs_cache
def test_cached_files_are_at_most_600kb():
    for slug, images in load_manifest().items():
        for image in images:
            size = (CACHE_DIR / image.sha256).stat().st_size
            assert size <= MAX_BYTES, (slug, image.position, size)


# --- fetch_images -----------------------------------------------------------


def entry(position: int, sha256: str, url: str = "https://images.unsplash.com/photo-1?w=1600&q=80&fm=jpg"):
    return {
        "position": position,
        "sha256": sha256,
        "content_type": "image/jpeg",
        "download_url": url,
        "source_url": "https://unsplash.com/photos/x",
        "licence": "Unsplash License",
        "credit": "Someone",
        "alt": "Brand Thing",
    }


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(image_manifest, "MANIFEST_PATH", tmp_path / "manifest.json")
    monkeypatch.setattr(image_manifest, "CACHE_DIR", tmp_path / "cache")
    return tmp_path


def serve(payload: bytes) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=payload)))


def test_fetch_downloads_missing_files_and_reports_counts(sandbox, capsys):
    good = b"jpeg bytes"
    digest = hashlib.sha256(good).hexdigest()
    cached = b"already here"
    cached_digest = hashlib.sha256(cached).hexdigest()
    (sandbox / "cache").mkdir()
    (sandbox / "cache" / cached_digest).write_bytes(cached)
    (sandbox / "manifest.json").write_text(
        json.dumps({"a-product": [entry(1, digest), entry(2, cached_digest)]})
    )

    fetch_images.main([], client=serve(good))

    assert (sandbox / "cache" / digest).read_bytes() == good
    assert capsys.readouterr().out.strip() == "Fetched 1, cached 1"


def test_fetch_fills_blank_hashes_into_the_manifest(sandbox, capsys):
    data = b"fresh photo"
    (sandbox / "manifest.json").write_text(json.dumps({"a-product": [entry(1, "")]}))

    fetch_images.main([], client=serve(data))

    digest = hashlib.sha256(data).hexdigest()
    saved = json.loads((sandbox / "manifest.json").read_text())
    assert saved["a-product"][0]["sha256"] == digest
    assert (sandbox / "cache" / digest).read_bytes() == data
    assert capsys.readouterr().out.strip() == "Fetched 1, cached 0"


def test_fetch_exits_non_zero_on_a_hash_mismatch_naming_slug_and_position(sandbox):
    wrong = "0" * 64
    (sandbox / "manifest.json").write_text(
        json.dumps({"a-product": [entry(1, hashlib.sha256(b"ok").hexdigest()), entry(2, wrong)]})
    )

    with pytest.raises(SystemExit) as stop:
        fetch_images.main([], client=serve(b"ok"))

    assert "a-product" in str(stop.value) and "position 2" in str(stop.value)
    assert not (sandbox / "cache" / wrong).exists()


def test_fetch_redownloads_a_corrupted_cached_file(sandbox, capsys):
    good = b"real photo"
    digest = hashlib.sha256(good).hexdigest()
    (sandbox / "cache").mkdir()
    (sandbox / "cache" / digest).write_bytes(b"truncated")
    (sandbox / "manifest.json").write_text(json.dumps({"a-product": [entry(1, digest)]}))

    fetch_images.main([], client=serve(good))

    assert (sandbox / "cache" / digest).read_bytes() == good
    assert capsys.readouterr().out.strip() == "Fetched 1, cached 0"


def test_a_failed_write_leaves_nothing_under_the_hash_name(sandbox, monkeypatch):
    data = b"photo"
    digest = hashlib.sha256(data).hexdigest()
    (sandbox / "manifest.json").write_text(json.dumps({"a-product": [entry(1, digest)]}))

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(fetch_images.os, "replace", broken_replace)

    with pytest.raises(OSError):
        fetch_images.main([], client=serve(data))

    assert list((sandbox / "cache").iterdir()) == []


def test_a_failed_download_names_the_product_and_position(sandbox):
    (sandbox / "manifest.json").write_text(
        json.dumps({"a-product": [entry(1, hashlib.sha256(b"x").hexdigest())]})
    )
    failing = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500)))

    with pytest.raises(SystemExit) as stop:
        fetch_images.main([], client=failing)

    assert str(stop.value).startswith("download failed for a-product, position 1")


def test_manifest_write_back_leaves_no_temp_files(sandbox):
    (sandbox / "manifest.json").write_text(json.dumps({"a-product": [entry(1, "")]}))

    fetch_images.main([], client=serve(b"fresh"))

    assert sorted(p.name for p in sandbox.iterdir()) == ["cache", "manifest.json"]
