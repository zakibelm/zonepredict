import os
os.environ.setdefault("DATATAXI_API_BASE", "https://example.invalid/x")
os.environ.setdefault("ZONEPREDICT_DB", "/tmp/zp_routes_test.sqlite3")
from fastapi.testclient import TestClient
from app.main import app


def test_pages_serve_the_app_shell():
    c = TestClient(app)
    for path in ("/", "/placement", "/comparaison", "/statistiques", "/sante"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert "page-placement" in r.text and "page-sante" in r.text
        assert r.headers["cache-control"] == "no-store"
