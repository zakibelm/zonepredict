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
