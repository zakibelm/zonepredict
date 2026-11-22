"""API dashboard lecture seule + worker local. Nginx impose authentification externe."""
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from collections import Counter,defaultdict
from datetime import datetime,timedelta
from pathlib import Path
from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse,JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from . import storage
from .engine import heartbeat,backfill,DataTaxiReader

logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
settings=Settings()

@asynccontextmanager
async def lifespan(app:FastAPI):
    storage.init(settings.db_path)
    task=asyncio.create_task(heartbeat(settings))
    if settings.initial_backfill:
        async def run_backfill():
            result=await backfill(settings)
            logging.getLogger("zonepredict").info("Backfill terminé jours=%s erreurs=%s",result["days_ok"],result["days_failed"])
        bt=asyncio.create_task(run_backfill())
    else:bt=None
    try:yield
    finally:
        task.cancel()
        if bt:bt.cancel()
        await asyncio.gather(*[x for x in [task,bt] if x],return_exceptions=True)

app=FastAPI(title="ZonePredict Dashboard",version="1.0.0",docs_url=None,redoc_url=None,lifespan=lifespan)
@app.middleware("http")
async def require_proxy_key(request:Request,call_next):
    """Si ZONEPREDICT_PROXY_KEY est défini, l'API n'accepte que le proxy Vercel (/api/health reste libre pour le healthcheck Docker)."""
    key=settings.proxy_key
    path=request.url.path
    if key and path.startswith("/api/") and path!="/api/health":
        if not hmac.compare_digest(request.headers.get("x-zonepredict-key","").encode(),key.encode()):
            return JSONResponse({"error":"unauthorized","message":"Clé proxy absente ou invalide"},status_code=401)
    return await call_next(request)

STATIC=Path(__file__).parent/"static"
app.mount("/static",StaticFiles(directory=STATIC),name="static")

@app.get("/",include_in_schema=False)
def root():return FileResponse(STATIC/"index.html",headers={"Cache-Control":"no-store"})

@app.get("/api/health")
def health():
    latest=storage.get_sync(settings.db_path)
    return {"service":"zonepredict-dashboard","ready":True,"source_connected":bool(latest and latest["state"]=="success"),"last_sync":latest["completed_at"] if latest else None}

@app.get("/api/dashboard")
def dashboard(period:str=Query("7d",pattern="^(7d|30d|all)$")):
    now=datetime.now(settings.timezone)
    since=(now.date()-timedelta(days=6 if period=="7d" else 29)).isoformat() if period!="all" else None
    ev=storage.get_events(settings.db_path,since=since)
    all_evs=storage.get_events(settings.db_path)
    bytype=Counter(e["category"] for e in ev)
    bystatus=Counter(e["status"] for e in ev)
    bydate=Counter(e["event_date"] for e in ev)
    zones=Counter(e["request_zone"] for e in ev if e["eligible"] and e["request_zone"])
    hmap=Counter((datetime.strptime(e["event_date"],"%Y-%m-%d").weekday(),int(e["event_time"][:2])) for e in ev if e["eligible"] and e["request_zone"])
    forecasts=storage.get_forecasts(settings.db_path,limit=24)
    active=next((f for f in forecasts if f["target_start"]<=now.strftime("%Y-%m-%d %H:%M:%S")<f["result"]["target_end"]),None)
    upcoming=next((f for f in reversed(forecasts) if f["target_start"]>now.strftime("%Y-%m-%d %H:%M:%S")),None)
    evaluations=storage.get_evaluations(settings.db_path,limit=50)
    totalknown=sum(x["result"]["observed_known_zone"] for x in evaluations)
    matches=sum(x["result"]["matched_zone_and_bin"] for x in evaluations)
    sync=storage.get_sync(settings.db_path)
    total=len(ev)
    stat=storage.get_stats(settings.db_path)
    return {
      "now":now.isoformat(),"period":period,
      "source":{"name":"DataTaxi DB — API n8n","configured":bool(settings.api_token) and settings.api_token!="REMPLACER_PAR_UN_NOUVEAU_JETON","last_sync":sync,
                "last_event":stat.get("last_event"),"records_cached":stat.get("n"),"days_cached":stat.get("dates"),"quarantined":stat.get("quarantined")},
      "kpi":{"total_events":total,"eligible_events":sum(e["eligible"] for e in ev),"excluded_events":sum(not e["eligible"] for e in ev),
             "active_zones":len(zones),"days_observed":len(bydate),"demand_zone_unknown":sum(e["eligible"] and not e["request_zone"] for e in ev)},
      "quotas":[{"type":k,"count":n,"pct":round(n*100/total,1) if total else None,"eligible":k not in {"Transport adapté","Manuel","NoLoad","CISSS","Reprise système"}} for k,n in bytype.most_common()],
      "statuses":[{"label":k,"count":n,"pct":round(n*100/total,1) if total else None} for k,n in bystatus.most_common()],
      "by_date":[{"date":k,"count":n} for k,n in sorted(bydate.items())],
      "zones":[{"zone":k,"count":n} for k,n in sorted(zones.items(),key=lambda x:-x[1])],
      "heatmap":[{"weekday":day,"hour":hour,"count":n} for (day,hour),n in hmap.items()],
      "forecast":{"current":active,"upcoming":upcoming,"history":forecasts[:16]},
      "comparison":{"evaluated_slots":len(evaluations),"known_zone_events":totalknown,"zone_bin_matches":matches,
                    "coverage_pct":round(matches*100/totalknown,1) if totalknown else None,
                    "calibrated_confidence":None,"note":"Audit provisoire : couverture de capture non établie; valeur = part d'appels dans des cellules signalées, pas probabilité."},
      "evaluations":evaluations[:12],
      "source_caution":"Aucune destination inventée. Pas de zéro imputé aux créneaux sans capture. Les prévisions sont figées à :50."
    }

@app.get("/api/forecasts/latest")
def latest_forecast():
    values=storage.get_forecasts(settings.db_path,limit=1)
    return {"forecast":values[0] if values else None,"note":"Snapshot figé, ne pas recalculer rétroactivement"}

@app.get("/api/evaluations/latest")
def latest_evaluation():
    values=storage.get_evaluations(settings.db_path,limit=1)
    return {"evaluation":values[0] if values else None,"note":"Comparaison provisoire si la couverture de capture n'est pas attestée"}
