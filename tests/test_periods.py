from datetime import date
import pytest
from app.main import period_range

T = date(2026, 11, 22)  # dimanche

def test_today_yesterday():
    assert period_range("today", T) == ("2026-11-22", "2026-11-22")
    assert period_range("yesterday", T) == ("2026-11-21", "2026-11-21")

def test_week_month_rolling():
    assert period_range("week", T) == ("2026-11-16", "2026-11-22")
    assert period_range("month", T) == ("2026-11-01", "2026-11-22")
    assert period_range("7d", T) == ("2026-11-16", "2026-11-22")
    assert period_range("30d", T) == ("2026-10-24", "2026-11-22")
    assert period_range("all", T) == (None, None)

def test_custom_and_errors():
    assert period_range("custom", T, "2026-09-01", "2026-09-01") == ("2026-09-01", "2026-09-01")
    with pytest.raises(ValueError): period_range("custom", T, None, None)
    with pytest.raises(ValueError): period_range("custom", T, "2026-10-02", "2026-10-01")
