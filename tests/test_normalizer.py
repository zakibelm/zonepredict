from app.normalizer import normalize,unpack,SchemaError
import pytest


def test_six_columns_and_missing_destination():
    x=normalize({"date":"2026-11-22","heure":"12:58","zone":6,"véhicule":424,"service":"Régulier","statut":"recu"})
    assert x["request_zone"]=="6" and x["destination_zone"] is None and x["eligible"]==1
    assert x["category"]=="Régulier"

def test_pending_unknown_target_never_infer_driver_zone():
    x=normalize({"date":"2026-11-22","heure":"12:58:12","zone":1,"vehicule":424,"service":"","statut":"pris_appel_en_attente"})
    assert x["request_zone"] is None and x["eligible"] == 1

def test_pending_with_explicit_requested_zone():
    x=normalize({"date":"2026-11-22","heure":"12:58:12","zone":1,"zone_demandee":6,"vehicule":424,"service":"","statut":"pris_appel_en_attente"})
    assert x["request_zone"]=="6"

def test_categories_and_exclusions():
    for service in ["Transport adapté","NoLoad","CISSS","Manuel","Reprise système"]:
        a=normalize({"date":"2026-11-22","heure":"00:01:00","zone":1,"vehicule":424,"service":service,"statut":"recu"})
        assert a["eligible"]==0

def test_different_vehicles_same_second_stay_distinct():
    base={"date":"2026-11-22","heure":"00:01:00","zone":1,"service":"Régulier","statut":"recu"}
    assert normalize({**base,"vehicule":424})["event_key"]!=normalize({**base,"vehicule":425})["event_key"]

def test_exact_duplicate_same_event_key():
    base={"date":"2026-11-22","heure":"00:01:00","zone":1,"vehicule":424,"service":"Régulier","statut":"recu"}
    assert normalize(base)["event_key"]==normalize(base)["event_key"]

def test_untrusted_schema_fails_closed():
    with pytest.raises(SchemaError): unpack({"count":8999})
    with pytest.raises(SchemaError): normalize({"date":"2026-11-22","zone":6})


def test_pending_target_explicitly_in_vers_column():
    a=normalize({"date":"2026-11-22","heure":"13:01:00","zone":1,"destination_zone":6,"vehicule":424,"service":"Appel en attente","statut":"pris_appel_en_attente"})
    assert a["request_zone"]=="6" and a["raw_zone"]=="1"
