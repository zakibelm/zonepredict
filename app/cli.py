"""Exécuter depuis le VPS : python -m app.cli backfill --start 2026-09-01"""
import argparse
import asyncio
import json
from datetime import date
from .config import Settings
from . import storage
from .engine import backfill,sync_recent,create_forecast_if_due

def main():
    p=argparse.ArgumentParser()
    p.add_argument("command",choices=["backfill","sync","forecast"])
    p.add_argument("--start",default=None)
    p.add_argument("--end",default=None)
    args=p.parse_args()
    s=Settings();storage.init(s.db_path)
    if args.command=="backfill":
        x=asyncio.run(backfill(s,from_date=date.fromisoformat(args.start) if args.start else None,to_date=date.fromisoformat(args.end) if args.end else None))
    elif args.command=="sync":x=asyncio.run(sync_recent(s))
    else:x=create_forecast_if_due(s)
    print(json.dumps(x,ensure_ascii=False,indent=2))

if __name__=="__main__":main()
