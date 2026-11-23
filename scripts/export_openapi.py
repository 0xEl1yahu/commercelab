"""Write the API's OpenAPI schema to openapi.json, the storefront's contract.

    uv run python -m scripts.export_openapi

Re-run it after any change to commercelab/api/models.py or the routes; the
frontend generates its TypeScript types from the committed file, and
tests/api/test_openapi_export.py fails while the file is stale.
"""

import json
from pathlib import Path

from commercelab.main import app

OPENAPI_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def render() -> str:
    """The schema as committed: sorted keys, 2-space indent, trailing newline."""
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    OPENAPI_PATH.write_text(render())
    print(f"Wrote {OPENAPI_PATH.name}")


if __name__ == "__main__":
    main()
