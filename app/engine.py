"""Collecte toutes les 5 minutes et forecast exact à :50, sans envoi de jeton côté navigateur."""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone

import httpx
from .config import Settings
from .normalizer import normalize, unpack, quarantine, _pick, SchemaError
from . import storage
from .predict import make_forecast, evaluate, target_for_forecast

logger=logging.getLogger("zonepredict")

class ApiUnavailable(RuntimeError): pass

class DataTaxiReader:
    def __init__(self,settings:Settings, transport=None):
        self.settings=settings
        self.transport=transport

    async def read_day(self,day:date):
        s=self.settings
        if not s.api_token or s.api_token=="REMPLACER_PAR_UN_NOUVEAU_JETON":
            raise ApiUnavailable("Jeton de lecture manquant dans .env")
        # Protection SSRF: URL fixe de configuration et HTTPS. Pas de redirection.
        params={"vue":"courses","depuis":day.isoformat(),"jusqu_a":day.isoformat(),"limite":s.max_rows_per_day}
        try:
            async with httpx.AsyncClient(timeout=18,follow_redirects=False,transport=self.transport) as client:
                r=await client.get(s.api_base,params=params,headers={"Authorization":f"Bearer {s.api_token}","Accept":"application/json"})
                if r.status_code==401:raise ApiUnavailable("HTTP 401 : jeton absent, invalide ou expiré")
                if r.status_code==403:raise ApiUnavailable("HTTP 403 : accès refusé")
                if r.status_code>=300:raise ApiUnavailable(f"API HTTP {r.status_code} : lecture non réalisée")
                try: payload=r.json()
                except ValueError as exc: raise ApiUnavailable("Réponse API non JSON") from exc
        except httpx.HTTPError as exc:
            raise ApiUnavailable(f"Réseau API indisponible ({exc.__class__.__name__})") from exc
        rows=unpack(payload)
        if len(rows)>=s.max_rows_per_day:
            raise ApiUnavailable("Résultat égal à la limite : pagination/exhaustivité non prouvée; augmenter limite ou implémenter pagination")
        if isinstance(payload,dict):
            # `total` seul peut désigner le global et non la sélection; ne pas inférer pagination.
            paging=payload.get("pagination") if isinstance(payload.get("pagination"),dict) else {}
            if (payload.get("has_more") is True or payload.get("hasNextPage") is True
                or paging.get("has_more") is True or paging.get("hasNextPage") is True
                or payload.get("next_cursor") or paging.get("next_cursor")):
                raise ApiUnavailable("Réponse paginée : prise en charge de pagination requise")
        normalized=[];quarantined=0
        for row in rows:
            # Lignes sans date/heure : conserver en quarantaine, hors prédiction.
            if _pick(row,"date") is None or _pick(row,"time") is None:
                quarantined+=1
                normalized.append(quarantine(row,day.isoformat(),"Date ou heure absente"))
                continue
            e=normalize(row)
            if e["event_date"]!=day.isoformat():
                raise SchemaError("L'API ne respecte pas le filtre de date : résultat refusé")
            normalized.append(e)
        if normalized and quarantined==len(normalized):
            raise SchemaError("Tous les éléments sont incomplets : vérifier le contrat API avant d'enregistrer")
        return normalized

async def sync_day(db_path,reader,day):
    try:
        data=await reader.read_day(day)
        result=storage.persist_events(db_path,day.isoformat(),day.isoformat(),data)
        logger.info("DataTaxi jour=%s rows=%d ajout=%d",day,result["returned"],result["new"])
        return result
    except Exception as exc:
        # Éviter corps HTTP, en-têtes et URL secret dans les logs.
        msg= str(exc) if isinstance(exc,(ApiUnavailable,SchemaError)) else type(exc).__name__
        storage.persist_failure(db_path,day.isoformat(),day.isoformat(),msg)
        logger.warning("Synchronisation date=%s échouée: %s",day,msg)
        raise

async def sync_recent(settings,reader=None,days_back=1):
    reader=reader or DataTaxiReader(settings)
    today=datetime.now(settings.timezone).date()
    res=[]
    for idx in range(days_back,-1,-1):
        day=today-timedelta(days=idx)
        res.append(await sync_day(settings.db_path,reader,day))
    return res

async def backfill(settings,reader=None,from_date=None,to_date=None):
    reader=reader or DataTaxiReader(settings)
    latest=datetime.now(settings.timezone).date()
    start=from_date or latest-timedelta(days=settings.max_days_initial-1)
    end=to_date or latest
    if start>end:raise ValueError("Dates inversées")
    if (end-start).days+1>settings.max_days_initial:raise ValueError("Période backfill supérieure à ZONEPREDICT_MAX_DAYS_INITIAL")
    success=0;errors=[];rows=0
    day=start
    while day<=end:
        try:
            x=await sync_day(settings.db_path,reader,day);rows+=x["returned"];success+=1
        except Exception as exc:
            errors.append({"date":day.isoformat(),"error":str(exc) if isinstance(exc,(ApiUnavailable,SchemaError)) else type(exc).__name__})
        day+=timedelta(days=1)
    return {"days_ok":success,"days_failed":len(errors),"rows_received":rows,"errors":errors[:10]}

def create_forecast_if_due(settings,now_local=None):
    now_local=now_local or datetime.now(settings.timezone)
    if now_local.minute<50:return {"created":False,"reason":"Pas encore :50"}
    target=target_for_forecast(now_local)
    if storage.get_forecast(settings.db_path,target.strftime("%Y-%m-%d %H:%M:%S")):
        return {"created":False,"reason":"Prévision déjà figée"}
    cutoff=now_local.strftime("%Y-%m-%d %H:%M:%S")
    history=storage.get_events(settings.db_path,before=cutoff)
    result=make_forecast(history,target,now_local)
    created=storage.store_forecast(settings.db_path,target.strftime("%Y-%m-%d %H:%M:%S"),now_local.isoformat(),cutoff,result)
    return {"created":created,"target":target.isoformat(),"historical_events":len(history)}

def update_evaluations(settings,now_local=None):
    now_local=now_local or datetime.now(settings.timezone)
    now_str=now_local.strftime("%Y-%m-%d %H:%M:%S")
    ev=storage.get_events(settings.db_path,eligible=True)
    count=0
    for p in storage.get_forecasts(settings.db_path,limit=72):
        forecast=p["result"]
        end=datetime.fromisoformat(forecast["target_end"]).replace(tzinfo=settings.timezone)
        if now_local<end+timedelta(minutes=5):continue
        result=evaluate(forecast,ev,now_local.isoformat(),storage.get_stats(settings.db_path).get("last_event"))
        storage.store_evaluation(settings.db_path,p["target_start"],result)
        count+=1
    return count

async def heartbeat(settings):
    """Un seul processus uvicorn --workers 1. Vérifie le découpage de l'horloge locale."""
    logger.info("Démarrage moteur zonepredict, sync=%d minutes, cron=:50",settings.poll_minutes)
    lock=asyncio.Lock()
    previous_tick=None
    while True:
        now=datetime.now(settings.timezone)
        current_tick=(now.year,now.month,now.day,now.hour,now.minute//settings.poll_minutes)
        if now.minute%settings.poll_minutes==0 and current_tick!=previous_tick:
            previous_tick=current_tick
            async with lock:
                poll_success=False
                try:
                    await sync_recent(settings,days_back=1)
                    poll_success=True
                except Exception: pass
                if now.minute==50:
                    if poll_success:
                        try:logger.info("Snapshot prévision: %s",create_forecast_if_due(settings))
                        except Exception as exc:logger.error("Prévision échouée: %s",type(exc).__name__)
                    else:
                        logger.warning("Prévision non émise : extraction API de :50 non confirmée; pas de repli sur données périmées")
                try:update_evaluations(settings)
                except Exception as exc:logger.error("Évaluation échouée: %s",type(exc).__name__)
        await asyncio.sleep(10)
