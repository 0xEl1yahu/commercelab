"""Application settings, read from environment variables or a local .env file.

Field names map to env vars case-insensitively: database_url <- DATABASE_URL.
Invalid values (e.g. APP_ENV=prod) fail at import time instead of at first use.
"""

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://localhost/commercelab"
    app_env: Literal["demo", "live"] = "demo"
    db_pool_min: int = 1
    db_pool_max: int = 10
    # How long checkout holds stock for an order awaiting payment. After this,
    # scripts/reconcile.py may release it (only once the provider confirms the
    # customer wasn't charged).
    reservation_hold_minutes: int = Field(default=15, gt=0)


settings = Settings()
