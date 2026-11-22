import importlib
import pytest
from fastapi.testclient import TestClient


def make_client(monkeypatch, tmp_path, key):
    monkeypatch.setenv("ZONEPREDICT_DB", str(tmp_path / "t.sqlite3"))
    monkeypatch.setenv("DATATAXI_READ_TOKEN", "x" * 8)
    if key is None:
        monkeypatch.delenv("ZONEPREDICT_PROXY_KEY", raising=False)
    else:
        monkeypatch.setenv("ZONEPREDICT_PROXY_KEY", key)
    import app.main as m
    importlib.reload(m)
    m.storage.init(m.settings.db_path)
    return TestClient(m.app)


def test_sans_cle_configuree_api_ouverte(monkeypatch, tmp_path):
    c = make_client(monkeypatch, tmp_path, None)
    assert c.get("/api/health").status_code == 200


def test_cle_requise_sur_dashboard(monkeypatch, tmp_path):
    key = "k" * 32
    c = make_client(monkeypatch, tmp_path, key)
    assert c.get("/api/dashboard").status_code == 401
    assert c.get("/api/dashboard", headers={"X-ZonePredict-Key": "mauvaise"}).status_code == 401
    assert c.get("/api/dashboard", headers={"X-ZonePredict-Key": key}).status_code == 200


def test_health_reste_libre_pour_docker(monkeypatch, tmp_path):
    c = make_client(monkeypatch, tmp_path, "k" * 32)
    assert c.get("/api/health").status_code == 200


def test_cle_trop_courte_refusee(monkeypatch):
    monkeypatch.setenv("ZONEPREDICT_PROXY_KEY", "court")
    from app.config import Settings
    with pytest.raises(ValueError):
        Settings()
