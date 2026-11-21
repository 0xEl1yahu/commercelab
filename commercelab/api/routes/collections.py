from fastapi import APIRouter

from commercelab.api.dependencies import Conn
from commercelab.api.models import CollectionDetailOut, CollectionOut, ErrorOut
from commercelab.domain import catalogue

router = APIRouter(tags=["catalogue"])


@router.get("/collections")
def list_collections(conn: Conn) -> list[CollectionOut]:
    return [CollectionOut(**collection) for collection in catalogue.list_collections(conn)]


@router.get("/collections/{slug}", responses={404: {"model": ErrorOut}})
def get_collection(conn: Conn, slug: str) -> CollectionDetailOut:
    """A collection's active products, in its own order."""
    return CollectionDetailOut(**catalogue.get_collection(conn, slug))
