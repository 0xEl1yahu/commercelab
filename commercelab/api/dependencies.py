"""What routes receive: a database connection and a payment provider.

A route declares a parameter of type Conn or Provider and FastAPI supplies it.
Tests replace these with `app.dependency_overrides`.
"""

from typing import Annotated

import psycopg
from fastapi import Depends, HTTPException

from commercelab.config import settings
from commercelab.data import db
from commercelab.domain import payments

# One instance for the whole process: the simulated provider remembers what it
# has charged (for lookup), and a new instance per request would forget it.
_demo_provider = payments.SimulatedProvider()


def get_payment_provider() -> payments.PaymentProvider:
    """The payment provider for this environment.

    Principle 9 (demo/live separation): the simulated provider only exists in
    demo. There is no live provider yet, so live checkout refuses to run.
    """
    if settings.app_env != "demo":
        raise HTTPException(status_code=503, detail="No live payment provider is configured")
    return _demo_provider


# One pooled connection per request, returned to the pool when the request ends.
Conn = Annotated[psycopg.Connection, Depends(db.get_conn)]
Provider = Annotated[payments.PaymentProvider, Depends(get_payment_provider)]
