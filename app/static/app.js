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
  function system(d){
    const sync=d.source?.last_sync;
    const state=!d.source?.configured?'Non configuré':!sync?'Jamais synchronisé':sync.state==='success'?'Dernière lecture OK':'Erreur de lecture';
    $('source-state').textContent=state;
    $('source-state').className='pill '+(sync?.state==='success'?'good':'low');
    const msg=sync?.state==='error'?`<p class="error-note">${esc(sync.message||'Erreur non précisée')}</p>`:'';
    $('system-status').innerHTML=`<div class="system-row"><span>Source de vérité</span><strong>${esc(d.source?.name||'DataTaxi DB')}</strong></div><div class="system-row"><span>Dernière synchronisation tentée</span><strong>${esc(timeFmt(sync?.completed_at||sync?.requested_at))} ${sync?.state==='success'?'· réussie':''}</strong>${msg}</div><div class="system-row"><span>Dernière course observée</span><strong>${esc(d.source?.last_event||'Non disponible')}</strong></div><div class="system-row"><span>Enregistrements en cache</span><strong>${fmt(d.source?.records_cached)} · ${fmt(d.source?.days_cached)} jours avec événements</strong></div><div class="system-row"><span>Zones inconnues (période)</span><strong>${fmt(d.kpi?.demand_zone_unknown)}</strong></div><div class="system-row"><span>Événements incomplets conservés hors calcul</span><strong>${fmt(d.source?.quarantined)}</strong></div>`;
  }
  // ===== Placement : mode A (prévision officielle figée) / mode B (récurrences explorées) =====
  const fullDays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const hh=h=>String(((h%24)+24)%24).padStart(2,'0');
  const st={mode:'A',weekday:null,hour:null,seg:'weekday',sel:null,board:null};
  function gradient(n,max){const t=max<=1?0:Math.min(1,(n-1)/(max-1));const S=[[243,211,74],[79,207,116],[59,134,217]];const [a,b,f]=t<.5?[S[0],S[1],t*2]:[S[1],S[2],(t-.5)*2];return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')+')';}
  const plural=(n,one,many)=>`${fmt(n)} ${n===1?one:many}`;
  const destName=x=>x.zone==='Inconnue'?'destination inconnue':'zone '+esc(x.zone);
  const destText=c=>(c.destinations||[]).map(x=>`${destName(x)} (${pct(x.share)})`).join(', ')||'destination inconnue';
  const binLabel=(h,b)=>`${hh(h)}:${String(b*10).padStart(2,'0')}–${hh(h+(b===5?1:0))}:${String(((b+1)%6)*10).padStart(2,'0')}`;
  const confClass=c=>c==='Fort'?'Fort':c==='Moyen'?'Moyen':'Faible';
  function setMode(m){
    st.mode=m;st.sel=null;
    $('mode-a').classList.toggle('on',m==='A');$('mode-b').classList.toggle('on',m==='B');
    $('mode-a').setAttribute('aria-selected',m==='A');$('mode-b').setAttribute('aria-selected',m==='B');
    $('pl-controls').hidden=m!=='B';
    m==='A'?showOfficial():loadExplore();
  }
  function showOfficial(){
    const d=dataset,fc=d&&(d.forecast?.upcoming||d.forecast?.current);
    $('pl-kind').innerHTML='<b>Prévision officielle.</b> Calculée à :50 avec les appels connus à ce moment-là, puis figée. Elle ne change plus.';
    if(!fc){
      document.querySelector('.pl-legend').hidden=true;
      $('pl-h').textContent='Prochaine heure';$('pl-header').innerHTML='';$('pl-reco').innerHTML='';
      $('pl-matrix').innerHTML='<div class="empty">Pas encore de prévision officielle pour la prochaine heure. Elle est figée à :50. Pour voir les récurrences d’un jour et d’une heure, utilise « Explorer les récurrences ».</div>';
      $('pl-cell').innerHTML='';$('pl-table').innerHTML='';return;}
    const r=fc.result,h=Number(r.target_start.slice(11,13)),wd=(new Date(r.target_start.slice(0,10)+'T12:00:00').getDay()+6)%7;
    st.board={hour:h,cells:r.matrix||[],official:true,
      title:`${fullDays[wd]} · ${hh(h)} h – ${hh(h+1)} h`,
      header:[['Figée à',timeFmt(r.issued_at)],['Jours historiques utilisés',fmt(r.historical_days_with_calls)],['Périmètre',r.segment],['Dernier appel connu',d.source?.last_event||'—'],['Couverture','non établie · volume non estimable']],
      reco:(r.placement||[]).slice(0,5).map(z=>z.zone)};
    renderBoard();
  }
  async function loadExplore(){
    const qs=new URLSearchParams({segment:st.seg});if(st.weekday!=null)qs.set('weekday',st.weekday);if(st.hour!=null)qs.set('hour',st.hour);
    $('pl-kind').innerHTML='<b>Récurrences historiques.</b> Ce que les jours passés montrent pour le jour et l’heure choisis. Ce n’est pas la prévision officielle.';
    try{
      const r=await fetch('/api/placement?'+qs,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();st.weekday=d.query.weekday;st.hour=d.query.hour;syncControls();
      const cells=d.matrix||[];
      st.board={hour:d.query.hour,cells,official:false,title:`${fullDays[d.query.weekday]} · ${hh(d.query.hour)} h – ${hh(d.query.hour+1)} h`,
        header:[['Jours historiques',d.query.segment==='weekday'?'Seulement des '+fullDays[d.query.weekday].toLowerCase()+'s':'Tous les jours'],['Dates utilisées',fmt(d.header.history_dates)],['Appels utilisés',fmt(d.header.history_events)],['Dernier appel connu',d.header.last_event||'—'],['Couverture','non établie · volume non estimable']],
        reco:[...new Set(cells.filter(c=>c.confidence==='Fort').map(c=>c.zone))].sort((a,b)=>a-b)};
      st.sel=null;renderBoard();
    }catch(e){$('pl-matrix').innerHTML='<div class="empty error-note">Impossible de charger les récurrences ('+esc(e.message)+'). Réessaie avec « Actualiser ».</div>';}
  }
  function renderBoard(){
    const B=st.board,cells=B.cells,h=B.hour;
    document.querySelector('.pl-legend').hidden=!cells.length;
    $('pl-h').textContent=B.title;
    $('pl-header').innerHTML=B.header.map(([k,v])=>`<span>${esc(k)} : <b>${esc(v)}</b></span>`).join('');
    $('pl-reco').innerHTML=B.reco.length
      ?`<div class="reco-on"><span class="reco-lbl">${B.official?'Recommandation':'Signaux forts dans l’historique'}</span> ${B.reco.map(z=>'<b>zone '+esc(z)+'</b>').join(' · ')}<small>${B.official?'Au moins deux dates et une destination stable.':'Repère historique seulement, pas une recommandation officielle.'}</small></div>`
      :'<div class="reco-off">Aucun signal fort pour ce créneau. Les signaux moyens ou faibles sont à titre informatif.</div>';
    if(!cells.length){$('pl-matrix').innerHTML='<div class="empty">Aucun appel admissible dans l’historique pour ce jour et cette heure. Ça ne veut pas dire « zéro appel » : seulement aucune donnée enregistrée.</div>';$('pl-cell').innerHTML='';$('pl-table').innerHTML='';return;}
    const zones=[...new Set(cells.map(c=>c.zone))].sort((a,b)=>Number(a)-Number(b));
    const max=Math.max(...cells.map(c=>c.occurrences)),look=new Map(cells.map(c=>[c.zone+':'+c.bin,c]));
    let html='<table class="matrix-table pm"><thead><tr><th scope="col">Zone</th>';
    for(let b=0;b<6;b++)html+=`<th scope="col">${binLabel(h,b)}</th>`;
    html+='</tr></thead><tbody>';
    for(const z of zones){html+=`<tr><th scope="row" class="zone-name">Zone ${esc(z)}</th>`;
      for(let b=0;b<6;b++){const c=look.get(z+':'+b),k=z+':'+b;
        html+=c?`<td class="pc ${c.confidence==='Fort'?'fort':''} ${st.sel===k?'sel':''}" data-k="${k}" tabindex="0" role="button" style="background:${gradient(c.occurrences,max)};color:${(max>1&&(c.occurrences-1)/(max-1)>=.75)?'#fff':'#06141b'}" aria-label="Zone ${esc(z)}, ${binLabel(h,b)}, ${plural(c.occurrences,'appel','appels')}, ${plural(c.distinct_dates,'date','dates')}, confiance ${esc(c.confidence)}"><span class="n1">${plural(c.occurrences,'appel','appels')}</span><span class="n2">${plural(c.distinct_dates,'date','dates')}</span></td>`:'<td class="cell-blank"></td>';}
      html+='</tr>';}
    $('pl-matrix').innerHTML=html+'</tbody></table>';
    let t='<table class="table"><thead><tr><th>Zone</th><th>Heure</th><th>Destination (part réelle)</th><th class="num">Appels</th><th class="num">Dates</th><th>Confiance</th></tr></thead><tbody>';
    cells.forEach(c=>{const k=c.zone+':'+c.bin;t+=`<tr class="dt-row ${st.sel===k?'sel':''}" data-k="${k}" tabindex="0"><td>Zone ${esc(c.zone)}</td><td>${binLabel(h,c.bin)}</td><td>${destText(c)}</td><td class="num">${fmt(c.occurrences)}</td><td class="num">${fmt(c.distinct_dates)}</td><td class="conf-${confClass(c.confidence)}">${esc(c.confidence)}</td></tr>`;});
    $('pl-table').innerHTML=t+'</tbody></table>';
    const pick=k=>{st.sel=st.sel===k?null:k;renderBoard();if(st.sel)$('pl-cell').scrollIntoView({block:'nearest',behavior:'smooth'});};
    document.querySelectorAll('#pl-matrix [data-k],#pl-table [data-k]').forEach(el=>{el.addEventListener('click',()=>pick(el.dataset.k));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(el.dataset.k);}});});
    renderCellDetail();
  }
  function renderCellDetail(){
    const B=st.board,c=st.sel&&B.cells.find(x=>x.zone+':'+x.bin===st.sel);
    if(!c){$('pl-cell').innerHTML='<p class="tiny">Touche une case ou une ligne pour voir les dates, les heures et les destinations.</p>';return;}
    const det=c.dates_detail&&c.dates_detail.length?c.dates_detail:(c.historical_dates||[]).map(d=>({date:d,count:null,times:[]}));
    $('pl-cell').innerHTML=`<div class="cd-head"><b>Zone ${esc(c.zone)} · ${binLabel(B.hour,c.bin)}</b><span class="conf-${confClass(c.confidence)}">${esc(c.confidence)}</span></div>
      <p>${plural(c.occurrences,'appel','appels')} sur ${plural(c.distinct_dates,'date','dates')} · ${destText(c)}</p><p class="tiny">${esc(c.confidence_reason||'')}</p>
      <ul class="cd-dates">${det.map(x=>`<li><b>${esc(x.date)}</b>${x.count!=null?' · '+plural(x.count,'appel','appels'):''}${x.times?.length?' · '+x.times.map(esc).join(', '):''}</li>`).join('')}</ul>
      ${c.dates_detail?'':'<p class="tiny">Cette prévision a été figée avant l’ajout du détail des heures : seules les dates sont conservées.</p>'}`;
  }
  function syncControls(){
    $('pl-days').innerHTML=fullDays.map((n,i)=>`<button type="button" data-d="${i}" class="${i===st.weekday?'on':''}" aria-pressed="${i===st.weekday}">${n.slice(0,3)}</button>`).join('');
    $('pl-days').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{st.weekday=Number(b.dataset.d);loadExplore();}));
    if(!$('pl-hour').options.length)$('pl-hour').innerHTML=Array.from({length:24},(_,i)=>`<option value="${i}">${hh(i)} h – ${hh(i+1)} h</option>`).join('');
    $('pl-hour').value=st.hour;$('pl-seg').value=st.seg;
  }
  // ===== Prévu et vécu =====
  function benchmark(d){
    const evs=(d.evaluations||[]),fcs=d.forecast?.history||[];
    const ev=evs[0];
    if(!ev){
      $('bm-tag').textContent='Pas encore évaluable';$('bm-tag').className='pill muted';
      $('bm-cards').innerHTML='<div class="empty">Aucune comparaison pour l’instant. Une prévision peut être comparée une fois son heure terminée (vers H:05). Rien n’est simulé.</div>';$('bm-table').innerHTML='';
    }else{
      const r=ev.result,f=fcs.find(x=>x.target_start===ev.target_start)?.result,cells=f?.matrix||[];
      const fort=cells.filter(c=>c.confidence==='Fort').length;
      $('bm-tag').textContent=r.final?'Évaluation finale':'Évaluation provisoire';$('bm-tag').className='pill warn';
      $('bm-cards').innerHTML=`<div class="bm-h">${esc(ev.target_start.slice(0,10))} · ${esc(ev.target_start.slice(11,16))}–${esc(r.target_end.slice(11,16))}</div>
        <div class="bm-3"><div class="bm-col"><h4>Prévu</h4><b>${fmt(cells.length)}</b><span>cases signalées (${fmt(fort)} fortes)</span><small>Volume : non estimé</small></div>
        <div class="bm-col"><h4>Vécu</h4><b>${fmt(r.observed_known_zone)}</b><span>appels avec zone connue</span><small>${fmt(r.observed_unknown_zone)} sans zone</small></div>
        <div class="bm-col"><h4>Écart</h4><b>${fmt(r.matched_zone_and_bin)} / ${fmt(r.unanticipated_observed)}</b><span>annoncés / non annoncés</span><small>Écart de volume : non calculable</small></div></div>
        <p class="tiny">${esc(r.caution||'')}</p>`;
      const real=r.real_by_zone_bin||{},keys=new Map();
      cells.forEach(c=>keys.set(c.zone+'|'+c.bin,{zone:c.zone,bin:c.bin,pred:c,real:0}));
      Object.entries(real).forEach(([k,n])=>{const [z,b]=k.split('|');const o=keys.get(k)||{zone:z,bin:Number(b),pred:null,real:0};o.real=n;keys.set(k,o);});
      const h=Number(ev.target_start.slice(11,13));
      const rows=[...keys.values()].sort((a,b)=>Number(a.zone)-Number(b.zone)||a.bin-b.bin);
      $('bm-table').innerHTML=rows.length?`<table class="table"><thead><tr><th>Zone</th><th>Tranche</th><th>Prévu</th><th class="num">Vécu</th><th>Résultat</th></tr></thead><tbody>${rows.map(o=>`<tr><td>Zone ${esc(o.zone)}</td><td>${binLabel(h,o.bin)}</td><td>${o.pred?esc(o.pred.confidence)+' · '+plural(o.pred.occurrences,'appel','appels')+' dans l’historique':'—'}</td><td class="num">${fmt(o.real)}</td><td>${o.pred&&o.real?'Annoncé et observé':o.pred?'Annoncé, non observé (couverture non établie)':'Non annoncé'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucun signal ni appel dans cette heure.</div>';
    }
    trendCharts(d);
  }
  function trendCharts(d){
    const range=$('bm-range').value,now=Date.now(),lim=range==='24h'?864e5:range==='7d'?6048e5:Infinity;
    const within=t=>now-new Date(t.replace(' ','T')).getTime()<=lim;
    const fcs=(d.forecast?.history||[]).filter(f=>within(f.target_start)).slice().reverse();
    const evs=(d.evaluations||[]).filter(e=>within(e.target_start)).slice().reverse();
    const bars=(items,name)=>items.length?items:[];
    // Confiance : barres empilées par prévision (nombre de cases)
    if(!fcs.length)$('bm-conf').innerHTML='<div class="empty">Aucune prévision sur cette période.</div>';
    else{const W=520,H=170,L=30,mx=Math.max(1,...fcs.map(f=>(f.result.matrix||[]).length)),bw=Math.max(6,Math.min(34,(W-L)/fcs.length-6));
      const col={Fort:'#ff6b6b',Moyen:'#f4be61',Faible:'#6d8793'};
      let g='';fcs.forEach((f,i)=>{let y=H-24;const x=L+i*((W-L)/fcs.length)+3;
        ['Faible','Moyen','Fort'].forEach(k=>{const n=(f.result.matrix||[]).filter(c=>c.confidence===k).length,hgt=n/mx*(H-40);y-=hgt;g+=`<rect x="${x}" y="${y}" width="${bw}" height="${hgt}" fill="${col[k]}"><title>${f.target_start.slice(5,16)} · ${k} : ${n}</title></rect>`;});
        g+=`<text x="${x+bw/2}" y="${H-8}" font-size="9" fill="#9bb4c0" text-anchor="middle">${f.target_start.slice(11,13)}h</text>`;});
      $('bm-conf').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nombre de signaux Fort, Moyen et Faible par prévision">${g}</svg><div class="pl-legend"><span><i class="lg" style="background:#ff6b6b"></i> Fort</span><span><i class="lg" style="background:#f4be61"></i> Moyen</span><span><i class="lg" style="background:#6d8793"></i> Faible</span></div>`;}
    // Précision : part des appels annoncés ; périodes non évaluables = vides
    const pts=evs.filter(e=>e.result.observed_match_share!=null);
    if(!pts.length)$('bm-acc').innerHTML='<div class="empty">Aucune heure évaluable sur cette période. Les heures sans évaluation restent vides, jamais à zéro.</div>';
    else{const W=520,H=170,L=34;const X=i=>pts.length===1?W/2:L+i/(pts.length-1)*(W-L-12),Y=v=>H-26-(v/100)*(H-44);
      $('bm-acc').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Part des appels annoncés par heure évaluée"><line x1="${L}" y1="${Y(0)}" x2="${W-8}" y2="${Y(0)}" stroke="#35515d"/><line x1="${L}" y1="${Y(100)}" x2="${W-8}" y2="${Y(100)}" stroke="#35515d" stroke-dasharray="3"/><text x="4" y="${Y(100)+3}" font-size="9" fill="#9bb4c0">100 %</text><text x="4" y="${Y(0)+3}" font-size="9" fill="#9bb4c0">0 %</text><polyline fill="none" stroke="#29e2df" stroke-width="2" points="${pts.map((e,i)=>X(i)+','+Y(e.result.observed_match_share)).join(' ')}"/>${pts.map((e,i)=>`<circle cx="${X(i)}" cy="${Y(e.result.observed_match_share)}" r="4" fill="#29e2df"><title>${e.target_start.slice(5,16)} · ${pct(e.result.observed_match_share)} annoncés · ${e.result.unanticipated_observed} non annoncés</title></circle>`).join('')}</svg><p class="tiny">${pts.length} heure(s) évaluée(s). Évaluations provisoires : la couverture n’est pas établie.</p>`;}
  }
  function render(d){
    dataset=d;
    set('k-total',fmt(d.kpi.total_events));set('k-eligible',fmt(d.kpi.eligible_events));set('k-zones',fmt(d.kpi.active_zones));set('k-days',fmt(d.kpi.days_observed));
    const sync=d.source?.last_sync;
    if(sync?.state==='success')message(`Données à jour · dernier appel ${d.source.last_event||'inconnu'} · synchronisé ${timeFmt(sync.completed_at)}`,'good');
    else if(sync?.state==='error')message('Lecture des données en erreur · '+(sync.message||'cause inconnue')+' · on affiche seulement l’historique déjà reçu','error');
    else message('Connexion aux données non confirmée','warn');
    quotas(d.quotas,d.kpi.total_events);lineChart(d.by_date);heatmap(d.heatmap);tableZones(d.zones);system(d);benchmark(d);
    set('last-render','· Affiché à '+timeFmt(d.now));
    if(st.mode==='A')showOfficial();
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
  $('refresh').addEventListener('click',()=>{load();if(st.mode==='B')loadExplore();});
  $('period').addEventListener('change',()=>{$('custom-range').hidden=$('period').value!=='custom';if($('period').value!=='custom')load();});
  ['range-start','range-end'].forEach(i=>$(i).addEventListener('change',load));
  document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{
    document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('selected'));
    link.classList.add('selected');
  }));
  $('mode-a').addEventListener('click',()=>setMode('A'));$('mode-b').addEventListener('click',()=>setMode('B'));
  $('pl-hour').addEventListener('change',()=>{st.hour=Number($('pl-hour').value);loadExplore();});
  $('pl-seg').addEventListener('change',()=>{st.seg=$('pl-seg').value;loadExplore();});
  $('pl-prev').addEventListener('click',()=>{if(st.hour==null)return;if(st.hour===0){st.hour=23;st.weekday=(st.weekday+6)%7;}else st.hour--;loadExplore();});
  $('pl-next').addEventListener('click',()=>{if(st.hour==null)return;if(st.hour===23){st.hour=0;st.weekday=(st.weekday+1)%7;}else st.hour++;loadExplore();});
  $('pl-now').addEventListener('click',()=>{st.weekday=null;st.hour=null;loadExplore();});
  $('bm-range').addEventListener('change',()=>{if(dataset)trendCharts(dataset);});
  load();
  {const m=location.hash.match(/^#explorer(?:\/([0-6])\/(\d{1,2}))?$/);if(m){if(m[1]!=null){st.weekday=Number(m[1]);st.hour=Math.min(23,Number(m[2]));}setMode('B');}}
  // Vue ouverte : actualisation légère toutes les 5 minutes. Le VPS continue à synchroniser sans navigateur.
  setInterval(()=>{load();if(st.mode==='B')loadExplore();},5*60*1000);
})();
