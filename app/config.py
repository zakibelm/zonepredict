import os
from pathlib import Path
from zoneinfo import ZoneInfo

class Settings:
    def __init__(self):
        self.api_base = os.getenv("DATATAXI_API_BASE", "https://n8n.xtream.space/webhook/datataxi-api").strip()
        self.api_token = os.getenv("DATATAXI_READ_TOKEN", "").strip()
        self.tz_name = os.getenv("ZONEPREDICT_TIMEZONE", "America/Toronto")
        self.timezone = ZoneInfo(self.tz_name)
        self.db_path = Path(os.getenv("ZONEPREDICT_DB", "/data/zonepredict_dashboard.sqlite3"))
        self.max_rows_per_day = int(os.getenv("ZONEPREDICT_MAX_ROWS_PER_DAY", "5000"))
        self.max_days_initial = int(os.getenv("ZONEPREDICT_MAX_DAYS_INITIAL", "90"))
        self.poll_minutes = int(os.getenv("ZONEPREDICT_POLL_MINUTES", "5"))
        self.proxy_key = os.getenv("ZONEPREDICT_PROXY_KEY", "").strip()
        self.initial_backfill = os.getenv("ZONEPREDICT_INITIAL_BACKFILL", "0") == "1"
        if not self.api_base.startswith("https://"):
            raise ValueError("DATATAXI_API_BASE doit être https")
        if not 1 <= self.poll_minutes <= 60 or 60 % self.poll_minutes:
            raise ValueError("ZONEPREDICT_POLL_MINUTES doit diviser 60")
        if self.proxy_key and len(self.proxy_key) < 24:
            raise ValueError("ZONEPREDICT_PROXY_KEY doit contenir au moins 24 caractères")
        if not 10 <= self.max_rows_per_day <= 100000:
            raise ValueError("Limite de requête invalide")
