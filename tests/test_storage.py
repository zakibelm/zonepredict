from app.storage import init,persist_events,get_events,store_forecast,get_forecast,store_evaluation,get_evaluations
from app.normalizer import normalize


def test_persist_idempotent_and_immutable(tmp_path):
    db=tmp_path/'data.db';init(db)
    event=normalize({'date':'2026-11-22','heure':'10:01:11','zone':6,'vehicule':424,'service':'Régulier','statut':'recu'})
    a=persist_events(db,'2026-11-22','2026-11-22',[event])
    b=persist_events(db,'2026-11-22','2026-11-22',[event])
    assert a['new']==1 and b['new']==0
    assert len(get_events(db))==1
    f={'target_start':'2026-11-22 11:00:00','target_end':'2026-11-22 12:00:00'}
    assert store_forecast(db,'2026-11-22 11:00:00','2026-11-22T10:50:00-05:00','2026-11-22 10:50:00',f)
    assert not store_forecast(db,'2026-11-22 11:00:00','2026-11-22T10:52:00-05:00','2026-11-22 10:52:00',{'wrong':True})
    assert get_forecast(db,'2026-11-22 11:00:00')['result']==f
    store_evaluation(db,'2026-11-22 11:00:00',{'total':4})
    assert get_evaluations(db)[0]['result']['total']==4
