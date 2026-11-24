from app.predict import recurrence_matrix, make_forecast
from datetime import datetime
from zoneinfo import ZoneInfo

def ev(date, time, zone, dest=None, eligible=1):
    return {"event_date": date, "event_time": time, "request_zone": zone, "destination_zone": dest,
            "eligible": eligible, "category": "Normal", "status": "x"}

# 2026-11-13 et 2026-11-20 sont des vendredis ; 2026-11-14 est un samedi
H = [ev("2026-11-13", "20:12:00", "4", "9"), ev("2026-11-20", "20:15:30", "4", "9"),
     ev("2026-11-14", "20:11:00", "4", "9"),
     ev("2026-11-20", "20:42:00", "7"), ev("2026-11-20", "20:44:00", "7", eligible=0),
     ev("2026-11-20", "21:05:00", "4", "9")]

def test_weekday_segmentation():
    m = recurrence_matrix(H, 20, weekday=4)
    c = {(x["zone"], x["bin"]): x for x in m}
    assert c[("4", 1)]["occurrences"] == 2 and c[("4", 1)]["distinct_dates"] == 2
    assert c[("4", 1)]["confidence"] == "Fort"           # 2 dates, destination connue identique
    assert c[("7", 4)]["occurrences"] == 1 and c[("7", 4)]["confidence"] == "Faible"  # exclu (eligible=0) non compté
    assert len(m) == 2                                    # samedi et 21 h hors segment

def test_all_days_includes_saturday():
    c = {(x["zone"], x["bin"]): x for x in recurrence_matrix(H, 20)}
    assert c[("4", 1)]["occurrences"] == 3

def test_dates_detail_and_before_date():
    m = recurrence_matrix(H, 20, weekday=4, before_date="2026-11-20")
    assert [x["date"] for x in m[0]["dates_detail"]] == ["2026-11-13"]

def test_unknown_destination_not_rejected():
    h = [ev("2026-11-06", "08:01:00", "3"), ev("2026-11-13", "08:02:00", "3", "5")]
    c = recurrence_matrix(h, 8)[0]
    assert c["occurrences"] == 2 and c["confidence"] == "Moyen"
    assert {d["zone"] for d in c["destinations"]} == {"Inconnue", "5"}

def test_make_forecast_unchanged_shape():
    tz = ZoneInfo("America/Toronto")
    f = make_forecast(H, datetime(2026, 11, 22, 20, 0, tzinfo=tz), datetime(2026, 11, 22, 19, 50, tzinfo=tz))
    assert f["matrix"] and "dates_detail" in f["matrix"][0] and f["predicted_volume"] is None


# ---------- v3 : zones à viser + fourchette de volume ----------
from app.predict import zones_to_target, volume_range, evaluate, VERSION

def _hist():
    h=[]
    for d in ("2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06"):   # semaine
        h.append(ev(d,"20:12:00","4","9"))
        h.append(ev(d,"20:31:00","4"))
    h.append(ev("2026-11-04","20:40:00","7"))
    h.append(ev("2026-11-07","20:10:00","12"))      # samedi
    h.append(ev("2026-11-03","20:50:00","3",eligible=0))
    return h

def test_zones_to_target_ranks_by_weighted_recurrence():
    z=zones_to_target(_hist(),"2026-11-09",20,False)
    assert [x["zone"] for x in z][:2]==["4","7"] and z[0]["distinct_dates"]==5
    assert "3" not in [x["zone"] for x in z]            # inadmissible exclu
    assert z[0]["advice"] is True and z[1]["advice"] is False   # conseil seulement si Fort
    assert sum(x["share"] for x in z)<=100.0

def test_weekend_history_weighs_less_on_a_weekday():
    z=zones_to_target(_hist(),"2026-11-09",20,False)
    assert z[-1]["zone"]!="12" or z[-1]["share"]<z[0]["share"]

def test_volume_range_needs_enough_days_and_never_imputes_zero():
    r=volume_range(_hist(),"2026-11-09",20,False)
    assert r["low"] is not None and r["days"]==5 and r["low"]<=r["median"]<=r["high"]
    short=volume_range(_hist(),"2026-11-09",20,True)
    assert short["low"] is None and short["reason"] and short["days"]==1

def test_v3_forecast_and_evaluation_metrics():
    tz=ZoneInfo("America/Toronto")
    f=make_forecast(_hist(),datetime(2026,11,9,20,0,tzinfo=tz),datetime(2026,11,9,19,50,tzinfo=tz))
    assert f["algorithm_version"]==VERSION=="v3-zones-volume-1"
    assert f["zones_to_target"] and f["volume_range"]["low"] is not None and f["predicted_volume"] is None
    f["target_start"],f["target_end"]="2026-11-09 20:00:00","2026-11-09 21:00:00"
    obs=[ev("2026-11-09","20:05:00","4"),ev("2026-11-09","20:20:00","4"),ev("2026-11-09","20:30:00","99")]
    r=evaluate(f,obs,"2026-11-09T21:00:00",coverage={"bins":12,"active":True})
    assert r["zone_hit"] is True and r["zone_capture_share"]==round(200/3,1)
    assert r["volume_in_range"] in (True,False)
    nc=evaluate(f,[],"2026-11-09T21:00:00",coverage={"bins":0,"active":True})
    assert nc["evaluable"] is False and nc["zone_capture_share"] is None and nc["volume_in_range"] is None
