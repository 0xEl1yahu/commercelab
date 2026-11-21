"""HTTP contract for GET /images/{key}: bytes from PostgreSQL, cached forever."""

import pytest

from tests.support.fakes import insert_image

IMMUTABLE = "public, max-age=31536000, immutable"


def test_image_route_serves_bytes_with_immutable_caching(client, conn):
    key = insert_image(conn, b"jpeg bytes")
    response = client.get(f"/images/{key}")
    assert response.status_code == 200
    assert response.content == b"jpeg bytes"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == IMMUTABLE
    assert response.headers["etag"] == f'"{key}"'


@pytest.mark.parametrize("if_none_match", ['"{key}"', 'W/"{key}"', '"other", "{key}"'])
def test_if_none_match_gives_304(client, conn, if_none_match):
    key = insert_image(conn, b"jpeg bytes")
    response = client.get(f"/images/{key}", headers={"If-None-Match": if_none_match.format(key=key)})
    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["etag"] == f'"{key}"'
    assert response.headers["cache-control"] == IMMUTABLE


def test_a_different_etag_gets_the_bytes(client, conn):
    key = insert_image(conn, b"jpeg bytes")
    response = client.get(f"/images/{key}", headers={"If-None-Match": '"' + "0" * 64 + '"'})
    assert (response.status_code, response.content) == (200, b"jpeg bytes")


def test_unknown_key_is_404(client):
    response = client.get("/images/" + "0" * 64)
    assert response.status_code == 404
    assert "detail" in response.json()


@pytest.mark.parametrize(
    "key", ["abc", "A" * 64, "0" * 63, "0" * 65, "g" * 64],
    ids=["short", "uppercase", "63 chars", "65 chars", "not hex"],
)
def test_malformed_key_is_422(client, key):
    assert client.get(f"/images/{key}").status_code == 422


def test_304_never_reads_the_image(client, conn, monkeypatch):
    from commercelab.domain import images

    key = insert_image(conn, b"jpeg bytes")
    monkeypatch.setattr(images, "get_image", lambda *a: pytest.fail("read the image for a 304"))
    response = client.get(f"/images/{key}", headers={"If-None-Match": f'"{key}"'})
    assert response.status_code == 304
