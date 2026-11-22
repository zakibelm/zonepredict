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


COLS=['date','heure','zone','vehicule','service','statut']

def test_contrat_reel_n8n_lignes_positionnelles():
    """Format réel de « DataTaxi - API lecture (SQLite) » : courses = listes + colonnes."""
    payload={'ok':True,'total':2,'colonnes':COLS,'courses':[
        ['2026-11-22','12:58:03','6','424','Régulier','recu'],
        ['2026-11-22','13:01:10','12','425','Régulier','recu']]}
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))
    items=asyncio.run(reader.read_day(date(2026,11,22)))
    assert [i['request_zone'] for i in items]==['6','12']
    assert items[0]['vehicle_id']=='424' and items[0]['event_time']=='12:58:03'

def test_resultat_tronque_refuse():
    payload={'ok':True,'total':9,'colonnes':COLS,'courses':[['2026-11-22','12:58:03','6','424','Régulier','recu']]}
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))
    with pytest.raises(ApiUnavailable):asyncio.run(reader.read_day(date(2026,11,22)))

def test_ligne_trop_longue_refusee():
    payload={'ok':True,'total':1,'colonnes':COLS,'courses':[['2026-11-22','12:58','6','424','Régulier','recu','extra']]}
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))
    with pytest.raises(SchemaError):asyncio.run(reader.read_day(date(2026,11,22)))

def test_jour_vide_total_zero_ok():
    payload={'ok':True,'total':0,'colonnes':COLS,'courses':[]}
    reader=DataTaxiReader(FakeSettings(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))
    assert asyncio.run(reader.read_day(date(2026,11,22)))==[]
