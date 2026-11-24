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
  function message(text, kind){ $('connection').textContent=text; $('connection').className='chip is-'+kind; }
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
    $('source-state').className='chip '+(sync?.state==='success'?'is-good':'is-error');
    const msg=sync?.state==='error'?`<p class="error-note">${esc(sync.message||'Erreur non précisée')}</p>`:'';
    $('system-status').innerHTML=`<div class="system-row"><span>Source de vérité</span><strong>${esc(d.source?.name||'DataTaxi DB')}</strong></div><div class="system-row"><span>Dernière synchronisation tentée</span><strong>${esc(timeFmt(sync?.completed_at||sync?.requested_at))} ${sync?.state==='success'?'· réussie':''}</strong>${msg}</div><div class="system-row"><span>Dernière course observée</span><strong>${esc(d.source?.last_event||'Non disponible')}</strong></div><div class="system-row"><span>Enregistrements en cache</span><strong>${fmt(d.source?.records_cached)} · ${fmt(d.source?.days_cached)} jours avec événements</strong></div><div class="system-row"><span>Zones inconnues (période)</span><strong>${fmt(d.kpi?.demand_zone_unknown)}</strong></div><div class="system-row"><span>Événements incomplets conservés hors calcul</span><strong>${fmt(d.source?.quarantined)}</strong></div>`;
  }
  // ===== Application multi-pages =====
  const ROUTES={placement:'Placement',comparaison:'Prévu et vécu',statistiques:'Statistiques',sante:'Santé des données'};
  const fullDays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const hh=h=>String(((h%24)+24)%24).padStart(2,'0');
  const KEY='zonepredict.ui';
  const saved=(()=>{try{return JSON.parse(sessionStorage.getItem(KEY))||{};}catch{return{};}})();
  const st=Object.assign({mode:'A',snap:0,weekday:null,hour:null,seg:'weekday',filter:'mf',sel:null,page:0,zone:0,bmTab:'zones',bmRange:'7d',stTab:'volume',period:'7d',collapsed:false},saved,{board:null});
  const persist=()=>{try{const {board,...r}=st;sessionStorage.setItem(KEY,JSON.stringify(r));}catch{}};
  const mq=window.matchMedia('(max-width:899px)');const isMobile=()=>mq.matches;
  const plural=(n,one,many)=>`${fmt(n)} ${n===1?one:many}`;
  const destName=x=>x.zone==='Inconnue'?'destination inconnue':'zone '+esc(x.zone);
  const destText=c=>(c.destinations||[]).map(x=>`${destName(x)} (${pct(x.share)})`).join(', ')||'destination inconnue';
  const binLabel=(h,b)=>`${hh(h)}:${String(b*10).padStart(2,'0')}–${hh(h+(b===5?1:0))}:${String(((b+1)%6)*10).padStart(2,'0')}`;
  function gradient(n,max){const t=max<=1?0:Math.min(1,(n-1)/(max-1));const S=[[243,211,74],[79,207,116],[59,134,217]];const [a,b,f]=t<.5?[S[0],S[1],t*2]:[S[1],S[2],(t-.5)*2];return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')+')';}
  const txtOn=(n,max)=>(max>1&&(n-1)/(max-1)>=.75)?'#fff':'#06141b';
  let route='placement';

  // ---------- Routeur ----------
  function routeFromPath(){const p=location.pathname.replace(/^\/+|\/+$/g,'');return ROUTES[p]?p:'placement';}
  function show(r,push){
    route=r;
    document.querySelectorAll('.page').forEach(x=>x.classList.toggle('on',x.id==='page-'+r));
    document.querySelectorAll('.nav').forEach(x=>{const on=x.dataset.route===r;x.classList.toggle('on',on);on?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current');});
    $('page-title').textContent=ROUTES[r];document.title='ZonePredict · '+ROUTES[r];
    if(push&&location.pathname!=='/'+r)history.pushState({r},'','/'+r);
    window.scrollTo(0,0);
    requestAnimationFrame(()=>{if(r==='placement')refreshPlacement();if(r==='comparaison')benchmarkPanes();});
  }
  document.querySelectorAll('[data-route]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const r=a.dataset.route||'placement';show(r,true);}));
  window.addEventListener('popstate',()=>show(routeFromPath(),false));

  // ---------- Placement ----------
  function infoText(){return st.mode==='A'
    ?'<b>Prévision officielle.</b> Calculée à :50 avec les appels connus à ce moment-là, puis figée. Fort : au moins 2 dates et une destination stable. Moyen : au moins 2 dates, destination incomplète. Ce n’est pas une probabilité. Une case vide ne veut pas dire zéro appel.'
    :'<b>Explorer.</b> Récurrences des jours passés pour le jour et l’heure choisis. Ce n’est pas la prévision officielle. Fort : au moins 2 dates et une destination stable. Une case vide ne veut pas dire zéro appel.';}
  function setMode(m){st.mode=m;st.sel=null;st.page=0;st.zone=0;persist();syncBar();m==='A'?loadOfficial():loadExplore();}
  function syncBar(){
    $('mode-a').classList.toggle('on',st.mode==='A');$('mode-b').classList.toggle('on',st.mode==='B');
    $('mode-a').setAttribute('aria-selected',st.mode==='A');$('mode-b').setAttribute('aria-selected',st.mode==='B');
    $('pl-days').style.display=st.mode==='B'?'flex':'none';$('pl-hour').style.display=st.mode==='B'?'':'none';$('pl-seg').hidden=st.mode!=='B';
    $('pl-days').innerHTML=fullDays.map((n,i)=>`<button type="button" data-d="${i}" class="${i===st.weekday?'on':''}" aria-pressed="${i===st.weekday}">${n.slice(0,3)}</button>`).join('');
    $('pl-days').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{st.weekday=Number(b.dataset.d);st.sel=null;st.page=0;loadExplore();}));
    if(!$('pl-hour').options.length)$('pl-hour').innerHTML=Array.from({length:24},(_,i)=>`<option value="${i}">${hh(i)} h – ${hh(i+1)} h</option>`).join('');
    if(st.hour!=null)$('pl-hour').value=st.hour;$('pl-seg').value=st.seg;$('pl-filter').value=st.filter;
    $('pl-info-pop').innerHTML=infoText();
  }
  function loadOfficial(){
    const d=dataset,list=d?.forecast?.history||[];
    if(!list.length){st.board={empty:'Pas encore de prévision officielle. Elle est figée à :50.',official:true,cells:[],hour:0};renderBoard();return;}
    st.snap=Math.max(0,Math.min(st.snap,list.length-1));
    const f=list[st.snap],r=f.result,h=Number(r.target_start.slice(11,13)),wd=(new Date(r.target_start.slice(0,10)+'T12:00:00').getDay()+6)%7;
    st.board={official:true,hour:h,cells:r.matrix||[],title:`${fullDays[wd]} · ${hh(h)} h – ${hh(h+1)} h`,
      meta:`Figée à ${timeFmt(r.issued_at)} · ${fmt(r.historical_days_with_calls)} dates · ${r.segment?.startsWith('global')?'tous les jours':esc(r.segment||'')}`,reco:(r.placement||[]).map(z=>z.zone)};
    renderBoard();
  }
  async function loadExplore(){
    const qs=new URLSearchParams({segment:st.seg});if(st.weekday!=null)qs.set('weekday',st.weekday);if(st.hour!=null)qs.set('hour',st.hour);
    try{
      const r=await fetch('/api/placement?'+qs,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();st.weekday=d.query.weekday;st.hour=d.query.hour;persist();syncBar();
      const cells=d.matrix||[];
      st.board={official:false,hour:d.query.hour,cells,title:`${fullDays[d.query.weekday]} · ${hh(d.query.hour)} h – ${hh(d.query.hour+1)} h`,
        meta:`${fmt(d.header.history_dates)} dates · ${fmt(d.header.history_events)} appels · ${d.query.segment==='weekday'?'même jour de semaine':'tous les jours'}`,reco:[...new Set(cells.filter(c=>c.confidence==='Fort').map(c=>c.zone))]};
      renderBoard();
    }catch(e){st.board={empty:'Impossible de charger les récurrences ('+e.message+').',cells:[],hour:0};renderBoard();}
  }
  function visible(cells){return cells.filter(c=>st.filter==='all'||(st.filter==='f'?c.confidence==='Fort':c.confidence!=='Faible'));}
  function best(cells){const rank={Fort:2,Moyen:1,Faible:0};return cells.slice().sort((a,b)=>rank[b.confidence]-rank[a.confidence]||b.occurrences-a.occurrences)[0];}
  const keyOf=c=>c.zone+':'+c.bin;
  function refreshPlacement(){if(!st.board){st.mode==='A'?loadOfficial():loadExplore();}else renderBoard();}
  function perPage(){const h=$('pl-matrix').clientHeight;return h>60?Math.max(1,Math.floor((h-34)/56)):6;}
  function renderBoard(){
    const B=st.board;if(!B)return;
    const nav=$('pl-prev');
    $('pl-info-pop').innerHTML=infoText();
    if(B.empty){$('pl-title-line').innerHTML='';$('pl-matrix').innerHTML=`<div class="empty">${esc(B.empty)}</div>`;$('pl-pager').innerHTML='';$('pl-side').innerHTML='';return;}
    const cells=visible(B.cells),zones=[...new Set(cells.map(c=>c.zone))].sort((a,b)=>Number(a)-Number(b)),h=B.hour;
    $('pl-title-line').innerHTML=`<b>${esc(B.title)}</b> · ${B.meta}${B.reco.length?` · <span class="reco-chip">zones fortes : <b>${B.reco.slice().sort((a,b)=>a-b).map(esc).join(' · ')}</b></span>`:''}`;
    if(!cells.length){
      const hidden=B.cells.length;
      $('pl-matrix').innerHTML=`<div class="empty">${hidden?'Aucun signal '+(st.filter==='f'?'fort':'moyen ou fort')+' pour ce créneau. Les signaux faibles restent dans l’historique : choisis « Tous (avec Faible) » pour les voir.':'Aucune donnée admissible pour ce créneau. Ce n’est pas « zéro appel » : rien n’est enregistré.'}</div>`;
      $('pl-pager').innerHTML='';$('pl-side').innerHTML='<div class="tiny">Aucun signal à afficher.</div>';return;}
    if(!st.sel||!cells.some(c=>keyOf(c)===st.sel)){const b=best(cells);st.sel=keyOf(b);}
    const max=Math.max(...cells.map(c=>c.occurrences));
    if(isMobile())renderZoneView(cells,zones,h,max);else renderGrid(cells,zones,h,max);
    renderSide(B.cells.find(c=>keyOf(c)===st.sel),B);
  }
  function selectKey(k){st.sel=k;persist();renderBoard();}
  function renderGrid(cells,zones,h,max){
    const pp=perPage(),pages=Math.max(1,Math.ceil(zones.length/pp));
    const si=zones.findIndex(z=>z===st.sel.split(':')[0]);
    if(st.page>=pages)st.page=pages-1;if(st.page<0)st.page=0;
    const look=new Map(cells.map(c=>[keyOf(c),c])),slice=zones.slice(st.page*pp,st.page*pp+pp);
    let html='<table class="mx"><thead><tr><th class="z" scope="col">Zone</th>';
    for(let b=0;b<6;b++)html+=`<th scope="col">${binLabel(h,b)}</th>`;
    html+='</tr></thead><tbody>';
    for(const z of slice){html+=`<tr><th class="z" scope="row">Zone ${esc(z)}</th>`;
      for(let b=0;b<6;b++){const c=look.get(z+':'+b),k=z+':'+b;
        html+=c?`<td class="pc ${c.confidence==='Fort'?'fort':''} ${st.sel===k?'sel':''}" data-k="${k}" tabindex="0" role="button" style="background:${gradient(c.occurrences,max)};color:${txtOn(c.occurrences,max)}" aria-label="Zone ${esc(z)}, ${binLabel(h,b)}, ${plural(c.occurrences,'appel','appels')}, ${plural(c.distinct_dates,'date','dates')}, ${esc(c.confidence)}"><span class="n1">${plural(c.occurrences,'appel','appels')}</span><span class="n2">${plural(c.distinct_dates,'date','dates')}</span></td>`:'<td class="blank"></td>';}
      html+='</tr>';}
    $('pl-matrix').innerHTML=html+'</tbody></table>';
    $('pl-pager').innerHTML=pages>1?`<button class="btn" id="pg-prev" ${st.page===0?'disabled':''} aria-label="Zones précédentes">‹</button><span>Zones ${st.page*pp+1}–${Math.min(zones.length,st.page*pp+pp)} sur ${zones.length}</span><button class="btn" id="pg-next" ${st.page>=pages-1?'disabled':''} aria-label="Zones suivantes">›</button>`:`<span>${zones.length} zone${zones.length>1?'s':''}</span>`;
    $('pg-prev')?.addEventListener('click',()=>{st.page--;renderBoard();});$('pg-next')?.addEventListener('click',()=>{st.page++;renderBoard();});
    $('pl-matrix').querySelectorAll('[data-k]').forEach(el=>{el.addEventListener('click',()=>selectKey(el.dataset.k));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectKey(el.dataset.k);}});});
  }
  function renderZoneView(cells,zones,h,max){
    if(st.zone>=zones.length)st.zone=0;
    const z=zones[st.zone],look=new Map(cells.filter(c=>c.zone===z).map(c=>[c.bin,c]));
    let html=`<div class="zv"><div class="zv-nav"><button class="btn" id="zv-prev" aria-label="Zone précédente">‹</button><b>Zone ${esc(z)}</b><button class="btn" id="zv-next" aria-label="Zone suivante">›</button></div><div class="tiny" style="text-align:center">${st.zone+1} sur ${zones.length}</div>`;
    for(let b=0;b<6;b++){const c=look.get(b),k=z+':'+b;
      html+=c?`<button type="button" class="zv-row ${c.confidence==='Fort'?'fort':''} ${st.sel===k?'sel':''}" data-k="${k}" style="background:${gradient(c.occurrences,max)};color:${txtOn(c.occurrences,max)}"><span>${binLabel(h,b)}</span><span style="text-align:right">${plural(c.occurrences,'appel','appels')}<small>${plural(c.distinct_dates,'date','dates')}</small></span></button>`:`<div class="zv-row blank"><span>${binLabel(h,b)}</span><span>—</span></div>`;}
    $('pl-matrix').innerHTML=html+'</div>';$('pl-pager').innerHTML='';
    $('zv-prev').addEventListener('click',()=>{st.zone=(st.zone+zones.length-1)%zones.length;st.sel=null;renderBoard();});
    $('zv-next').addEventListener('click',()=>{st.zone=(st.zone+1)%zones.length;st.sel=null;renderBoard();});
    $('pl-matrix').querySelectorAll('[data-k]').forEach(el=>el.addEventListener('click',()=>selectKey(el.dataset.k)));
  }
  function renderSide(c,B){
    if(!c){$('pl-side').innerHTML='<div class="tiny">Touche une case pour voir le détail.</div>';return;}
    const det=c.dates_detail?.length?c.dates_detail:(c.historical_dates||[]).map(d=>({date:d,count:null,times:[]}));
    const fort=c.confidence==='Fort';
    const advice=fort?`<div class="advice">${B.official?'<b>Conseil :</b> se placer en zone '+esc(c.zone)+' de '+binLabel(B.hour,c.bin).replace('–',' à ')+'.':'<b>Repère historique :</b> la zone '+esc(c.zone)+' revient à cette tranche. Ce n’est pas une prévision officielle.'}</div>`:'<div class="advice no">Signal à titre informatif. Pas de conseil de déplacement.</div>';
    $('pl-side').innerHTML=`<div class="row"><h2>Zone ${esc(c.zone)}</h2><span class="badge b-${c.confidence}">${esc(c.confidence)}</span></div>
      <div><b>${binLabel(B.hour,c.bin)}</b> · ${plural(c.occurrences,'appel','appels')} sur ${plural(c.distinct_dates,'date','dates')}</div>${advice}
      <h3>Pourquoi</h3><div>${esc(c.confidence_reason||'')}</div>
      <h3>Destination</h3><div>${destText(c)}</div>
      <h3>Dates</h3><ul class="dates">${det.map(x=>`<li><b>${esc(x.date)}</b>${x.count!=null?' · '+plural(x.count,'appel','appels'):''}${x.times?.length?' · '+x.times.map(esc).join(', '):''}</li>`).join('')}</ul>
      ${c.dates_detail?'':'<div class="tiny">Prévision figée avant l’ajout des heures : seules les dates sont conservées.</div>'}`;
  }
  // barre du haut
  $('mode-a').addEventListener('click',()=>setMode('A'));$('mode-b').addEventListener('click',()=>setMode('B'));
  $('pl-filter').addEventListener('change',()=>{st.filter=$('pl-filter').value;st.sel=null;st.page=0;persist();renderBoard();});
  $('pl-seg').addEventListener('change',()=>{st.seg=$('pl-seg').value;st.sel=null;persist();loadExplore();});
  $('pl-hour').addEventListener('change',()=>{st.hour=Number($('pl-hour').value);st.sel=null;st.page=0;loadExplore();});
  $('pl-prev').addEventListener('click',()=>{
    if(st.mode==='A'){st.snap++;st.sel=null;st.page=0;persist();loadOfficial();return;}
    if(st.hour==null)return;if(st.hour===0){st.hour=23;st.weekday=(st.weekday+6)%7;}else st.hour--;st.sel=null;st.page=0;loadExplore();});
  $('pl-next').addEventListener('click',()=>{
    if(st.mode==='A'){st.snap=Math.max(0,st.snap-1);st.sel=null;st.page=0;persist();loadOfficial();return;}
    if(st.hour==null)return;if(st.hour===23){st.hour=0;st.weekday=(st.weekday+1)%7;}else st.hour++;st.sel=null;st.page=0;loadExplore();});
  $('pl-now').addEventListener('click',()=>{st.snap=0;st.weekday=null;st.hour=null;st.sel=null;st.page=0;st.mode==='A'?loadOfficial():loadExplore();});
  $('pl-info').addEventListener('click',()=>{const o=$('pl-info-pop').hidden;$('pl-info-pop').hidden=!o;$('pl-info').setAttribute('aria-expanded',o);});
  document.addEventListener('click',e=>{if(!e.target.closest('.info-wrap')){$('pl-info-pop').hidden=true;$('pl-info').setAttribute('aria-expanded',false);}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('pl-info-pop').hidden=true;});
  if('ResizeObserver' in window)new ResizeObserver(()=>{if(route==='placement'&&st.board&&!isMobile())renderBoard();}).observe($('pl-matrix'));
  mq.addEventListener?.('change',()=>{if(st.board)renderBoard();});

  // ---------- Prévu / vécu ----------
  function benchmark(d){
    const evs=d.evaluations||[],fcs=d.forecast?.history||[],ev=evs[0];
    if(!ev){
      $('bm-tag').textContent='Pas encore évaluable';$('bm-tag').className='chip';$('bm-slot').textContent='';
      $('bm-cards').innerHTML='<div class="empty" style="grid-column:1/-1;min-height:70px">Aucune comparaison pour l’instant. Une prévision est comparée une fois son heure terminée (vers H:05). Rien n’est simulé.</div>';
      $('bm-zones').innerHTML='<div class="empty">Aucune heure évaluée.</div>';
    }else{
      const r=ev.result,f=fcs.find(x=>x.target_start===ev.target_start)?.result,cells=f?.matrix||[],fort=cells.filter(c=>c.confidence==='Fort').length;
      const cs=r.coverage_status||'inconnue';
      $('bm-tag').textContent=cs==='couverte'?'Heure couverte':cs==='partielle'?'Couverture partielle':cs==='non couverte'?'Heure non couverte':'Couverture inconnue';
      $('bm-tag').className='chip '+(cs==='couverte'?'is-good':cs==='non couverte'?'is-error':'is-warn');
      $('bm-slot').innerHTML=`<b>${esc(ev.target_start.slice(0,10))} · ${esc(ev.target_start.slice(11,16))}–${esc(r.target_end.slice(11,16))}</b>`;
      if(r.evaluable===false){
        $('bm-cards').innerHTML=`<div class="empty" style="grid-column:1/-1;min-height:70px">${esc(r.caution||'Heure non évaluable.')}</div>`;
        $('bm-zones').innerHTML='<div class="empty">Aucune comparaison pour cette heure : la tablette ne lisait pas l’écran, donc l’absence d’appel enregistré n’est pas un zéro.</div>';
        benchmarkPanes();return;
      }
      $('bm-cards').innerHTML=`<div class="bm-col"><h4>Prévu</h4><b>${fmt(cells.length)}</b><span>cases signalées (${fmt(fort)} fortes)</span><small>Volume non estimé</small></div>
        <div class="bm-col"><h4>Vécu</h4><b>${fmt(r.observed_known_zone)}</b><span>appels avec zone connue</span><small>${fmt(r.observed_unknown_zone)} sans zone</small></div>
        <div class="bm-col"><h4>Écart</h4><b>${fmt(r.matched_zone_and_bin)} / ${fmt(r.unanticipated_observed)}</b><span>annoncés / non annoncés</span><small>${r.cell_precision!=null?'Cases utiles : '+pct(r.cell_precision):'Écart de volume non calculable'}</small></div>`;
      const real=r.real_by_zone_bin||{},keys=new Map();
      cells.forEach(c=>keys.set(c.zone+'|'+c.bin,{zone:c.zone,bin:c.bin,pred:c,real:0}));
      Object.entries(real).forEach(([k,n])=>{const [z,b]=k.split('|');const o=keys.get(k)||{zone:z,bin:Number(b),pred:null,real:0};o.real=n;keys.set(k,o);});
      const h=Number(ev.target_start.slice(11,13)),rows=[...keys.values()].sort((a,b)=>Number(a.zone)-Number(b.zone)||a.bin-b.bin);
      $('bm-zones').innerHTML=rows.length?`<table class="table"><thead><tr><th>Zone</th><th>Tranche</th><th>Prévu</th><th class="num">Vécu</th><th>Résultat</th></tr></thead><tbody>${rows.map(o=>`<tr><td>Zone ${esc(o.zone)}</td><td>${binLabel(h,o.bin)}</td><td>${o.pred?esc(o.pred.confidence)+' · '+plural(o.pred.occurrences,'appel','appels'):'—'}</td><td class="num">${fmt(o.real)}</td><td>${o.pred&&o.real?'Annoncé et observé':o.pred?'Annoncé, non observé':'Non annoncé'}</td></tr>`).join('')}</tbody></table><p class="tiny" style="padding:6px 8px">${esc(r.caution||'')}</p>`:'<div class="empty">Aucun signal ni appel dans cette heure.</div>';
    }
    benchmarkPanes();
  }
  function benchmarkPanes(){
    document.querySelectorAll('[data-bm]').forEach(b=>b.classList.toggle('on',b.dataset.bm===st.bmTab));
    ['zones','conf','acc'].forEach(k=>$('bm-'+k).classList.toggle('on',k===st.bmTab));
    if(dataset&&st.bmTab!=='zones')trendCharts(dataset);
  }
  function trendCharts(d){
    const lim=st.bmRange==='24h'?864e5:st.bmRange==='7d'?6048e5:Infinity,now=Date.now();
    const within=t=>now-new Date(t.replace(' ','T')).getTime()<=lim;
    const fcs=(d.forecast?.history||[]).filter(f=>within(f.target_start)).slice().reverse();
    const evs=(d.evaluations||[]).filter(e=>within(e.target_start)).slice().reverse();
    const box=$('bm-'+st.bmTab);if(!box||st.bmTab==='zones')return;
    const W=Math.max(320,box.clientWidth||600),H=Math.max(200,(box.clientHeight||300)-40);
    if(st.bmTab==='conf'){
      if(!fcs.length){box.innerHTML='<div class="empty">Aucune prévision sur cette période.</div>';return;}
      const L=34,mx=Math.max(1,...fcs.map(f=>(f.result.matrix||[]).length)),step=(W-L-8)/fcs.length,bw=Math.max(6,Math.min(46,step-6)),col={Fort:'#ff6b6b',Moyen:'#f4be61',Faible:'#6d8793'};
      let g=`<text x="2" y="14" font-size="11" fill="#9bb4c0">${mx}</text>`;
      fcs.forEach((f,i)=>{let y=H-22;const x=L+i*step+3;['Faible','Moyen','Fort'].forEach(k=>{const n=(f.result.matrix||[]).filter(c=>c.confidence===k).length,hg=n/mx*(H-44);y-=hg;g+=`<rect x="${x}" y="${y}" width="${bw}" height="${hg}" fill="${col[k]}"><title>${f.target_start.slice(5,16)} · ${k} : ${n}</title></rect>`;});g+=`<text x="${x+bw/2}" y="${H-6}" font-size="11" fill="#9bb4c0" text-anchor="middle">${f.target_start.slice(11,13)}h</text>`;});
      box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nombre de signaux Fort, Moyen et Faible par prévision">${g}</svg><div class="legend2"><span><i class="lg" style="background:#ff6b6b"></i>Fort</span><span><i class="lg" style="background:#f4be61"></i>Moyen</span><span><i class="lg" style="background:#6d8793"></i>Faible</span><span>Classement de récurrence, pas une probabilité</span></div>`;
    }else{
      const pts=evs.filter(e=>e.result.evaluable!==false&&e.result.observed_match_share!=null);
      if(!pts.length){box.innerHTML='<div class="empty">Aucune heure évaluable sur cette période. Les heures sans évaluation restent vides, jamais à zéro.</div>';return;}
      const L=40,X=i=>pts.length===1?W/2:L+i/(pts.length-1)*(W-L-16),Y=v=>H-24-(v/100)*(H-44);
      box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Part des appels annoncés par heure évaluée"><line x1="${L}" y1="${Y(0)}" x2="${W-8}" y2="${Y(0)}" stroke="#35515d"/><line x1="${L}" y1="${Y(100)}" x2="${W-8}" y2="${Y(100)}" stroke="#35515d" stroke-dasharray="3"/><text x="2" y="${Y(100)+4}" font-size="11" fill="#9bb4c0">100 %</text><text x="2" y="${Y(0)+4}" font-size="11" fill="#9bb4c0">0 %</text><polyline fill="none" stroke="#29e2df" stroke-width="2.5" points="${pts.map((e,i)=>X(i)+','+Y(e.result.observed_match_share)).join(' ')}"/>${pts.map((e,i)=>`<circle cx="${X(i)}" cy="${Y(e.result.observed_match_share)}" r="5" fill="#29e2df"><title>${e.target_start.slice(5,16)} · ${pct(e.result.observed_match_share)} annoncés · ${e.result.unanticipated_observed} non annoncés</title></circle>`).join('')}</svg><div class="legend2"><span>${pts.length} heure(s) évaluée(s)</span><span>Heures non couvertes exclues</span></div>`;
    }
  }
  document.querySelectorAll('[data-bm]').forEach(b=>b.addEventListener('click',()=>{st.bmTab=b.dataset.bm;persist();benchmarkPanes();}));
  $('bm-range').addEventListener('change',()=>{st.bmRange=$('bm-range').value;persist();benchmarkPanes();});
  window.addEventListener('resize',()=>{if(route==='comparaison')benchmarkPanes();});

  // ---------- Statistiques ----------
  function statsPanes(){
    document.querySelectorAll('[data-st]').forEach(b=>b.classList.toggle('on',b.dataset.st===st.stTab));
    document.querySelectorAll('[data-stp]').forEach(p=>p.classList.toggle('on',p.dataset.stp===st.stTab));
  }
  document.querySelectorAll('[data-st]').forEach(b=>b.addEventListener('click',()=>{st.stTab=b.dataset.st;persist();statsPanes();}));

  // ---------- Données ----------
  function coverageStrip(c){
    const box=$('cov-strip');if(!box)return;
    if(!c||!c.hours||!c.hours.length){box.innerHTML='';$('cov-note').textContent=(c&&c.note)||'';return;}
    box.innerHTML=c.hours.map(h=>`<div class="cov-cell ${h.status.replace(' ','-')}" title="${esc(h.hour)} · ${esc(h.status)}${h.bins!=null?' · '+h.bins+'/12 cases':''}">${h.bins!=null?h.bins:'?'}</div>`).join('')+'<div class="cov-axis" style="grid-column:1/-1">'+c.hours.map(h=>`<span>${h.hour.slice(11,13)}</span>`).join('')+'</div>';
    $('cov-note').textContent=c.note||'';
  }
  function render(d){
    dataset=d;coverageStrip(d.coverage);
    set('k-total',fmt(d.kpi.total_events));set('k-eligible',fmt(d.kpi.eligible_events));set('k-zones',fmt(d.kpi.active_zones));set('k-days',fmt(d.kpi.days_observed));
    const sync=d.source?.last_sync;
    if(sync?.state==='success')message(`À jour · dernier appel ${d.source.last_event||'inconnu'}`,'good');
    else if(sync?.state==='error')message('Lecture en erreur · '+(sync.message||'cause inconnue'),'error');
    else message('Connexion non confirmée','warn');
    quotas(d.quotas,d.kpi.total_events);lineChart(d.by_date);heatmap(d.heatmap);tableZones(d.zones);system(d);benchmark(d);
    set('last-render','Affiché à '+timeFmt(d.now));
    if(st.mode==='A'){loadOfficial();}
  }
  async function load(){
    $('refresh').disabled=true;
    try{
      const per=$('period').value;let qs='period='+encodeURIComponent(per);
      if(per==='custom'){const a=$('range-start').value,b=$('range-end').value||a;if(a)qs+='&start='+a+'&end='+b;else qs='period=7d';}
      const r=await fetch('/api/dashboard?'+qs,{cache:'no-store',headers:{'Accept':'application/json'}});
      if(!r.ok){let detail='';try{const e=await r.json();detail=e.message||e.error||'';}catch(_){}throw new Error('HTTP '+r.status+(detail?' — '+detail:''));}
      render(await r.json());
    }catch(err){message('Données indisponibles : '+String(err.message||err),'error');}
    finally{$('refresh').disabled=false;}
  }
  $('refresh').addEventListener('click',()=>{load();if(st.mode==='B')loadExplore();});
  $('period').addEventListener('change',()=>{st.period=$('period').value;persist();$('custom-range').hidden=$('period').value!=='custom';if($('period').value!=='custom')load();});
  ['range-start','range-end'].forEach(i=>$(i).addEventListener('change',load));

  // ---------- Menu rétractable ----------
  function applySide(){$('app').classList.toggle('collapsed',st.collapsed);$('side-toggle').textContent=st.collapsed?'⟩':'⟨';$('side-toggle').setAttribute('aria-expanded',!st.collapsed);$('side-toggle').setAttribute('aria-label',st.collapsed?'Ouvrir le menu':'Réduire le menu');}
  $('side-toggle').addEventListener('click',()=>{st.collapsed=!st.collapsed;persist();applySide();});

  // ---------- Démarrage ----------
  $('period').value=st.period;$('custom-range').hidden=true;if(st.period==='custom'){st.period='7d';$('period').value='7d';}
  applySide();statsPanes();$('bm-range').value=st.bmRange;
  {const m=location.hash.match(/^#explorer(?:\/([0-6])\/(\d{1,2}))?$/);if(m){st.mode='B';if(m[1]!=null){st.weekday=Number(m[1]);st.hour=Math.min(23,Number(m[2]));}}}
  if(location.pathname==='/'||!ROUTES[location.pathname.replace(/^\/+|\/+$/g,'')])history.replaceState({},'','/placement'+location.hash);
  syncBar();show(routeFromPath(),false);
  load();if(st.mode==='B')loadExplore();
  setInterval(()=>{load();if(st.mode==='B')loadExplore();},5*60*1000);
})();
