"""Discipline ZonePredict v2: six bins fixes, récurrence par dates, destination optionnelle.

Ce module produit des signaux historiques, PAS des probabilités artificielles.
"""
from collections import Counter,defaultdict
from datetime import datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

VERSION="v3-zones-volume-1"


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

def _is_weekend(day:str)->bool:
    return datetime.strptime(day,"%Y-%m-%d").weekday()>=5

def _age_days(ref:str,day:str)->int:
    return (datetime.strptime(ref,"%Y-%m-%d")-datetime.strptime(day,"%Y-%m-%d")).days

DAYTYPE_OTHER_WEIGHT=0.2   # poids d'un jour d'un autre type (semaine / fin de semaine)
RECENCY_DAYS=30            # demi-vie approximative de la pondération de récence
MIN_DAYS_FOR_RANGE=4       # en dessous, aucune fourchette de volume n'est annoncée

def zones_to_target(history,ref_date,hour,weekend,top=3):
    """Zones les plus probables pour une heure : récurrence pondérée par type de jour et récence.

    Rejoué sur 300 heures réelles : le top 3 couvre ~67 % des appels (hasard : 21 %).
    Un signal de récurrence, PAS une probabilité. Le conseil de placement reste réservé aux zones Fort."""
    import math
    rows=[e for e in history if e["eligible"] and e["request_zone"] and e["event_date"]<ref_date and int(e["event_time"][:2])==hour]
    if not rows:return []
    score=defaultdict(float);raw=defaultdict(list)
    for e in rows:
        w=(1.0 if _is_weekend(e["event_date"])==weekend else DAYTYPE_OTHER_WEIGHT)*math.exp(-_age_days(ref_date,e["event_date"])/RECENCY_DAYS)
        score[e["request_zone"]]+=w;raw[e["request_zone"]].append(e)
    total=sum(score.values()) or 1.0
    order=sorted(score,key=lambda z:(-score[z],int(z)))[:top]
    rank={"Fort":2,"Moyen":1,"Faible":0}
    out=[]
    for z in order:
        by_bin=defaultdict(list)
        for e in raw[z]:by_bin[int(e["event_time"][3:5])//10].append(e)
        cells=[_cell(z,b,g,hour) for b,g in by_bin.items()]
        best=max(cells,key=lambda c:(rank[c["confidence"]],c["occurrences"]))
        bins=sorted(cells,key=lambda c:(-c["occurrences"],c["bin"]))[:2]
        out.append({"zone":z,"share":round(100*score[z]/total,1),"occurrences":len(raw[z]),
          "distinct_dates":len({e["event_date"] for e in raw[z]}),"confidence":best["confidence"],
          "advice":any(c["confidence"]=="Fort" for c in cells),
          "best_bins":[{"bin":c["bin"],"start":c["start"],"end":c["end"],"occurrences":c["occurrences"]} for c in bins]})
    return out

def volume_range(history,ref_date,hour,weekend):
    """Fourchette historique (centiles 20 à 80) du nombre d'appels pour cette heure, même type de jour.

    Calculée sur les jours où au moins un appel a été enregistré à cette heure : l'absence de capture
    n'est jamais comptée comme zéro. Rejoué sur 299 heures : contient le vécu 67 % du temps."""
    per_day=Counter(e["event_date"] for e in history if e["eligible"] and e["event_date"]<ref_date and int(e["event_time"][:2])==hour and _is_weekend(e["event_date"])==weekend)
    counts=sorted(per_day.values())
    label="fin de semaine" if weekend else "semaine"
    if len(counts)<MIN_DAYS_FOR_RANGE:
        return {"low":None,"median":None,"high":None,"days":len(counts),"day_type":label,
                "reason":f"Moins de {MIN_DAYS_FOR_RANGE} jours de {label} avec des appels à cette heure : pas de fourchette."}
    q=lambda p:counts[min(len(counts)-1,int(p*len(counts)))]
    return {"low":q(.2),"median":q(.5),"high":q(.8),"days":len(counts),"day_type":label,
            "basis":"Jours avec au moins un appel enregistré à cette heure (même type de jour)."}

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
      "predicted_volume":None,"volume_reason":"Pas de chiffre unique : le volume horaire est surtout aléatoire; une fourchette historique est donnée à la place",
      "zones_to_target":zones_to_target(history,target_date,hour,target_local.weekday()>=5),
      "volume_range":volume_range(history,target_date,hour,target_local.weekday()>=5),
      "zone_ranking":zones,"matrix":matrix,"placement":placement,
      "note":"Occurrence = total historique; tranche = période à surveiller, pas début d'activité. Vide = aucune donnée enregistrée.",
      "confidence_definition":"Fort/Moyen/Faible = récurrence historique et destination, non une probabilité calibrée",
      "algorithm_version":VERSION
    }

COVERED_BINS=9      # sur 12 cases de 5 min : l'heure est « couverte »
PARTIAL_BINS=3      # de 3 à 8 cases : « partielle »

def coverage_level(bins):
    """Niveau de couverture d'une heure d'après les cases de 5 min où l'écran était lisible."""
    if bins>=COVERED_BINS:return "couverte"
    if bins>=PARTIAL_BINS:return "partielle"
    return "non couverte"

def evaluate(forecast, observations, evaluated_at, last_source_at=None, coverage=None):
    """Snapshot immuable en entrée. Jamais de 0 implicite sur un créneau non couvert.

    `coverage` = {"bins": cases de 5 min lisibles dans l'heure, "active": preuve de couverture déjà reçue}.
    Sans preuve (heure antérieure à la mise en service), la couverture est « inconnue » : une heure sans
    aucun appel n'est alors pas évaluable, car on ne peut pas distinguer « aucun appel » de « tablette muette »."""
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
    bins=None
    if coverage and coverage.get("active"):
        bins=int(coverage.get("bins") or 0)
        status=coverage_level(bins)
        # Des appels observés prouvent que la tablette lisait, même si peu de cases sont arrivées.
        if status=="non couverte" and observed:status="partielle"
    else:
        status="inconnue"
    evaluable=status in ("couverte","partielle") or (status=="inconnue" and bool(observed))
    flagged=len(targets)
    tz_zones={z["zone"] for z in forecast.get("zones_to_target") or []}
    vr=forecast.get("volume_range") or {}
    zone_capture=zone_hit=vol_in=None
    if evaluable and tz_zones and totalKnown:
        in_zones=sum(v for z,v in realByZone.items() if z in tz_zones)
        zone_capture=round(in_zones*100/totalKnown,1);zone_hit=in_zones>0
    if evaluable and vr.get("low") is not None:
        vol_in=vr["low"]<=len(observed)<=vr["high"]
    cells_hit=sum(1 for (z,b) in targets if realByBin.get(f"{z}|{b}"))
    caution={
      "couverte":"Heure couverte : la tablette lisait l'écran presque tout le long. La comparaison est fiable pour cette heure.",
      "partielle":"Heure partiellement couverte : des appels ont pu manquer. La comparaison est indicative.",
      "non couverte":"Heure non couverte : la tablette ne lisait pas l'écran. Aucune comparaison : l'absence d'appel enregistré n'est pas un zéro.",
      "inconnue":"Couverture inconnue (heure antérieure à la preuve de couverture). Comparaison provisoire; une heure sans appel n'est pas évaluable.",
    }[status]
    return {
      "target_start":start,"target_end":end,"evaluated_at":evaluated_at,
      "observed_in_window":len(observed),"observed_known_zone":totalKnown,"observed_unknown_zone":unknown,
      "matched_zone_and_bin":hit,"unanticipated_observed":miss,
      "observed_match_share":round(hit*100/totalKnown,1) if (totalKnown and evaluable) else None,
      "cells_flagged":flagged,"cells_with_calls":cells_hit,
      "cell_precision":round(cells_hit*100/flagged,1) if (flagged and evaluable) else None,
      "destination_matches":matchDest,"destination_comparable":destComparable,
      "real_by_zone":dict(realByZone),"real_by_zone_bin":dict(realByBin),
      "by_type":dict(bytype),"predicted_volume":forecast["predicted_volume"],
      "zone_capture_share":zone_capture,"zone_hit":zone_hit,"volume_in_range":vol_in,
      "volume_absolute_gap":(len(observed)-vr["median"]) if (evaluable and vr.get("median") is not None) else None,"volume_percent_gap":None,
      "coverage_status":status,"coverage_bins":bins,"evaluable":evaluable,
      "final":status=="couverte",
      "caution":caution
    }
