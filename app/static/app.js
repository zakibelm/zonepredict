(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => n === undefined || n === null ? '—' : new Intl.NumberFormat('fr-CA').format(Number(n));
  const pct = n => n === undefined || n === null ? '—' : Number(n).toLocaleString('fr-CA', {maximumFractionDigits: 1}) + ' %';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const qcolors = ['#19d3dc','#1590aa','#36a1e2','#6bbed1','#87afc0','#b7cdd3','#f3c676','#fa947b','#957fc7','#4ebd99','#657e8a'];
  const dayNames = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  let dataset = null;
  const cell = (name, cls='') => `<td class="${cls}">${esc(name)}</td>`;
  function set(id, value){ $(id).textContent = value; }
  function message(text, kind){ $('connection').textContent=text; $('connection').className='connection is-'+kind; }
  function timeFmt(value){
    if(!value) return '—';
    try { const date=new Date(value); if(Number.isNaN(date.getTime()))return String(value).slice(0,19); return date.toLocaleString('fr-CA',{timeZone:'America/Toronto',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
    catch{return String(value).slice(0,19);}
  }
  function zoneForecast(f){
    if(!f) { $('forecast-tag').textContent='Aucune prévision';$('forecast-tag').className='pill muted';$('forecast-summary').innerHTML='<div class="empty">Aucun snapshot prévisionnel pour ce créneau. Le premier calcul est prévu à :50, après collecte de l’historique.</div>';return; }
    const d=f.result; const zones=d.zone_ranking||[];
    $('forecast-tag').textContent='Figée à :50';$('forecast-tag').className='pill good';
    const target=esc(d.target_start?.slice(11,16))+'–'+esc(d.target_end?.slice(11,16));
    let content=`<div class="forecast-time">${target} <span class="tiny">America/Toronto</span></div><div class="forecast-sub">${esc(d.segment)} · Volume : <b>${d.predicted_volume==null?'non estimable':fmt(d.predicted_volume)+' appels'}</b> · ${esc(d.historical_days_with_calls)} jour(s) avec activité historique pour ce créneau</div>`;
    if (!zones.length) content += '<div class="empty">Pas encore de signaux historiques admissibles pour cette heure.</div>';
    else {
      content += '<div class="signal-list">';
      zones.slice(0,6).forEach((z,i) => {
        const conf=z.fort_bins?'Fort':z.moyen_bins?'Moyen':'Faible';
        content += `<div class="signal"><div class="signal-r"><span class="rank">${i+1}</span><div><label>Zone ${esc(z.zone)}</label><div><small>${fmt(z.occurrences)} occurrences historiques · ${z.fort_bins} Fort / ${z.moyen_bins} Moyen / ${z.faible_bins} Faible</small></div></div></div><span class="pill ${conf==='Fort'?'good':conf==='Moyen'?'medium':'low'}">${esc(conf)}</span></div>`;
      });
      content+='</div>';
      if(!d.placement?.length)content+='<p class="tiny">Placement non recommandable sans signal Fort démontré.</p>';
      else content+=`<p class="tiny well">Placement prioritaire (signal Fort) : ${d.placement.slice(0,3).map(z=>'zone '+esc(z.zone)).join(', ')}</p>`;
    }
    content += `<p class="tiny">${esc(d.note||'')}</p>`;
    $('forecast-summary').innerHTML=content;
  }
  function forecastMatrix(f){
    if(!f || !Array.isArray(f.result?.matrix) || !f.result.matrix.length){
      $('forecast-matrix').innerHTML='<div class="empty">Aucune occurrence historique disponible pour cette heure, ou calcul non exécuté.</div>';return;
    }
    const p=f.result, hour=p.target_start.slice(11,13), zones=[...new Set(p.matrix.map(c=>c.zone))].sort((a,b)=>Number(a)-Number(b));
    const lookup=new Map(p.matrix.map(c=>[`${c.zone}:${c.bin}`,c]));
    let html=`<table class="matrix-table" aria-label="Matrice ZonePredict des occurrences par zone et créneau"><thead><tr><th>Zone</th>`;
    for(let b=0;b<6;b++){const a=`${hour}:${String(b*10).padStart(2,'0')}`,z=`${String((Number(hour)+(b===5?1:0))%24).padStart(2,'0')}:${String(((b+1)%6)*10).padStart(2,'0')}`;html+=`<th>${a}–${z}</th>`;}
    html+='</tr></thead><tbody>';
    for(const zone of zones){html+=`<tr><td class="zone-name">Zone ${esc(zone)}</td>`;
      for(let b=0;b<6;b++){
        const c=lookup.get(`${zone}:${b}`);
        if(!c){html+='<td class="cell-blank" aria-label="Pas de données"></td>';continue;}
        const cls=c.confidence==='Fort'?'cell-fort':c.confidence==='Moyen'?'cell-medium':'';
        const color=c.occurrences>=12?'#24669c':c.occurrences>=5?'#218f91':c.occurrences>=2?'#3c9878':'#837c49';
        const dest=c.destinations?.map(x=>`${x.zone} (${x.count})`).join(', ')||'inconnue';
        html+=`<td class="${cls}" style="background:${color}" title="${esc(c.confidence)} · ${fmt(c.occurrences)} occurrences · ${fmt(c.distinct_dates)} dates distinctes · destinations: ${esc(dest)}"><div class="cell-num">${fmt(c.occurrences)}</div><span class="cell-tag">${esc(c.confidence.toUpperCase())}</span></td>`;
      }
      html+='</tr>';
    }
    $('forecast-matrix').innerHTML=html+'</tbody></table>';
  }
  function quotas(items,total){
    if(!items?.length){$('quota-list').innerHTML='<div class="empty">Aucun quota disponible</div>';$('donut').style.background='#274550';set('donut-total','—');return;}
    let cursor=0;
    const stops=items.map((x,i)=>{const end=cursor+Number(x.pct||0);const st=`${qcolors[i%qcolors.length]} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`;cursor=end;return st;});
    $('donut').style.background=`conic-gradient(${stops.join(',')})`;
    set('donut-total',fmt(total));
    $('quota-list').innerHTML=items.map((x,i)=>`<div class="quota-item"><span class="swatch" style="background:${qcolors[i%qcolors.length]}"></span><span class="quota-name">${esc(x.type)} ${x.eligible?'':'<span class="tiny">(hors modèle)</span>'}</span><span class="quota-count">${fmt(x.count)}</span><span class="quota-percent">${pct(x.pct)}</span></div>`).join('');
  }
  function lineChart(daily){
    const data=(daily||[]).slice(-25);
    if(!data.length){$('daily-chart').innerHTML='<div class="empty">Aucun jour avec données enregistrées.</div>';return;}
    const W=640,H=200,left=45,top=12,right=13,bottom=37;const iw=W-left-right,ih=H-top-bottom;
    const max=Math.max(1,...data.map(d=>Number(d.count)))*1.15;
    const p=(i,d)=>[left+(data.length===1?iw/2:i/(data.length-1)*iw),top+ih-Number(d.count)/max*ih];
    const points=data.map((d,i)=>p(i,d));const poly=points.map(pt=>pt.join(',')).join(' ');
    const base=top+ih;const area=`M ${points[0][0]} ${base} L ${points.map(pt=>pt.join(' ')).join(' L ')} L ${points[points.length-1][0]} ${base} Z`;
    const grids=Array.from({length:5},(_,i)=>{const y=top+ih*i/4;return `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" stroke="#35515d" stroke-width=".6"/><text x="${left-8}" y="${y+3}" fill="#86a7b4" font-size="10" text-anchor="end">${fmt(Math.round(max*(1-i/4)))}</text>`;}).join('');
    const labelStep=Math.max(1,Math.ceil(data.length/7));const labels=data.map((d,i)=>i%labelStep===0||i===data.length-1?`<text x="${points[i][0]}" y="${H-10}" fill="#9bb4c0" font-size="10" text-anchor="middle">${esc(d.date.slice(5))}</text>`:'').join('');
    const dots=points.map((pt,i)=>`<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="#29e2df" stroke="#173642" stroke-width="2"><title>${esc(data[i].date)} : ${fmt(data[i].count)} appels enregistrés</title></circle>`).join('');
    $('daily-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Volume d'appels par jour enregistré"><defs><linearGradient id="graphFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1cd9d1" stop-opacity=".24"/><stop offset="1" stop-color="#1cd9d1" stop-opacity="0"/></linearGradient></defs>${grids}<path d="${area}" fill="url(#graphFill)"/><polyline points="${poly}" fill="none" stroke="#29e2df" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${labels}</svg>`;
  }
  function heatmap(data){
    const vals=new Map((data||[]).map(x=>[`${x.weekday}_${x.hour}`,Number(x.count)]));
    const max=Math.max(1,...vals.values());
    const color=n=>{const a=Math.max(.2,Math.min(1,n/max));return `rgba(23,221,218,${a.toFixed(2)})`;};
    let html='<div class="heatmap"><div></div>'+dayNames.map(x=>`<div class="dow">${x}</div>`).join('');
    for(let h=0;h<24;h++){
      html+=`<div class="hm-hour">${String(h).padStart(2,'0')} h</div>`;
      for(let d=0;d<7;d++){
        const n=vals.get(`${d}_${h}`);
        html+=`<div class="sq" style="background:${n==null?'#253f48':color(n)}" title="${dayNames[d]} ${String(h).padStart(2,'0')} h — ${n==null?'aucune capture disponible':fmt(n)+' appels enregistrés'}"></div>`;
      }
    }
    html+='</div>';
    $('heatmap').innerHTML=html;
  }
  function tableZones(zones){
    if(!zones?.length){$('zones-table').innerHTML='<div class="empty">Aucune zone admissible enregistrée.</div>';return;}
    $('zones-table').innerHTML=`<table class="table"><thead><tr><th>Zone</th><th class="num">Appels observés</th><th class="num">Part des zones</th></tr></thead><tbody>${zones.slice(0,12).map((z,i)=>`<tr><td><span class="rank">${i+1}</span> &nbsp; Zone ${esc(z.zone)}</td><td class="num">${fmt(z.count)}</td><td class="num">${pct(z.count/zones.reduce((a,x)=>a+Number(x.count),0)*100)}</td></tr>`).join('')}</tbody></table>`;
  }
  function comparison(d){
    const c=d.comparison||{};
    $('comparative').innerHTML=`<div class="metric"><span>Concordance zone + tranche</span><b>${pct(c.coverage_pct)}</b></div><div class="metric"><span>Appels vérifiés dans l’évaluation</span><b>${fmt(c.known_zone_events)}</b></div><div class="metric"><span>Évaluations historiques</span><b>${fmt(c.evaluated_slots)}</b></div><div class="metric"><span>Confiance calibrée</span><b>Non établie</b></div>`;
    const rows=(d.evaluations||[]).slice(0,8);
    if(!rows.length){$('eval-table').innerHTML='<div class="empty">Aucun créneau évalué : le journal figé se constituera dès les premiers bulletins.</div>';return;}
    $('eval-table').innerHTML=`<table class="table"><thead><tr><th>Créneau</th><th class="num">Observés</th><th class="num">Concordants</th><th class="num">Écart non couvert</th></tr></thead><tbody>${rows.map(x=>{const r=x.result;return `<tr><td>${esc(x.target_start.slice(5,16))}</td><td class="num">${fmt(r.observed_in_window)}</td><td class="num">${fmt(r.matched_zone_and_bin)}</td><td class="num">${fmt(r.unanticipated_observed)}</td></tr>`;}).join('')}</tbody></table><p class="tiny">Provisoire : la couverture du dispatch n'est pas attestée, et les appels observés sans zone ne sont pas affectés arbitrairement.</p>`;
  }
  function system(d){
    const sync=d.source?.last_sync;
    const state=!d.source?.configured?'Non configuré':!sync?'Jamais synchronisé':sync.state==='success'?'Dernière lecture OK':'Erreur de lecture';
    $('source-state').textContent=state;
    $('source-state').className='pill '+(sync?.state==='success'?'good':'low');
    const msg=sync?.state==='error'?`<p class="error-note">${esc(sync.message||'Erreur non précisée')}</p>`:'';
    $('system-status').innerHTML=`<div class="system-row"><span>Source de vérité</span><strong>${esc(d.source?.name||'DataTaxi DB')}</strong></div><div class="system-row"><span>Dernière synchronisation tentée</span><strong>${esc(timeFmt(sync?.completed_at||sync?.requested_at))} ${sync?.state==='success'?'· réussie':''}</strong>${msg}</div><div class="system-row"><span>Dernière course observée</span><strong>${esc(d.source?.last_event||'Non disponible')}</strong></div><div class="system-row"><span>Enregistrements en cache</span><strong>${fmt(d.source?.records_cached)} · ${fmt(d.source?.days_cached)} jours avec événements</strong></div><div class="system-row"><span>Zones inconnues (période)</span><strong>${fmt(d.kpi?.demand_zone_unknown)}</strong></div><div class="system-row"><span>Événements incomplets conservés hors calcul</span><strong>${fmt(d.source?.quarantined)}</strong></div>`;
  }
  function render(d){
    dataset=d;
    set('k-total',fmt(d.kpi.total_events));set('k-eligible',fmt(d.kpi.eligible_events));set('k-zones',fmt(d.kpi.active_zones));set('k-days',fmt(d.kpi.days_observed));
    set('k-match',pct(d.comparison.coverage_pct));
    const fc=d.forecast?.upcoming||d.forecast?.current;
    set('k-pred',fc?.result?.predicted_volume==null?'Non estimable':fmt(fc.result.predicted_volume));
    const sync=d.source?.last_sync;
    if(sync?.state==='success')message(`Lecture DataTaxi confirmée · ${fmt(d.source.records_cached)} événements en cache · Dernière course : ${d.source.last_event||'non connue'} · Sync : ${timeFmt(sync.completed_at)}`,'good');
    else if(sync?.state==='error')message('Lecture DataTaxi échouée · '+(sync.message||'Erreur inconnue')+' · les chiffres affichés sont uniquement le cache historique','error');
    else message('Connexion DataTaxi non vérifiée · aucune actualisation authentifiée confirmée. Aucun chiffre estimé n’est affiché.','warn');
    zoneForecast(fc);forecastMatrix(fc);quotas(d.quotas,d.kpi.total_events);lineChart(d.by_date);heatmap(d.heatmap);tableZones(d.zones);comparison(d);system(d);set('last-render','Affichage : '+timeFmt(d.now));
  }
  // ---- Mon placement : récurrences historiques par jour de semaine + heure (sans snapshot) ----
  const fullDays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const pl={weekday:null,hour:null,seg:'weekday',open:new Set()};
  const hh=h=>String(h%24).padStart(2,'0');
  function gradient(n,max){ // jaune → vert → bleu
    const t=max<=1?0:Math.min(1,(n-1)/(max-1));
    const stops=[[243,211,74],[79,207,116],[59,134,217]];
    const [a,b,f]=t<.5?[stops[0],stops[1],t*2]:[stops[1],stops[2],(t-.5)*2];
    return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')+')';
  }
  function binLabel(c){return c.start+'–'+c.end;}
  function destText(c){return (c.destinations||[]).map(x=>`${x.zone==='Inconnue'?'Inconnue':'Zone '+esc(x.zone)} (${pct(x.share)})`).join(', ')||'Inconnue';}
  function renderPlacement(d){
    const h=d.query.hour;
    $('pl-title').textContent=`${fullDays[d.query.weekday]} · ${d.header.slot}`;
    $('pl-tag').textContent=d.query.segment==='weekday'?'Même jour de semaine':'Tous les jours';$('pl-tag').className='pill good';
    $('pl-header').innerHTML=`<span>Jour : <b>${fullDays[d.query.weekday]}</b></span><span>Créneau : <b>${esc(d.header.slot)}</b> (${esc(d.header.timezone)})</span><span>Historique utilisé : <b>${fmt(d.header.history_dates)}</b> date(s) · <b>${fmt(d.header.history_events)}</b> appels</span><span>Source : ${esc(d.header.source)}</span><span>Dernier événement : <b>${esc(d.header.last_event||'—')}</b></span><span>Couverture : ${esc(d.header.coverage)}</span><span>Volume estimé : <b>non estimable</b></span>`;
    const cells=d.matrix||[];
    if(!cells.length){$('pl-matrix').innerHTML='<div class="empty">Aucune récurrence historique admissible pour ce jour et cette heure. Ce n’est pas « zéro appel » : seulement aucune capture enregistrée.</div>';$('pl-table').innerHTML='';return;}
    const max=Math.max(...cells.map(c=>c.occurrences)),lookup=new Map(cells.map(c=>[c.zone+':'+c.bin,c]));
    let html='<table class="matrix-table pm"><thead><tr><th>Zone</th>';
    for(let b=0;b<6;b++)html+=`<th>${hh(h)}:${String(b*10).padStart(2,'0')}–${hh(h+(b===5?1:0))}:${String(((b+1)%6)*10).padStart(2,'0')}</th>`;
    html+='</tr></thead><tbody>';
    for(const z of d.zones){html+=`<tr><td class="zone-name">Zone ${esc(z)}</td>`;
      for(let b=0;b<6;b++){const c=lookup.get(z+':'+b);
        html+=c?`<td class="pc ${c.confidence==='Fort'?'fort':''}" style="background:${gradient(c.occurrences,max)}" title="${esc(c.confidence)} · ${c.distinct_dates} dates · destination : ${esc(destText(c))}">${fmt(c.occurrences)}<small>${c.confidence==='Fort'?'→ '+esc(destText(c).split(' (')[0])+' · ':''}${c.distinct_dates} d.</small></td>`:'<td class="cell-blank"></td>';}
      html+='</tr>';}
    $('pl-matrix').innerHTML=html+'</tbody></table>';
    let t='<table class="table"><thead><tr><th>Zone</th><th>Heure</th><th>Destination (part réelle)</th><th class="num">Occurrence</th><th>Confiance</th></tr></thead><tbody>';
    cells.forEach(c=>{const k=c.zone+':'+c.bin,op=pl.open.has(k);
      t+=`<tr class="dt-row" data-k="${k}"><td>Zone ${esc(c.zone)}</td><td>${esc(binLabel(c))}</td><td>${destText(c)}</td><td class="num">${fmt(c.occurrences)} · ${c.distinct_dates} date(s)</td><td class="conf-${c.confidence}" title="${esc(c.confidence_reason)}">${c.confidence}</td></tr>`;
      if(op)t+=`<tr class="dt-detail"><td colspan="5">${(c.dates_detail||[]).map(x=>`<div><b>${esc(x.date)}</b> · ${x.count} appel(s) · ${x.times.map(esc).join(', ')}</div>`).join('')}<div class="tiny">${esc(c.confidence_reason)}</div></td></tr>`;});
    $('pl-table').innerHTML=t+'</tbody></table>';
    $('pl-table').querySelectorAll('.dt-row').forEach(r=>r.addEventListener('click',()=>{const k=r.dataset.k;pl.open.has(k)?pl.open.delete(k):pl.open.add(k);renderPlacement(d);}));
  }
  async function loadPlacement(){
    const qs=new URLSearchParams({segment:pl.seg});if(pl.weekday!=null)qs.set('weekday',pl.weekday);if(pl.hour!=null)qs.set('hour',pl.hour);
    try{const r=await fetch('/api/placement?'+qs,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();pl.weekday=d.query.weekday;pl.hour=d.query.hour;syncPlacementControls();renderPlacement(d);}
    catch(e){$('pl-matrix').innerHTML='<div class="empty">Impossible de charger le placement : '+esc(e.message)+'</div>';}
  }
  function syncPlacementControls(){
    $('pl-days').innerHTML=fullDays.map((n,i)=>`<button type="button" data-d="${i}" class="${i===pl.weekday?'on':''}">${n.slice(0,3)}</button>`).join('');
    $('pl-days').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{pl.weekday=Number(b.dataset.d);pl.open.clear();loadPlacement();}));
    if(!$('pl-hour').options.length)$('pl-hour').innerHTML=Array.from({length:24},(_,i)=>`<option value="${i}">${hh(i)} h – ${hh(i+1)} h</option>`).join('');
    $('pl-hour').value=pl.hour;$('pl-seg').value=pl.seg;
  }
  function initPlacement(){
    $('pl-hour').addEventListener('change',()=>{pl.hour=Number($('pl-hour').value);pl.open.clear();loadPlacement();});
    $('pl-seg').addEventListener('change',()=>{pl.seg=$('pl-seg').value;loadPlacement();});
    $('pl-prev').addEventListener('click',()=>{if(pl.hour==null)return;if(pl.hour===0){pl.hour=23;pl.weekday=(pl.weekday+6)%7;}else pl.hour--;pl.open.clear();loadPlacement();});
    $('pl-next').addEventListener('click',()=>{if(pl.hour==null)return;if(pl.hour===23){pl.hour=0;pl.weekday=(pl.weekday+1)%7;}else pl.hour++;pl.open.clear();loadPlacement();});
    $('pl-now').addEventListener('click',()=>{pl.weekday=null;pl.hour=null;pl.open.clear();loadPlacement();});
    loadPlacement();
  }
  async function load(){
    $('refresh').disabled=true;
    try{
      const per=$('period').value;let qs='period='+encodeURIComponent(per);
      if(per==='custom'){const a=$('range-start').value,b=$('range-end').value||a;if(!a){message('Choisir une date de début.','warn');return;}qs+='&start='+a+'&end='+b;}
      const r=await fetch('/api/dashboard?'+qs,{cache:'no-store',headers:{'Accept':'application/json'}});
      if(!r.ok){
        let detail='';
        try{const e=await r.json();detail=e.message||e.error||'';}catch(_){}
        throw new Error('HTTP '+r.status+(detail?' — '+detail:''));
      }
      const data=await r.json();render(data);
    } catch(err){message('Impossible de récupérer l’état du dashboard : '+String(err.message||err),'error');}
    finally{$('refresh').disabled=false;}
  }
  $('refresh').addEventListener('click',()=>{load();loadPlacement();});
  $('period').addEventListener('change',()=>{$('custom-range').hidden=$('period').value!=='custom';if($('period').value!=='custom')load();});
  ['range-start','range-end'].forEach(i=>$(i).addEventListener('change',load));
  document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{
    document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('selected'));
    link.classList.add('selected');
  }));
  load();initPlacement();
  // Vue ouverte : actualisation légère toutes les 5 minutes. Le VPS continue à synchroniser sans navigateur.
  setInterval(()=>{load();loadPlacement();},5*60*1000);
})();
