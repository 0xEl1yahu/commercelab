import psycopg
from fastapi import APIRouter, Response

from commercelab.api.models import Health
from commercelab.data import db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(response: Response) -> Health:
    """Liveness plus a database check. 503 if Postgres can't be reached.

    Uses the pool directly instead of the Conn dependency: if no connection
    can be borrowed, the dependency itself would fail with a generic 500.
    """
    try:
        with db.connection() as conn:
            db.ping(conn)
    except psycopg.Error:  # includes PoolTimeout: no connection available in time
        response.status_code = 503
        return Health(status="unavailable", database="unreachable")
    return Health(status="ok", database="ok")
