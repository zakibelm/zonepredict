"""Adaptateur contrat n8n : schémas inconnus -> erreur explicite, jamais zéro silencieux.

La destination est facultative; les courses en attente sans zone DEMANDEE distincte
ne contribuent pas à la répartition géographique de la demande.
"""
import hashlib
import json
import re
from datetime import date, datetime, time
from typing import Any

class SchemaError(ValueError):
    pass

ALIASES = {
    "date": ("date", "trip_date", "jour", "date_course", "course_date"),
    "time": ("heure", "time", "trip_time", "heure_reception", "received_at"),
    "zone": ("zone", "departure_zone", "zone_depart", "zone_départ", "zone_demande", "request_zone"),
    "vehicle": ("vehicule", "véhicule", "vehicle", "vehicle_id", "numero_vehicule"),
    "service": ("service", "type", "service_type", "type_appel", "type_de_service"),
    "status": ("statut", "status", "current_status", "etat"),
    "destination": ("destination", "destination_zone", "zone_arrivee", "zone_arrivée", "vers"),
    "id": ("trip_id", "course_id", "event_id", "id"),
    "requested_zone": ("zone_demandee", "zone_demandée", "requested_zone", "service_zone"),
}

def _norm_key(s: str) -> str:
    import unicodedata
    s="".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def _pick(row: dict, name: str):
    mapped = {_norm_key(k): v for k,v in row.items()}
    for alias in ALIASES[name]:
        v = mapped.get(_norm_key(alias))
        if v not in (None, "", "—", "-"):
            return v
    return None

def unpack(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        items=payload
    elif isinstance(payload, dict):
        items=None
        for key in ("courses", "rows", "items", "records", "results"):
            if isinstance(payload.get(key), list):
                items=payload[key];break
        if items is None and isinstance(payload.get("data"), list): items=payload["data"]
        if items is None and isinstance(payload.get("data"), dict):
            for key in ("courses", "rows", "items", "records", "results"):
                if isinstance(payload["data"].get(key), list): items=payload["data"][key];break
        if items is None:
            raise SchemaError("Réponse API sans collection de courses reconnue; contrat à adapter")
    else:
        raise SchemaError("Réponse API non JSON/collection")
    if any(not isinstance(r,dict) for r in items):
        raise SchemaError("Un élément de course n'est pas un objet")
    return items

def normalize(row: dict) -> dict:
    d=_pick(row,"date"); t=_pick(row,"time"); z=_pick(row,"zone"); v=_pick(row,"vehicle"); service=_pick(row,"service"); status=_pick(row,"status")
    if d is None or t is None:
        raise SchemaError("Course sans date ou heure : valeur requise pour la série horaire")
    d=str(d).strip(); t=str(t).strip()
    try:
        if "T" in d: d=date.fromisoformat(d[:10]).isoformat()
        else: d=date.fromisoformat(d[:10]).isoformat()
        if "T" in t: t=t.split("T")[-1]
        t=t.replace("Z","")[:8]
        if len(t)==5: t+=":00"
        parsed=time.fromisoformat(t)
        t=parsed.strftime("%H:%M:%S")
    except Exception as exc:
        raise SchemaError("Format date/heure invalide") from exc
    if not isinstance(row,dict): raise SchemaError("Enregistrement non objet")
    vehicle=str(v).strip() if v is not None else None
    status=str(status).strip() if status is not None else "Non précisé"
    service=str(service).strip() if service is not None else "Non précisé"
    raw_zone=str(z).strip() if z is not None else None
    requested=_pick(row,"requested_zone")
    requested=str(requested).strip() if requested is not None else None
    destination=_pick(row,"destination")
    destination=str(destination).strip() if destination is not None else None
    pending=bool(re.search("attente",status+" "+service,re.IGNORECASE))
    # L'API à six colonnes ne décrit PAS la sémantique de zone pour un appel en attente.
    # Sans champ distinct "zone_demandee", garder l'appel mais pas de zone de demande.
    # Pour un appel en attente, « pris sur X vers Y » = demande en Y,
    # mais seulement si Y est explicitement transmis; X reste position chauffeur.
    demand_zone=(requested or destination) if pending else raw_zone
    if demand_zone and not re.fullmatch(r"[0-9]{1,4}",demand_zone): demand_zone=None
    if destination and not re.fullmatch(r"[0-9]{1,4}",destination): destination=None
    category=categorize(service,status)
    reason=None
    if category in {"Transport adapté","Manuel","NoLoad","CISSS","Reprise système"}:
        reason=category
    # L'absence du véhicule rend impossible la déduplication sémantique sûre.
    # Utiliser alors l'ID source si présent, sinon l'empreinte du JSON.
    natural=f"{d}|{t}|{vehicle}|{raw_zone}|{requested}|{destination}|{service.lower()}|{status.lower()}"
    id_source=_pick(row,"id")
    if vehicle:
        event_key="sig:"+hashlib.sha256(natural.encode()).hexdigest()
    elif id_source is not None:
        event_key="id:"+str(id_source)
    else:
        event_key="raw:"+hashlib.sha256(json.dumps(row,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return dict(event_key=event_key,event_date=d,event_time=t,request_zone=demand_zone,
                raw_zone=raw_zone,vehicle_id=vehicle,service_type=service,status=status,
                destination_zone=destination,category=category,excluded_reason=reason,
                eligible=0 if reason else 1)

def quarantine(row:dict, query_date:str, reason:str) -> dict:
    """Conserve un événement incomplet hors calcul sans journaliser des adresses ou champs privés."""
    hashed=hashlib.sha256(json.dumps(row,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()
    def safe(name):
        val=_pick(row,name)
        return str(val)[:128] if val is not None else None
    return {"quarantined":True,"event_key":"q:"+hashed,"query_date":query_date,
            "raw_time":safe("time"),"raw_zone":safe("zone"),"raw_vehicle":safe("vehicle"),
            "raw_service":safe("service"),"raw_status":safe("status"),"reason":reason}

def categorize(service: str, status: str) -> str:
    v=_norm_key(service+" "+status)
    if "noload" in v or "no_load" in v: return "NoLoad"
    if "manuel" in v: return "Manuel"
    if "adapte" in v or "adapt" in v: return "Transport adapté"
    if "cisss" in v: return "CISSS"
    if "reprise" in v: return "Reprise système"
    if "attente" in v: return "Appel en attente"
    if "taxibus" in v or "exo" in v: return "Taxibus EXO"
    if "mobile" in v or "app_" in v: return "App mobile"
    if "regulier" in v or "regulier_autre" in v: return "Régulier"
    return "Autre / non précisé"
