"""Product images, stored in PostgreSQL and keyed by the sha256 of their bytes.

The schema's CHECK constraint proves each key matches its bytes, so a key
always names the same image. That is what lets GET /images/{key} be cached
forever. Read-only here: the seed writes images.
"""

import psycopg


class ImageNotFound(Exception):
    """No image has this key. The route layer turns this into a 404."""

    def __init__(self, key: str):
        super().__init__(f"No image {key!r}")
        self.key = key


def get_image(conn: psycopg.Connection, key: str) -> tuple[str, bytes]:
    """(content_type, data) for one image. Raises ImageNotFound."""
    row = conn.execute(
        "SELECT content_type, data FROM images WHERE sha256 = %s", [key]
    ).fetchone()
    if row is None:
        raise ImageNotFound(key)
    content_type, data = row
    return content_type, bytes(data)
