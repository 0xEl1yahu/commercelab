from typing import Annotated

from fastapi import APIRouter, Header, Path, Response

from commercelab.api.dependencies import Conn
from commercelab.api.models import ErrorOut
from commercelab.domain import images

router = APIRouter(tags=["images"])

# A key is the sha256 of the bytes, so the bytes behind a key never change.
IMMUTABLE = "public, max-age=31536000, immutable"


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    """RFC 9110 If-None-Match: "*", or a comma-separated list of (possibly weak) tags."""
    if if_none_match is None:
        return False
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate == "*" or candidate.removeprefix("W/") == etag:
            return True
    return False


@router.get(
    "/images/{key}",
    response_class=Response,
    responses={
        200: {
            "description": "The image bytes",
            "content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}},
        },
        304: {"description": "Not modified: the client's copy (If-None-Match) is current"},
        404: {"model": ErrorOut},
    },
)
def get_image(
    conn: Conn,
    key: Annotated[str, Path(pattern=r"^[0-9a-f]{64}$", description="sha256 of the bytes")],
    if_none_match: Annotated[str | None, Header()] = None,
) -> Response:
    content_type, data = images.get_image(conn, key)
    headers = {"Cache-Control": IMMUTABLE, "ETag": f'"{key}"'}
    if _etag_matches(if_none_match, headers["ETag"]):
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=content_type, headers=headers)
