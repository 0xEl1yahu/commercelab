"""Tests for images.py: image bytes are read back from PostgreSQL by their sha256 key."""

import pytest

from commercelab.domain import images
from commercelab.domain.images import ImageNotFound
from tests.support.fakes import insert_image


def test_get_image_returns_type_and_bytes(conn):
    key = insert_image(conn, b"\x89PNG not really", content_type="image/png")
    assert images.get_image(conn, key) == ("image/png", b"\x89PNG not really")


def test_unknown_image_raises(conn):
    with pytest.raises(ImageNotFound) as raised:
        images.get_image(conn, "0" * 64)
    assert raised.value.key == "0" * 64
