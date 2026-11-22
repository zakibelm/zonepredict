from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from app.predict import make_forecast,evaluate,target_for_forecast

TZ=ZoneInfo("America/Toronto")

def e(d,t,z,dest=None,eligible=1,category="Régulier"):
    return {"event_date":d,"event_time":t,"request_zone":z,"destination_zone":dest,"eligible":eligible,"category":category}

def test_forecast_minute_50_next_hour():
    t=datetime(2026,11,22,16,50,tzinfo=TZ)
    assert target_for_forecast(t).strftime("%Y-%m-%d %H:%M") == "2026-11-22 17:00"

def test_midnight_transition():
    t=datetime(2026,11,22,23,50,tzinfo=TZ)
    assert target_for_forecast(t).strftime("%Y-%m-%d %H:%M") == "2026-11-23 00:00"

def test_confidence_without_destination_medium_with_two_dates():
    history=[e('2026-11-14','17:00:02','6'),e('2026-11-15','17:09:02','6')]
    t=datetime(2026,11,22,16,50,tzinfo=TZ)
    p=make_forecast(history,target_for_forecast(t),t)
    assert p['matrix'][0]['confidence']=='Moyen'
    assert p['predicted_volume'] is None
    assert p['placement']==[]

def test_confidence_known_stable_destination_strong():
    history=[e('2026-11-14','17:00:02','6','61'),e('2026-11-15','17:09:02','6','61')]
    t=datetime(2026,11,22,16,50,tzinfo=TZ)
    p=make_forecast(history,target_for_forecast(t),t)
    assert p['matrix'][0]['confidence']=='Fort'
    assert p['placement'][0]['zone']=='6'

def test_different_destinations_low_confidence():
    history=[e('2026-11-14','17:00:02','6','61'),e('2026-11-15','17:09:02','6','5')]
    t=datetime(2026,11,22,16,50,tzinfo=TZ)
    p=make_forecast(history,target_for_forecast(t),t)
    assert p['matrix'][0]['confidence']=='Faible'

def test_bins_no_overlap_and_evaluation_of_real_only():
    history=[e('2026-11-14','17:00:00','6'),e('2026-11-15','17:09:59','6'),e('2026-11-15','17:10:00','6')]
    t=datetime(2026,11,22,16,50,tzinfo=TZ)
    p=make_forecast(history,target_for_forecast(t),t)
    assert len(p['matrix'])==2
    assert [x['bin'] for x in p['matrix']]==[0,1]
    real=[e('2026-11-22','17:09:59','6'),e('2026-11-22','17:10:00','6'),e('2026-11-22','17:12:00','9'),e('2026-11-22','16:58:00','6')]
    result=evaluate(p,real,t.isoformat())
    assert result['observed_in_window']==3
    assert result['matched_zone_and_bin']==2
    assert result['unanticipated_observed']==1
    assert result['final'] is False
