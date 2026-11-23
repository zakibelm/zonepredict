"""Discipline ZonePredict v2: six bins fixes, récurrence par dates, destination optionnelle.

Ce module produit des signaux historiques, PAS des probabilités artificielles.
"""
from collections import Counter,defaultdict
from datetime import datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

VERSION="v2-immutable-1"


def localdt(when, tz):
    if when.tzinfo is None:raise ValueError("Horodatage avec fuseau obligatoire")
    return when.astimezone(tz)

def target_for_forecast(issued_local):
    """La prochaine heure civile : à 12:50 -> 13:00, même au passage de minuit."""
    at=issued_local.replace(minute=0,second=0,microsecond=0)
    return at+timedelta(hours=1)

def _category_counts(events):
    values=Counter(e["category"] for e in events)
    n=sum(values.values())
    return [{"type":k,"calls":v,"share":round(100*v/n,1) if n else 0} for k,v in values.most_common()]

def _cell(z,b,group,hour):
    """Une cellule zone × tranche de dix minutes, règles de confiance validées."""
    dates=sorted({e["event_date"] for e in group})
    dest=[e["destination_zone"] for e in group]
    known={x for x in dest if x}
    if len(dates)<2 or len(known)>1:
        confidence="Faible"
        why="Une seule date distincte" if len(dates)<2 else "Destinations connues divergentes"
    elif len(known)==1 and all(dest):
        confidence="Fort";why="Au moins deux dates et destination identique connue"
    else:
        confidence="Moyen";why="Au moins deux dates; destination absente ou partiellement connue"
    dc=Counter("Inconnue" if x is None else x for x in dest)
    per_date=Counter(e["event_date"] for e in group)
    return {"zone":z,"bin":b,"start":f"{hour:02d}:{b*10:02d}",
      "end":f"{(hour+((b+1)//6))%24:02d}:{((b+1)%6)*10:02d}",
      "occurrences":len(group),"distinct_dates":len(dates),"confidence":confidence,
      "confidence_reason":why,"destinations":[{"zone":d,"count":c,"share":round(c*100/len(group),1)} for d,c in dc.most_common()],
      "historical_dates":dates,"dates_detail":[{"date":d,"count":per_date[d],"times":sorted(e["event_time"][:8] for e in group if e["event_date"]==d)} for d in dates]}

def recurrence_matrix(history,hour,weekday=None,before_date=None):
    """Récurrences historiques pour une heure (et un jour de semaine optionnel), sans snapshot.
    weekday : 0=lundi … 6=dimanche ; None = tous les jours. before_date exclut ce jour et les suivants."""
    observed={}
    for e in history:
        if not e["eligible"] or not e["request_zone"]:continue
        if before_date and e["event_date"]>=before_date:continue
        if int(e["event_time"][:2])!=hour:continue
        if weekday is not None and datetime.strptime(e["event_date"],"%Y-%m-%d").weekday()!=weekday:continue
        observed.setdefault((e["request_zone"],int(e["event_time"][3:5])//10),[]).append(e)
    matrix=[_cell(z,b,g,hour) for (z,b),g in observed.items()]
    matrix.sort(key=lambda x:(int(x["zone"]),x["bin"]))
    return matrix

def make_forecast(history,target_local,issued_local):
    """historique déjà découpé strictement avant issued_local par couche DB."""
    tz=target_local.tzinfo
    target_date=target_local.date().isoformat()
    hour=target_local.hour
    # Les dates sont présentes, sans preuve de couverture complète: ne pas inférer de zéro.
    # Utiliser global semaine/weekend jusqu'à disponibilité d'une preuve explicite de couverture.
    observed={}
    for e in history:
        if not e["eligible"] or not e["request_zone"]:continue
        if e["event_date"]>=target_date:continue  # pas de fuite du jour cible
        if int(e["event_time"][:2])!=hour:continue
        minute=int(e["event_time"][3:5]);b=minute//10
        key=(e["request_zone"],b)
        observed.setdefault(key,[]).append(e)
    matrix=[_cell(z,b,group,hour) for (z,b),group in observed.items()]
    matrix.sort(key=lambda x:(int(x["zone"]),x["bin"]))
    zoneScores={}
    for m in matrix:
        z=m["zone"]
        sc=zoneScores.setdefault(z,{"zone":z,"occurrences":0,"fort_bins":0,"moyen_bins":0,"faible_bins":0})
        sc["occurrences"]+=m["occurrences"]
        sc[{"Fort":"fort_bins","Moyen":"moyen_bins","Faible":"faible_bins"}[m["confidence"]]]+=1
    zones=sorted(zoneScores.values(),key=lambda x:(-x["fort_bins"],-x["occurrences"],int(x["zone"])))
    # Seul Fort autorise une recommandation de placement (règle existante).
    placement=[z for z in zones if z["fort_bins"]>0]
    return {
      "target_start":target_local.strftime("%Y-%m-%d %H:%M:%S"),
      "target_end":(target_local+timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"),
      "issued_at":issued_local.isoformat(),"timezone":str(tz),
      "coverage_established":False,"historical_days_with_calls":len({e["event_date"] for group in observed.values() for e in group}),
      "segment":"global (couverture insuffisante pour séparer semaine/week-end)",
      "predicted_volume":None,"volume_reason":"Aucune preuve des journées couvertes par tranche dans l'API à six champs; aucun zéro imputé",
      "zone_ranking":zones,"matrix":matrix,"placement":placement,
      "note":"Occurrence = total historique; tranche = période à surveiller, pas début d'activité. Vide = aucune donnée enregistrée.",
      "confidence_definition":"Fort/Moyen/Faible = récurrence historique et destination, non une probabilité calibrée",
      "algorithm_version":VERSION
    }

def evaluate(forecast, observations, evaluated_at, last_source_at=None):
    """Snapshot immuable en entrée. Jamais de 0 implicite sur un créneau non couvert."""
    start=forecast["target_start"];end=forecast["target_end"]
    observed=[e for e in observations if e["eligible"] and f"{e['event_date']} {e['event_time']}" >= start and f"{e['event_date']} {e['event_time']}" < end]
    targets={(c["zone"],c["bin"]):c for c in forecast["matrix"]}
    hit=0;unknown=0;miss=0;totalKnown=0
    bytype=Counter();realByZone=Counter();realByBin=Counter();matchDest=0;destComparable=0
    for e in observed:
        bytype[e["category"]]+=1
        z=e["request_zone"]
        if not z:
            unknown+=1;continue
        totalKnown+=1;realByZone[z]+=1
        bin=int(e["event_time"][3:5])//10
        realByBin[f"{z}|{bin}"]+=1
        pred=targets.get((z,bin))
        if pred:
            hit+=1
            if e["destination_zone"]:
                destComparable+=1
                if e["destination_zone"] in [x["zone"] for x in pred["destinations"] if x["zone"]!="Inconnue"]:matchDest+=1
        else:miss+=1
    return {
      "target_start":start,"target_end":end,"evaluated_at":evaluated_at,
      "observed_in_window":len(observed),"observed_known_zone":totalKnown,"observed_unknown_zone":unknown,
      "matched_zone_and_bin":hit,"unanticipated_observed":miss,
      "observed_match_share":round(hit*100/totalKnown,1) if totalKnown else None,
      "destination_matches":matchDest,"destination_comparable":destComparable,
      "real_by_zone":dict(realByZone),"real_by_zone_bin":dict(realByBin),
      "by_type":dict(bytype),"predicted_volume":forecast["predicted_volume"],
      "volume_absolute_gap":None, "volume_percent_gap":None,
      "coverage_status":"non établie", "final":False,
      "caution":"Comparaison provisoire: l'API ne prouve pas l'exhaustivité. Un signal sans appel observé n'est pas un échec certain."
    }
