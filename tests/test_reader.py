import asyncio
from datetime import date
import httpx
import pytest
from app.config import Settings
from app.engine import DataTaxiReader,ApiUnavailable
from app.normalizer import SchemaError

class FakeSettings:
    api_base='https://n8n.example.com/webhook/datataxi-api'
    api_token='test-token'
    max_rows_per_day=5000

def test_reader_bearer_and_date_filters():
    def handler(req):
        assert req.headers['Authorization']=='Bearer test-token'
        assert req.url.params['vue']=='courses'
        assert req.url.params['depuis']=='2026-11-22'
        return httpx.Response(200,json={'courses':[{'date':'2026-11-22','heure':'12:58','zone':'6','vehicule':424,'service':'Régulier','statut':'recu'}]})
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(handler))
    items=asyncio.run(reader.read_day(date(2026,11,22)))
    assert items[0]['request_zone']=='6'

def test_reader_fails_on_unauthorized():
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(401)))
    with pytest.raises(ApiUnavailable):asyncio.run(reader.read_day(date(2026,11,22)))

def test_reader_rejects_unexpected_date():
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'courses':[{'date':'2026-11-21','heure':'12:58','zone':'6'}]})))
    with pytest.raises(SchemaError):asyncio.run(reader.read_day(date(2026,11,22)))

def test_reader_rejects_reported_pagination():
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'courses':[],'has_more':True})))
    with pytest.raises(ApiUnavailable):asyncio.run(reader.read_day(date(2026,11,22)))


def test_missing_date_is_quarantined_not_zero():
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'courses':[{'heure':'12:58','zone':6,'vehicule':424,'statut':'recu'},{'date':'2026-11-22','heure':'13:00','zone':6,'vehicule':425,'statut':'recu'}]})))
    items=asyncio.run(reader.read_day(date(2026,11,22)))
    assert len(items)==2 and items[0]['quarantined'] is True
    assert items[1]['eligible']==1
