import asyncio
from datetime import date
import httpx
from app import storage
from app.engine import DataTaxiReader, sync_day
from app.predict import evaluate, coverage_level

class FS:
    api_base='https://n8n.example.com/webhook/datataxi-api'
    api_token='test-token'
    max_rows_per_day=5000

COLS=['date','heure','zone','vehicule','service','statut']
DAY='2026-11-24'

def reader_with(rows):
    payload={'ok':True,'total':len(rows),'colonnes':COLS,'courses':rows}
    return DataTaxiReader(FS(),transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))

def test_coverage_row_is_never_an_event(tmp_path):
    db=tmp_path/'t.sqlite3';storage.init(db)
    rows=[[DAY,'17:05:00','','','__couverture__','couvert'],[DAY,'17:12:44','6','424','Régulier','recu']]
    res=asyncio.run(sync_day(db,reader_with(rows),date(2026,11,24)))
    assert res['returned']==1 and res['new']==1          # un seul appel, la couverture n'est pas comptée
    assert len(storage.get_events(db))==1
    assert storage.coverage_since(db)==f'{DAY} 17:05:00'

def test_coverage_is_idempotent(tmp_path):
    db=tmp_path/'t.sqlite3';storage.init(db)
    rows=[[DAY,'17:05:00','','','__couverture__','couvert']]
    for _ in range(3):asyncio.run(sync_day(db,reader_with(rows),date(2026,11,24)))
    assert storage.coverage_count(db,f'{DAY} 17:00:00',f'{DAY} 18:00:00')==1

def test_only_coverage_rows_is_not_a_schema_error(tmp_path):
    db=tmp_path/'t.sqlite3';storage.init(db)
    rows=[[DAY,'17:05:00','','','__couverture__','couvert']]
    res=asyncio.run(sync_day(db,reader_with(rows),date(2026,11,24)))
    assert res['returned']==0

def fc(start='2026-11-24 12:00:00',end='2026-11-24 13:00:00'):
    return {'target_start':start,'target_end':end,'predicted_volume':None,
            'matrix':[{'zone':'6','bin':0,'destinations':[]},{'zone':'1','bin':1,'destinations':[]}]}

def ev(t,z='6',d='2026-11-24'):
    return {'event_date':d,'event_time':t,'request_zone':z,'destination_zone':None,'eligible':1,'category':'Régulier'}

def test_levels():
    assert coverage_level(12)=='couverte' and coverage_level(9)=='couverte'
    assert coverage_level(8)=='partielle' and coverage_level(3)=='partielle'
    assert coverage_level(2)=='non couverte' and coverage_level(0)=='non couverte'

def test_uncovered_hour_is_not_a_zero():
    r=evaluate(fc(),[],'x',coverage={'bins':0,'active':True})
    assert r['coverage_status']=='non couverte' and r['evaluable'] is False
    assert r['observed_match_share'] is None and r['cell_precision'] is None and r['final'] is False

def test_covered_hour_without_calls_is_a_real_zero_signal():
    r=evaluate(fc(),[],'x',coverage={'bins':12,'active':True})
    assert r['coverage_status']=='couverte' and r['evaluable'] is True and r['final'] is True
    assert r['cells_with_calls']==0 and r['cell_precision']==0.0

def test_calls_prove_reading_even_with_few_bins():
    r=evaluate(fc(),[ev('12:03:00')],'x',coverage={'bins':1,'active':True})
    assert r['coverage_status']=='partielle' and r['evaluable'] is True
    assert r['observed_match_share']==100.0

def test_legacy_hour_unknown_coverage():
    empty=evaluate(fc(),[],'x',coverage={'bins':0,'active':False})
    assert empty['coverage_status']=='inconnue' and empty['evaluable'] is False
    some=evaluate(fc(),[ev('12:03:00')],'x',coverage=None)
    assert some['coverage_status']=='inconnue' and some['evaluable'] is True and some['final'] is False

def test_cell_precision_counts_distinct_cells():
    r=evaluate(fc(),[ev('12:03:00'),ev('12:04:00'),ev('12:40:00','9')],'x',coverage={'bins':12,'active':True})
    assert r['cells_flagged']==2 and r['cells_with_calls']==1 and r['cell_precision']==50.0
    assert r['unanticipated_observed']==1

def test_dashboard_coverage_summary_levels(tmp_path,monkeypatch):
    import os
    os.environ.setdefault("DATATAXI_API_BASE","https://example.invalid/x")
    from datetime import datetime
    from zoneinfo import ZoneInfo
    import app.main as m
    db=tmp_path/'t.sqlite3';storage.init(db)
    monkeypatch.setattr(m.settings,'db_path',db)
    now=datetime(2026,11,24,18,31,tzinfo=ZoneInfo('America/Toronto'))
    assert m.coverage_summary(now)['since'] is None
    with storage.connect(db) as c:
        for mnt in range(0,60,5):c.execute("INSERT INTO coverage VALUES(?,?)",(f'2026-11-24 10:{mnt:02d}:00','t'))   # 12 cases : couverte
        for mnt in (0,5,10,15):c.execute("INSERT INTO coverage VALUES(?,?)",(f'2026-11-24 14:{mnt:02d}:00','t'))     # 4 cases : partielle
        c.commit()
    s=m.coverage_summary(now)
    by={h['hour']:h for h in s['hours']}
    assert by['2026-11-24 10:00']['status']=='inconnue'      # première heure de preuve : jamais déduite
    assert by['2026-11-24 14:00']['status']=='partielle' and by['2026-11-24 14:00']['bins']==4
    assert by['2026-11-24 15:00']['status']=='non couverte' and by['2026-11-24 15:00']['bins']==0
    assert len(s['hours'])==24
