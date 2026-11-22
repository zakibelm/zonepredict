"""SQLite propre au dashboard; aucune écriture dans la base dispatch source."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA="""
CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  event_time TEXT NOT NULL,
  request_zone TEXT,
  raw_zone TEXT,
  vehicle_id TEXT,
  service_type TEXT NOT NULL,
  status TEXT NOT NULL,
  destination_zone TEXT,
  category TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK(eligible IN(0,1)),
  excluded_reason TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date,event_time);
CREATE INDEX IF NOT EXISTS idx_events_zone ON events(request_zone,event_date,event_time);
CREATE TABLE IF NOT EXISTS quarantine_events (
  row_hash TEXT PRIMARY KEY,
  query_date TEXT NOT NULL,
  raw_time TEXT,
  raw_zone TEXT,
  raw_vehicle TEXT,
  raw_service TEXT,
  raw_status TEXT,
  reason TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  state TEXT NOT NULL,
  rows_returned INTEGER,
  rows_new INTEGER,
  message TEXT
);
CREATE TABLE IF NOT EXISTS forecasts (
  target_start TEXT PRIMARY KEY,
  issued_at TEXT NOT NULL,
  history_cutoff TEXT NOT NULL,
  result_json TEXT NOT NULL,
  algorithm_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluations (
  target_start TEXT PRIMARY KEY REFERENCES forecasts(target_start),
  evaluated_at TEXT NOT NULL,
  result_json TEXT NOT NULL
);
"""

def init(db_path):
    p=Path(db_path);p.parent.mkdir(parents=True,exist_ok=True)
    with connect(db_path) as db:
        db.executescript(SCHEMA)

def connect(db_path):
    db=sqlite3.connect(str(db_path),timeout=20,check_same_thread=False)
    db.row_factory=sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=20000")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def nowiso(): return datetime.now(timezone.utc).isoformat()

def persist_events(db_path,from_date,to_date, normalized):
    """All-or-nothing : une ligne de contrat invalide ne peut pas vider la base."""
    dt=nowiso()
    with connect(db_path) as db:
        cur=db.execute("INSERT INTO sync_runs(requested_at,from_date,to_date,state) VALUES(?,?,?,'running')",(dt,from_date,to_date))
        run_id=cur.lastrowid
        n_new=0
        try:
            for x in normalized:
                if x.get("quarantined"):
                    db.execute("""INSERT INTO quarantine_events(row_hash,query_date,raw_time,raw_zone,raw_vehicle,raw_service,raw_status,reason,first_seen,last_seen)
                    VALUES(:event_key,:query_date,:raw_time,:raw_zone,:raw_vehicle,:raw_service,:raw_status,:reason,:timestamp,:timestamp)
                    ON CONFLICT(row_hash) DO UPDATE SET last_seen=excluded.last_seen""",{**x,"timestamp":dt})
                    continue
                c=db.execute("""INSERT OR IGNORE INTO events(event_key,event_date,event_time,request_zone,raw_zone,vehicle_id,service_type,status,destination_zone,category,eligible,excluded_reason,first_seen,last_seen)
                VALUES (:event_key,:event_date,:event_time,:request_zone,:raw_zone,:vehicle_id,:service_type,:status,:destination_zone,:category,:eligible,:excluded_reason,:timestamp,:timestamp)""",{**x,"timestamp":dt})
                n_new+=c.rowcount
                db.execute("UPDATE events SET last_seen=? WHERE event_key=?",(dt,x["event_key"]))
            db.execute("UPDATE sync_runs SET state='success', completed_at=?,rows_returned=?,rows_new=? WHERE id=?",(nowiso(),len(normalized),n_new,run_id))
            db.commit()
            return {"returned":len(normalized),"new":n_new,"run_id":run_id}
        except Exception:
            db.rollback()
            raise

def persist_failure(db_path,from_date,to_date,message):
    # Jamais de secrets, URLs porteuses de token ni de corps brut dans le registre d'erreurs.
    text=str(message).split("\n")[0][:350]
    with connect(db_path) as db:
        db.execute("INSERT INTO sync_runs(requested_at,completed_at,from_date,to_date,state,message) VALUES(?,?,?,?,?,?)",(nowiso(),nowiso(),from_date,to_date,"error",text))
        db.commit()

def get_events(db_path, before=None, since=None, until=None, eligible=None):
    q="SELECT * FROM events WHERE 1=1";args=[]
    if before is not None:
        q+=" AND (event_date || ' ' || event_time) < ?";args.append(before)
    if since is not None:q+=" AND event_date >= ?";args.append(since)
    if until is not None:q+=" AND event_date <= ?";args.append(until)
    if eligible is not None:q+=" AND eligible = ?";args.append(int(eligible))
    q+=" ORDER BY event_date,event_time,event_key"
    with connect(db_path) as db: return [dict(x) for x in db.execute(q,args).fetchall()]

def get_forecast(db_path,target):
    with connect(db_path) as db:
        x=db.execute("SELECT * FROM forecasts WHERE target_start=?",(target,)).fetchone()
    if not x:return None
    d=dict(x);d["result"]=json.loads(d.pop("result_json"));return d

def get_forecasts(db_path,limit=30):
    with connect(db_path) as db:
        data=db.execute("SELECT * FROM forecasts ORDER BY target_start DESC LIMIT ?",(limit,)).fetchall()
    return [{"target_start":r["target_start"],"issued_at":r["issued_at"],"result":json.loads(r["result_json"])} for r in data]

def store_forecast(db_path,target,issued_at,cutoff,result,version="v2-immutable-1"):
    with connect(db_path) as db:
        c=db.execute("INSERT OR IGNORE INTO forecasts(target_start,issued_at,history_cutoff,result_json,algorithm_version) VALUES(?,?,?,?,?)",(target,issued_at,cutoff,json.dumps(result,ensure_ascii=False,sort_keys=True),version))
        db.commit();return c.rowcount==1

def store_evaluation(db_path,target,result):
    with connect(db_path) as db:
        db.execute("INSERT INTO evaluations(target_start,evaluated_at,result_json) VALUES(?,?,?) ON CONFLICT(target_start) DO UPDATE SET evaluated_at=excluded.evaluated_at,result_json=excluded.result_json",(target,nowiso(),json.dumps(result,ensure_ascii=False,sort_keys=True)))
        db.commit()

def get_evaluations(db_path,limit=30):
    with connect(db_path) as db:
        data=db.execute("SELECT * FROM evaluations ORDER BY target_start DESC LIMIT ?",(limit,)).fetchall()
    return [{"target_start":r["target_start"],"evaluated_at":r["evaluated_at"],"result":json.loads(r["result_json"])} for r in data]

def get_sync(db_path):
    with connect(db_path) as db:
        x=db.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    return dict(x) if x else None

def get_stats(db_path):
    with connect(db_path) as db:
        r=db.execute("SELECT COUNT(*) n,COUNT(DISTINCT event_date) dates,COUNT(DISTINCT request_zone) zones,SUM(eligible) eligible,MAX(event_date || ' ' || event_time) last_event FROM events").fetchone()
        q=db.execute("SELECT COUNT(*) AS quarantined FROM quarantine_events").fetchone()
    return {**dict(r),**dict(q)}
