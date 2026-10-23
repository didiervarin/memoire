/* ---------- FSRS-5 ---------- */
const W=[0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621];
const DECAY=-0.5, FACTOR=19/81, RETENTION=0.9, DAY=864e5, MIN=6e4;
const clampD=d=>Math.min(10,Math.max(1,d));
const retr=(t,s)=>Math.pow(1+FACTOR*t/s,DECAY);
const ivlDays=s=>Math.min(36500,Math.max(1,Math.round(s/FACTOR*(Math.pow(RETENTION,1/DECAY)-1))));
const D0=g=>clampD(W[4]-Math.exp(W[5]*(g-1))+1);
const nextD=(d,g)=>{const d2=d+(-W[6]*(g-3))*(10-d)/9;return clampD(W[7]*D0(4)+(1-W[7])*d2)};
const sRecall=(d,s,r,g)=>s*(1+Math.exp(W[8])*(11-d)*Math.pow(s,-W[9])*(Math.exp(W[10]*(1-r))-1)*(g===2?W[15]:1)*(g===4?W[16]:1));
const sForget=(d,s,r)=>Math.min(s,W[11]*Math.pow(d,-W[12])*(Math.pow(s+1,W[13])-1)*Math.exp(W[14]*(1-r)));
const sShort=(s,g)=>s*Math.exp(W[17]*(g-3+W[18]));
/* g : 1 Fausse, 2 Difficile, 3 Bonne, 4 Facile */
function schedule(f,g,now){
  let s,d,r=null,reps=1,lapses=g===1?1:0;
  if(!f){ s=W[g-1]; d=D0(g); }
  else{
    const el=Math.max(0,(now-f.last)/DAY); r=retr(el,f.s);
    s = el<1 ? sShort(f.s,g) : (g===1 ? sForget(f.d,f.s,r) : sRecall(f.d,f.s,r,g));
    d=nextD(f.d,g); reps=f.reps+1; lapses=f.lapses+(g===1?1:0);
  }
  s=Math.max(0.01,s);
  const due = g===1 ? now+10*MIN : now+ivlDays(s)*DAY;
  return {s,d,last:now,due,reps,lapses,r};
}

/* ---------- utilitaires ---------- */
const $=s=>document.querySelector(s);
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fr=(x,n=1)=>x.toFixed(n).replace('.',',');
function fmt(ms){const m=ms/MIN;if(m<60)return Math.max(1,Math.round(m))+' min';const h=m/60;if(h<24)return Math.round(h)+' h';const d=h/24;if(d<30)return Math.round(d)+' j';if(d<365)return fr(d/30)+' mois';return fr(d/365)+' an'+(d>=730?'s':'')}
const RATES={1:'Fausse',2:'Difficile',3:'Bonne',4:'Facile'};
const SIDE={recto:'Recto',verso:'Verso'};

/* ---------- état & stockage (serveur Cloudflare D1) ---------- */
const S={libs:[],view:'home',libId:null,confirm:null,editId:null,sess:null,err:null,saving:0};
const queues={};
async function api(method,path,body){
  const opt={method,headers:{},credentials:'same-origin'};
  if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  const res=await fetch(path,opt);
  let data=null;try{data=await res.json()}catch(e){}
  if(res.status===401&&path!=='/api/login'){showLogin();throw new Error('Non connecté')}
  if(!res.ok)throw new Error((data&&data.error)||('Erreur '+res.status));
  return data;
}
const byCreated=(a,b)=>(a.created||0)-(b.created||0);
async function loadLibs(){S.libs=(await api('GET','/api/libs')).sort(byCreated)}
function setMode(){$('#mode').textContent=S.saving?'Enregistrement…':'Enregistré'}
function persist(lib){
  lib.updated=Date.now();
  const data=JSON.parse(JSON.stringify(lib));
  S.saving++;setMode();
  queues[lib.id]=(queues[lib.id]||Promise.resolve())
    .then(()=>api('PUT','/api/libs/'+lib.id,data))
    .catch(e=>{if(e.message!=='Non connecté'){S.err="Échec de l'enregistrement : "+e.message;render()}})
    .finally(()=>{S.saving--;setMode()});
}
function removeLib(lib){
  S.libs=S.libs.filter(l=>l.id!==lib.id);
  api('DELETE','/api/libs/'+lib.id).catch(e=>{S.err='La suppression a échoué : '+e.message;render()});
}
async function exportLibs(){
  const res=await fetch('/api/export',{credentials:'same-origin'});
  if(!res.ok){S.err="L'export a échoué.";render();return}
  const blob=await res.blob();
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='memoire-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
async function importFile(file){
  try{
    const parsed=JSON.parse(await file.text());
    const r=await api('POST','/api/import',parsed);
    await loadLibs();S.err=null;S.view='home';render();
    toastMsg(r.count+' bibliothèque'+(r.count>1?'s':'')+' importée'+(r.count>1?'s':''));
  }catch(e){S.err="Import impossible : "+(e instanceof SyntaxError?'fichier illisible':e.message);render()}
}
function toastMsg(t){const el=$('#toast');el.textContent=t;el.hidden=false;clearTimeout(toastMsg.t);toastMsg.t=setTimeout(()=>el.hidden=true,2500)}
const lib=()=>S.libs.find(l=>l.id===S.libId);
function newLib(name){const l={id:uid('b'),name:name||'Nouvelle bibliothèque',created:Date.now(),settings:{face:'recto',perSession:20},cards:[]};S.libs.push(l);persist(l);return l}
function stats(l,now=Date.now()){let due=0,nw=0;for(const c of l.cards){if(!c.f)nw++;else if(c.f.due<=now)due++}return{total:l.cards.length,due,nw}}
function buildQueue(l,ahead){
  const now=Date.now();
  if(ahead) return l.cards.filter(c=>c.f).sort((a,b)=>a.f.due-b.f.due).slice(0,l.settings.perSession).map(c=>c.id);
  const due=l.cards.filter(c=>c.f&&c.f.due<=now).sort((a,b)=>a.f.due-b.f.due);
  const nw=l.cards.filter(c=>!c.f);
  return [...due,...nw].slice(0,l.settings.perSession).map(c=>c.id);
}
const EXAMPLE=[['France','Paris'],['Italie','Rome'],['Espagne','Madrid'],['Portugal','Lisbonne'],['Allemagne','Berlin'],['Autriche','Vienne'],['Hongrie','Budapest'],['Slovénie','Ljubljana'],['Lituanie','Vilnius'],['Islande','Reykjavik'],['Suisse','Berne'],['Croatie','Zagreb']];

/* ---------- rendu ---------- */
const app=$('#app');
function render(){
  setMode();
  const err = S.err ? `<div class="banner" role="alert">${esc(S.err)} <button class="link" data-a="dismiss">Fermer</button></div>` : '';
  app.innerHTML = err + ({home:vHome,lib:vLib,sess:vSess,done:vDone}[S.view]||vHome)();
  if(S.view==='sess'){const b=$('#reveal')||$('.rate[data-g="3"]'); b&&b.focus({preventScroll:true});}
}
function vHome(){
  const rows=S.libs.map(l=>{const s=stats(l);const n=buildQueue(l,false).length;return `
    <div class="lib">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <button class="name" data-a="open" data-id="${l.id}">${esc(l.name)}</button>
        <div class="stats"><span class="num">${s.total} carte${s.total>1?'s':''}</span>
          <span class="chip"><i class="dot due"></i><span class="num">${s.due}</span> à réviser</span>
          <span class="chip"><i class="dot new"></i><span class="num">${s.nw}</span> nouvelle${s.nw>1?'s':''}</span></div>
      </div>
      <div class="row">${n?`<button class="primary" data-a="start" data-id="${l.id}">Réviser ${n}</button>`:''}<button data-a="open" data-id="${l.id}">Ouvrir</button></div>
    </div>`}).join('');
  return `
  <section class="panel">
    <h2>Bibliothèques</h2>
    ${S.libs.length?`<div class="libs">${rows}</div>`:`<p class="help" style="margin:0">Aucune bibliothèque pour l'instant. Créez-en une ci-dessous, ou chargez l'exemple (12 capitales européennes) pour essayer une session.</p>
      <div><button data-a="example">Charger la bibliothèque d'exemple</button></div>`}
  </section>
  <section class="panel">
    <h3>Nouvelle bibliothèque</h3>
    <form class="row" id="fNew"><input id="newName" class="grow" placeholder="Ex. Vocabulaire italien" maxlength="80" required><button class="primary" type="submit">Créer</button></form>
  </section>
  <section class="panel">
    <h3>Sauvegarde</h3>
    <p class="help" style="margin:0">Exportez toutes vos bibliothèques dans un fichier, ou importez une sauvegarde. L'import ajoute ou remplace les bibliothèques du fichier sans toucher aux autres.</p>
    <div class="row"><button data-a="export">Exporter</button><button data-a="import">Importer une sauvegarde</button><button class="link danger" data-a="logout" style="margin-left:auto">Se déconnecter</button></div>
  </section>
  <p class="help">Chaque réponse est notée Fausse, Difficile, Bonne ou Facile. L'algorithme FSRS en déduit la stabilité et la difficulté de la carte, puis la date de prochaine révision visant 90 % de chances de vous en souvenir.</p>`;
}
function vLib(){
  const l=lib(); if(!l){S.view='home';return vHome()}
  const s=stats(l), q=buildQueue(l,false).length, now=Date.now();
  const cards=[...l.cards].reverse().map(c=>{
    if(S.editId===c.id) return `<form class="c" id="fEdit" data-id="${c.id}" style="grid-template-columns:1fr">
      <div class="row"><label class="f grow">Recto<textarea id="eR">${esc(c.recto)}</textarea></label><label class="f grow">Verso<textarea id="eV">${esc(c.verso)}</textarea></label></div>
      <div class="row"><button class="primary" type="submit">Enregistrer</button><button type="button" data-a="cancelEdit">Annuler</button>${c.f?`<button type="button" class="link" data-a="resetCard" data-id="${c.id}">Remettre à zéro la progression</button>`:''}</div></form>`;
    const st=!c.f?'Nouvelle':c.f.due<=now?'À réviser':'dans '+fmt(c.f.due-now);
    const conf=S.confirm==='card:'+c.id;
    return `<div class="c"><div class="t">${esc(c.recto)}</div><div class="t muted">${esc(c.verso)}</div>
      <div class="meta"><span>${st}</span>${c.f?`<span class="num">S ${fr(c.f.s)} j · D ${fr(c.f.d)}</span>`:''}
      ${conf?`<span class="acts"><button class="link danger" data-a="delCard" data-id="${c.id}">Confirmer la suppression</button><button class="link" data-a="cancel">Annuler</button></span>`
        :`<span class="acts"><button class="link" data-a="edit" data-id="${c.id}">Modifier</button><button class="link danger" data-a="askCard" data-id="${c.id}">Supprimer</button></span>`}</div></div>`}).join('');
  const face=l.settings.face;
  return `
  <div><button class="link" data-a="home">← Bibliothèques</button></div>
  <section class="panel">
    <h2>${esc(l.name)}</h2>
    <div class="stats"><span class="num">${s.total} cartes</span><span class="chip"><i class="dot due"></i><span class="num">${s.due}</span> à réviser</span><span class="chip"><i class="dot new"></i><span class="num">${s.nw}</span> nouvelles</span></div>
    <div class="row">${q?`<button class="primary" data-a="start" data-id="${l.id}">Commencer la session · ${q} carte${q>1?'s':''}</button>`
      : s.total?`<span class="muted">Rien à réviser pour le moment.</span>${l.cards.some(c=>c.f)?`<button data-a="ahead">Réviser en avance</button>`:''}`:`<span class="muted">Ajoutez des cartes pour commencer.</span>`}</div>
  </section>
  <section class="panel">
    <h3>Paramètres de la bibliothèque</h3>
    <div class="row" style="gap:18px;align-items:flex-end">
      <div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)">Face affichée
        <div class="seg" role="group" aria-label="Face affichée">${['recto','verso','random'].map(v=>`<button data-a="face" data-v="${v}" aria-pressed="${face===v}">${{recto:'Recto',verso:'Verso',random:'Aléatoire'}[v]}</button>`).join('')}</div></div>
      <label class="f" style="width:150px">Cartes par session<input id="perSession" type="number" min="1" max="500" value="${l.settings.perSession}" data-set="perSession"></label>
      <label class="f grow">Nom<input id="libName" value="${esc(l.name)}" maxlength="80" data-set="name"></label>
    </div>
    ${S.confirm==='lib'?`<div class="confirm"><span>Supprimer « ${esc(l.name)} » et ses ${s.total} cartes ? C'est définitif.</span><button class="danger solid" data-a="delLib">Supprimer</button><button data-a="cancel">Annuler</button></div>`
      :`<div><button class="link danger" data-a="askLib">Supprimer la bibliothèque</button></div>`}
  </section>
  <section class="panel">
    <h3>Ajouter une carte</h3>
    <form id="fAdd" style="display:flex;flex-direction:column;gap:10px">
      <div class="row" style="align-items:stretch"><label class="f grow">Recto<textarea id="aR" required></textarea></label><label class="f grow">Verso<textarea id="aV" required></textarea></label></div>
      <div><button class="primary" type="submit">Ajouter</button></div>
    </form>
    <details><summary class="muted" style="cursor:pointer">Importer plusieurs cartes</summary>
      <form id="fImp" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <label class="f">Une carte par ligne : recto ; verso (le point-virgule ou une tabulation sépare les faces)<textarea id="imp" rows="5" placeholder="Pologne ; Varsovie&#10;Grèce ; Athènes"></textarea></label>
        <div><button type="submit">Importer</button></div>
      </form></details>
  </section>
  <section class="panel">
    <h3>Cartes (${s.total})</h3>
    ${s.total?`<div class="cards">${cards}</div>`:'<p class="muted" style="margin:0">Aucune carte.</p>'}
  </section>`;
}
function vSess(){
  const ss=S.sess,l=lib(); const c=l&&l.cards.find(x=>x.id===ss.queue[0]);
  if(!c){S.view='done';return vDone()}
  const other=ss.side==='recto'?'verso':'recto', now=Date.now();
  const pct=Math.round(100*ss.done.size/ss.total);
  const last=ss.last?`<div class="last"><span>Carte précédente</span><span class="tag" data-g="${ss.last.g}">${RATES[ss.last.g]}</span>
      <span class="num">Stabilité ${fr(ss.last.s)} j</span><span class="num">Difficulté ${fr(ss.last.d)}/10</span>${ss.last.r!=null?`<span class="num">Rétention estimée ${Math.round(ss.last.r*100)} %</span>`:''}<span>Prochaine révision dans ${fmt(ss.last.due-ss.last.last)}</span></div>`:'';
  const rates=[1,2,3,4].map(g=>{const p=schedule(c.f,g,now);return `<button class="rate" data-a="rate" data-g="${g}"><b>${RATES[g]}</b><small>${fmt(p.due-now)}</small><kbd>${g}</kbd></button>`}).join('');
  return `
  <div class="sess-top"><span><strong>${esc(l.name)}</strong> <span class="muted num">· ${ss.done.size} / ${ss.total}</span></span><button class="link" data-a="quit">Terminer la session</button></div>
  <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
  <article class="fiche" aria-live="polite">
    <div class="lbl"><span>${SIDE[ss.side]}</span><span>${c.f?'révision '+(c.f.reps+1):'nouvelle carte'}</span></div>
    <div class="q">${esc(c[ss.side])}</div>
    ${ss.revealed?`<hr><div class="lbl"><span>${SIDE[other]}</span></div><div class="a">${esc(c[other])}</div>`:''}
  </article>
  ${ss.revealed?`<div class="rates">${rates}</div>`:`<button id="reveal" class="primary reveal" data-a="reveal">Voir la réponse <kbd style="color:inherit;border-color:currentColor">Espace</kbd></button>`}
  ${last}`;
}
function vDone(){
  const ss=S.sess,l=lib(); const n=ss?ss.done.size:0;
  const sum=[1,2,3,4].map(g=>`<div><span class="tag" data-g="${g}" style="align-self:flex-start">${RATES[g]}</span><span class="n">${ss?ss.counts[g]:0}</span></div>`).join('');
  const more=l?buildQueue(l,false).length:0;
  return `<section class="panel">
    <h2>Session terminée</h2>
    <p style="margin:0"><span class="num">${n}</span> carte${n>1?'s':''} révisée${n>1?'s':''} dans « ${esc(l?l.name:'')} ».</p>
    <div class="sum">${sum}</div>
    <div class="row">${more?`<button class="primary" data-a="start" data-id="${l.id}">Nouvelle session · ${more}</button>`:''}<button data-a="open" data-id="${l?l.id:''}">Voir la bibliothèque</button><button data-a="home">Bibliothèques</button></div>
  </section>`;
}

/* ---------- session ---------- */
function pickSide(l){const f=l.settings.face;S.sess.side=f==='random'?(Math.random()<.5?'recto':'verso'):f;S.sess.revealed=false}
function start(id,ahead){
  S.libId=id;const l=lib();const q=buildQueue(l,ahead);if(!q.length)return;
  S.sess={queue:q,total:q.length,done:new Set(),counts:{1:0,2:0,3:0,4:0},last:null,fails:{}};
  pickSide(l);S.view='sess';render();window.scrollTo(0,0);
}
function rate(g){
  const ss=S.sess,l=lib(),c=l.cards.find(x=>x.id===ss.queue[0]);if(!c||!ss.revealed)return;
  const now=Date.now(),res=schedule(c.f,g,now);
  c.f={s:res.s,d:res.d,last:res.last,due:res.due,reps:res.reps,lapses:res.lapses};
  ss.counts[g]++;ss.last={g,...res};ss.done.add(c.id);ss.queue.shift();
  if(g===1&&(ss.fails[c.id]=(ss.fails[c.id]||0)+1)<=3) ss.queue.splice(Math.min(3,ss.queue.length),0,c.id);
  persist(l);
  if(ss.queue.length){pickSide(l);S.view='sess'}else S.view='done';
  render();
}

/* ---------- événements ---------- */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,id=b.dataset.id,l=lib();
  switch(a){
    case 'home':S.view='home';S.confirm=null;S.editId=null;break;
    case 'open':if(!id)return;S.libId=id;S.view='lib';S.confirm=null;S.editId=null;break;
    case 'start':return start(id,false);
    case 'ahead':return start(l.id,true);
    case 'example':{const n=newLib("Capitales européennes (exemple)");n.cards=EXAMPLE.map(([r,v])=>({id:uid('c'),recto:r,verso:v,created:Date.now(),f:null}));persist(n);break}
    case 'face':l.settings.face=b.dataset.v;persist(l);break;
    case 'askLib':S.confirm='lib';break;
    case 'delLib':removeLib(l);S.view='home';S.confirm=null;break;
    case 'askCard':S.confirm='card:'+id;break;
    case 'delCard':l.cards=l.cards.filter(c=>c.id!==id);persist(l);S.confirm=null;break;
    case 'cancel':S.confirm=null;break;
    case 'edit':S.editId=id;S.confirm=null;break;
    case 'cancelEdit':S.editId=null;break;
    case 'resetCard':{const c=l.cards.find(x=>x.id===id);c.f=null;persist(l);S.editId=null;break}
    case 'reveal':S.sess.revealed=true;break;
    case 'rate':return rate(+b.dataset.g);
    case 'quit':S.view=S.sess.done.size?'done':'lib';break;
    case 'dismiss':S.err=null;break;
    case 'export':return exportLibs();
    case 'import':return $('#imp-file').click();
    case 'logout':api('POST','/api/logout').catch(()=>{}).finally(()=>{S.libs=[];S.view='home';showLogin()});return;
    default:return;
  }
  render();
});
document.addEventListener('change',e=>{
  const k=e.target.dataset.set,l=lib();if(!k||!l)return;
  if(k==='perSession'){const v=Math.max(1,Math.min(500,parseInt(e.target.value,10)||20));l.settings.perSession=v;e.target.value=v}
  if(k==='name'){const v=e.target.value.trim();if(!v){e.target.value=l.name;return}l.name=v}
  persist(l);render();
});
document.addEventListener('submit',e=>{
  e.preventDefault();const f=e.target,l=lib();
  if(f.id==='fNew'){const n=newLib($('#newName').value.trim());S.libId=n.id;S.view='lib';render();return}
  if(f.id==='fAdd'){const r=$('#aR').value.trim(),v=$('#aV').value.trim();if(!r||!v)return;l.cards.push({id:uid('c'),recto:r,verso:v,created:Date.now(),f:null});persist(l);render();$('#aR').focus();return}
  if(f.id==='fImp'){let n=0;for(const line of $('#imp').value.split(/\r?\n/)){const p=line.split(/\t|;/);if(p.length<2)continue;const r=p[0].trim(),v=p.slice(1).join(';').trim();if(r&&v){l.cards.push({id:uid('c')+n,recto:r,verso:v,created:Date.now(),f:null});n++}}if(n){persist(l)}render();return}
  if(f.id==='fEdit'){const c=l.cards.find(x=>x.id===f.dataset.id);const r=$('#eR').value.trim(),v=$('#eV').value.trim();if(r&&v){c.recto=r;c.verso=v;persist(l)}S.editId=null;render();return}
});
document.addEventListener('keydown',e=>{
  if(S.view!=='sess'||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;
  if(!S.sess.revealed&&(e.key===' '||e.key==='Enter')){e.preventDefault();S.sess.revealed=true;render()}
  else if(S.sess.revealed&&/^[1-4]$/.test(e.key)){e.preventDefault();rate(+e.key)}
});

/* ---------- connexion ---------- */
function showLogin(){$('#login').hidden=false;$('#main').hidden=true;$('#pass').focus()}
async function boot(){
  try{await api('GET','/api/me')}catch(e){return}
  $('#login').hidden=true;$('#main').hidden=false;
  try{await loadLibs()}catch(e){S.err='Chargement impossible : '+e.message}
  render();
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();e.stopPropagation();
  const b=$('#login-submit');b.disabled=true;$('#login-error').textContent='';
  try{await api('POST','/api/login',{password:$('#pass').value});$('#pass').value='';await boot()}
  catch(err){$('#login-error').textContent=err.message}
  finally{b.disabled=false}
});
$('#imp-file').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)importFile(f)});
/* Rafraîchit les données au retour dans l'app (autre appareil), hors session de révision */
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState!=='visible'||$('#main').hidden||S.saving||S.view==='sess'||S.editId)return;
  try{await loadLibs();render()}catch(e){}
});
boot();
