"""CommerceLab API entry point. Deliberately thin.

This file assembles the app and nothing more:
  - opens the connection pool at startup and closes it at shutdown
  - registers the domain-exception -> HTTP mapping (api/errors.py)
  - includes the routers (api/routes/)

No SQL and no business rules live in the API layer. A route validates input,
calls one domain function, and converts the result into a response model. If a
route grows logic beyond that, the logic belongs in the domain module that owns it.

Run locally:   uv run uvicorn commercelab.main:app --reload
API docs:      http://127.0.0.1:8000/docs
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from commercelab.api import errors
from commercelab.api.routes import health, orders, products
from commercelab.data import db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Everything before `yield` runs once at startup, everything after at shutdown.
    db.open_pool()
    try:
        yield
    finally:
        db.close_pool()


app = FastAPI(title="CommerceLab", version="0.1.0", lifespan=lifespan)
errors.register(app)
for router in (health.router, products.router, orders.router):
    app.include_router(router)
