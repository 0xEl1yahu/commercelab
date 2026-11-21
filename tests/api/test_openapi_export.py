"""The committed openapi.json is the frontend's contract: it must match the app."""

from scripts import export_openapi


def test_committed_openapi_is_current():
    committed = (
        export_openapi.OPENAPI_PATH.read_text() if export_openapi.OPENAPI_PATH.exists() else ""
    )
    assert committed == export_openapi.render(), (
        "openapi.json is stale: run uv run python -m scripts.export_openapi"
    )
