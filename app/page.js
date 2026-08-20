"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {

// -----------------------------------------------------------------------
// Stockage local (remplace window.storage utilisé dans le prototype Claude.ai) :
// stocke les données directement dans le navigateur de la personne (localStorage).
// Limite : environ 5-10 Mo au total par navigateur, partagée entre l'état de
// l'app ET toutes les photos. C'est un point de départ fonctionnel, mais pour
// stocker "des tas de photos" comme demandé, il faudra migrer vers un vrai
// stockage cloud (Vercel Blob, Cloudinary) plus tard.
function storageGet(key){
  try{
    const value = localStorage.getItem(key);
    return Promise.resolve(value !== null ? { key, value } : null);
  }catch(e){ return Promise.resolve(null); }
}
function storageSet(key, value){
  try{ localStorage.setItem(key, value); return Promise.resolve({ key, value }); }
  catch(e){ console.error('Stockage local plein ou indisponible', e); return Promise.resolve(null); }
}
function storageDelete(key){
  try{ localStorage.removeItem(key); return Promise.resolve({ key, deleted:true }); }
  catch(e){ return Promise.resolve(null); }
}
function storageList(prefix){
  try{
    const keys = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (!prefix || (k && k.startsWith(prefix))) keys.push(k);
    }
    return Promise.resolve({ keys });
  }catch(e){ return Promise.resolve({ keys: [] }); }
}


/* =========================================================================
   JARVIS — Etat, persistance, rendu
   ========================================================================= */

const STORAGE_KEY = 'jarvis:state';

const PEOPLE = [
  { id:'camil',   name:'Camil',   color:'#3dd6d0' },
  { id:'luc',     name:'Luc',     color:'#ff9f43' },
  { id:'clement', name:'Clément', color:'#a78bfa' },
];

function uid(){ return Math.random().toString(36).slice(2,10); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d); return dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtDateShort(d){ const dt=new Date(d); return dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}); }
function personById(id){ return PEOPLE.find(p=>p.id===id) || {name:id,color:'#888'}; }

function dayOfYear(){
  const now = new Date();
  const start = new Date(now.getFullYear(),0,0);
  return Math.floor((now-start)/86400000);
}
function currentJarvisAvatar(){
  const photos = state && state.jarvisPhotos;
  if (!photos || !photos.length) return null;
  return photoSrc(photos[dayOfYear() % photos.length]);
}

function isUnavailable(personId, dateISO){
  return state.unavailabilities.some(u=> u.person===personId && dateISO >= u.start && dateISO <= u.end);
}

// Choisit la personne la plus équitable pour une tâche d'une catégorie donnée,
// en excluant les indisponibles à la date, et en évitant de reproposer la même
// personne que la dernière fois sur cette catégorie si une alternative existe.
function pickFairAssignee(category, dueDate, excludePersonId){
  const weightSum = Object.fromEntries(PEOPLE.map(p=>[p.id,0]));
  state.completedLog.forEach(l=> weightSum[l.person] = (weightSum[l.person]||0) + (l.weight||1));

  let candidates = PEOPLE.filter(p=> !isUnavailable(p.id, dueDate));
  if (!candidates.length) candidates = PEOPLE; // tout le monde indispo : on assigne quand même, à réattribuer manuellement

  const lastPerson = state.rotation[category];
  const excludeId = excludePersonId || lastPerson;
  const rotated = candidates.filter(p=> p.id !== excludeId);
  const pool = rotated.length ? rotated : candidates;

  pool.sort((a,b)=> weightSum[a.id]-weightSum[b.id]);
  const chosen = pool[0];
  state.rotation[category] = chosen.id;
  return chosen.id;
}

/* =========================================================================
   TÂCHES RÉCURRENTES — intervalle adapté à la météo pour certaines catégories
   ========================================================================= */

// Calcule l'intervalle effectif (en jours) pour une tâche récurrente, en le
// resserrant si la météo le justifie (canicule pour l'arrosage, forte chaleur pour les poubelles).
function effectiveInterval(rt){
  let interval = rt.intervalDays;
  const w = weatherData, hist = weatherHistory;
  if (rt.adaptiveTag === 'arrosage'){
    if (hist && hist.droughtDays >= 12) interval = Math.max(1, Math.round(interval/2));
    else if (w && w.temp >= 30) interval = Math.max(1, Math.round(interval*0.7));
  } else if (rt.adaptiveTag === 'poubelles'){
    if (w && w.temp >= 28) interval = Math.max(2, interval - 3);
  }
  return interval;
}
function recurringStatus(rt){
  const interval = effectiveInterval(rt);
  const daysSince = daysBetween(rt.lastDone, todayISO());
  const overdue = daysSince - interval;
  let severity = 'ok';
  if (overdue >= Math.ceil(interval*0.5)) severity = 'urgent';
  else if (overdue >= 0) severity = 'attention';
  return { interval, daysSince, overdue, severity, adapted: interval !== rt.intervalDays };
}

function renderRecurringCard(){
  const due = state.recurringTasks
    .map(rt=> ({ rt, status: recurringStatus(rt) }))
    .filter(x=> x.status.severity !== 'ok')
    .sort((a,b)=> b.status.overdue - a.status.overdue);
  if (!due.length) return '';
  return `
  <div class="mb-6">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">RÉCURRENT — À FAIRE BIENTÔT</div>
    <div class="space-y-2">
      ${due.map(({rt,status})=>`
        <div class="panel rounded-lg p-3 flex items-center gap-3 border-l-2" style="border-left-color:${status.severity==='urgent'?'var(--red)':'var(--amber)'}">
          <div class="flex-1">
            <div class="text-sm font-medium">${rt.title}</div>
            <div class="text-[10px] font-mono text-[var(--text-mid)]">
              Dernier: il y a ${status.daysSince}j · intervalle ${status.interval}j${status.adapted?` (adapté à la météo, normalement ${rt.intervalDays}j)`:''}
            </div>
          </div>
          <button data-action="recurring-done" data-id="${rt.id}" class="btn-ghost text-xs px-3 py-1.5 rounded">Fait</button>
        </div>
      `).join('')}
    </div>
  </div>`;
}

function seedState(){
  const now = new Date();
  const iso = (offsetDays) => { const d=new Date(); d.setDate(d.getDate()+offsetDays); return d.toISOString().slice(0,10); };
  return {
    house: {
      adresse: 'Mérignac (T5, 103 m²)',
      jardins: 2, cabanons: 2,
      solairesRaccordes: false,
      chauffage: 'Chaudière gaz',
      dernierEntretienChaudiere: iso(-760), // volontairement très en retard, cf. cahier des charges
    },
    news: [
      { id: uid(), text: "Anniversaire de Quentin demain", date: iso(1), type:'event' },
      { id: uid(), text: "Retour de vacances de Luc la semaine prochaine", date: iso(7), type:'info' },
    ],
    // Zones de la maison (module "Maison") — hiérarchiques via parentZoneId (null = zone racine)
    // Chaque zone peut avoir une exposition et des "enjeux" propres (ex: mur sud qui chauffe)
    zones: [
      { id:'z-salon',    name:'Salon',          floor:'RDC',    type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-cuisine',  name:'Cuisine',         floor:'RDC',    type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-sdb',      name:'Salle de bain',   floor:'Étage',  type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-ch1',      name:'Chambre Camil',   floor:'Étage',  type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-ch2',      name:'Chambre Luc',     floor:'Étage',  type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-ch3',      name:'Chambre Clément', floor:'Étage',  type:'pièce', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-jardin-av', name:'Jardin devant',  floor:'Extérieur', type:'jardin', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-allee',      name:'Allée',           floor:'Extérieur', type:'jardin', parentZoneId:'z-jardin-av', exposition:'Plein soleil', enjeux:'' },
      { id:'z-terrasse',   name:'Terrasse',        floor:'Extérieur', type:'jardin', parentZoneId:'z-jardin-av', exposition:'Plein sud', enjeux:'Très exposée sud, chauffe beaucoup l\'été, devant la fenêtre du salon' },
      { id:'z-jardin-sub', name:'Jardin (massif)', floor:'Extérieur', type:'jardin', parentZoneId:'z-jardin-av', exposition:'Mi-ombre', enjeux:'' },
      { id:'z-pots-terre', name:'Pots en terre cuite', floor:'Extérieur', type:'jardin', parentZoneId:'z-terrasse', exposition:'Plein soleil', enjeux:'' },
      { id:'z-jardin-ar', name:'Jardin arrière', floor:'Extérieur', type:'jardin', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-cabanon1', name:'Cabanon 1',       floor:'Extérieur', type:'jardin', parentZoneId:null, exposition:'', enjeux:'' },
      { id:'z-cabanon2', name:'Cabanon 2',       floor:'Extérieur', type:'jardin', parentZoneId:null, exposition:'', enjeux:'' },
    ].map(z=>({ photo:null, tidiness:80, ...z })),
    floorPlans: {}, // conservé pour compat mais plus utilisé (le plan visuel est abandonné pour l'instant)
    // Catégories du module Jardin & Matériel — extensible par l'utilisateur
    itemCategories: ['Plante', 'Matériel'],
    plants: [
      { id: uid(), name:'Laurier rose', category:'Plante', subCategory:'Laurier rose', zoneId:'z-allee', photo:null,
        health:70, exposition:'Plein soleil', toleranceChaleur:'haute', dernierArrosage: iso(-2), tailleRecommandee: true,
        notes:'', actions:[{ id: uid(), type:'Taille', date: iso(14), done:false }] },
      { id: uid(), name:'Aloe vera', category:'Plante', subCategory:'Aloe vera', zoneId:'z-allee', photo:null,
        health:85, exposition:'Plein soleil', toleranceChaleur:'haute', dernierArrosage: iso(-6), tailleRecommandee:false, notes:'', actions:[] },
      { id: uid(), name:'Alvéoles de parpaings', category:'Matériel', subCategory:'Structure', zoneId:'z-allee', photo:null,
        etat:'Bon état', quantite:1, notes:'', actions:[] },
      { id: uid(), name:'Pavés', category:'Matériel', subCategory:'Revêtement', zoneId:'z-allee', photo:null,
        etat:'Bon état', quantite:1, notes:'', actions:[] },
      { id: uid(), name:'Pergola', category:'Matériel', subCategory:'Structure', zoneId:'z-terrasse', photo:null,
        etat:'Bon état', quantite:1, notes:'', actions:[] },
      { id: uid(), name:'Pots rebord fenêtre', category:'Matériel', subCategory:'Contenant', zoneId:'z-terrasse', photo:null,
        etat:'Bon état', quantite:3, notes:'', actions:[] },
      { id: uid(), name:'Lavande', category:'Plante', subCategory:'Lavande', zoneId:'z-pots-terre', photo:null,
        health:80, exposition:'Plein soleil', toleranceChaleur:'haute', dernierArrosage: iso(-3), tailleRecommandee:false, notes:'', actions:[] },
      { id: uid(), name:'Romarin', category:'Plante', subCategory:'Romarin', zoneId:'z-pots-terre', photo:null,
        health:88, exposition:'Plein soleil', toleranceChaleur:'haute', dernierArrosage: iso(-5), tailleRecommandee:false, notes:'', actions:[] },
      { id: uid(), name:'Plants de tomates', category:'Plante', subCategory:'Tomate', zoneId:'z-cabanon1', photo:null,
        health:78, exposition:'Plein soleil', toleranceChaleur:'faible', dernierArrosage: iso(-1), tailleRecommandee:false,
        notes:'',
        actions:[
          { id: uid(), type:'Arrosage', date: iso(1), done:false },
          { id: uid(), type:'Tuteurage', date: iso(5), done:false },
        ]},
      { id: uid(), name:'Oliviers en pot', category:'Plante', subCategory:'Olivier', zoneId:'z-jardin-ar', photo:null,
        health:90, exposition:'Plein soleil', toleranceChaleur:'haute', dernierArrosage: iso(-4), tailleRecommandee:false, notes:'', actions:[]},
      { id: uid(), name:'Tondeuse', category:'Matériel', subCategory:'Outillage', zoneId:'z-cabanon2', photo:null,
        etat:'Bon état', quantite:1, notes:'Révision annuelle à prévoir', actions:[] },
    ].map(p=>({ customFields:[], statusBars:[], ...p })),
    tasks: [
      { id: uid(), title:'Sortir les poubelles', category:'Ménage', weight:1, assignee:'luc', dueDate: iso(0), done:false, log:[] },
      { id: uid(), title:'Déchetterie — gravats cabanon', category:'Déchetterie', weight:3, assignee:'clement', dueDate: iso(4), done:false, log:[] },
      { id: uid(), title:'Tonte jardin avant', category:'Jardin', weight:2, assignee:'luc', dueDate: iso(2), done:false, log:[] },
    ],
    // Historique des tâches terminées (sert au calcul d'équité — les tâches actives sont supprimées une fois cochées)
    completedLog: [
      { person:'camil', date: iso(-1), detail:'Salle de bain (sol + miroir)', category:'Ménage', weight:2 },
      { person:'clement', date: iso(0), detail:'Vaisselle du soir', category:'Cuisine', weight:1 },
    ],
    // Rotation : dernière personne assignée par catégorie, pour ne pas proposer deux fois de suite la même
    rotation: {},
    polls: [
      { id: uid(), question:'Arrosage des tomates jeudi, qui peut ?', deadline: iso(2), resolved:false,
        votes: { camil:null, luc:null, clement:null } },
    ],
    events: [
      { id: uid(), title:'Entretien chaudière (À PLANIFIER)', category:'Bricolage', start: iso(2), person:null },
      { id: uid(), title:'Sulfatage rosiers', category:'Jardin', start: iso(3), person:'camil' },
      { id: uid(), title:'Passage déchetterie', category:'Déchetterie', start: iso(4), person:'clement' },
    ],
    unavailabilities: [
      { id: uid(), person:'luc', label:'Vacances', start: iso(6), end: iso(13) },
    ],
    documents: [
      { id: uid(), name:'Bail de location — Cabinet Bedin', category:'Bail', date:'2024-08-01', note:'T5 Mérignac', file:null, fileType:null },
      { id: uid(), name:'Contrat assurance habitation', category:'Assurance', date:'2024-08-05', note:'', file:null, fileType:null },
      { id: uid(), name:'Diagnostic (DPE, gaz, élec)', category:'Diagnostic', date:'2024-07-20', note:'', file:null, fileType:null },
    ],
    chat: [
      { role:'assistant', text:"Bonjour. JARVIS en ligne. Je surveille la maison de Mérignac — jardins, tâches, entretien. Dites-moi ce qu'il se passe, ou envoyez-moi une photo." }
    ],
    // Photos de l'avatar JARVIS (roulent automatiquement, une par jour)
    jarvisPhotos: [],
    // Observations remontées par JARVIS (via photo/discussion) : enjeux, dégradations, points de vigilance par zone
    observations: [],
    // Projets — proposés par JARVIS ou créés manuellement, avec chat dédié et liste de matériel
    projects: [],
    // Tâches récurrentes — intervalle adapté dynamiquement selon la météo (chaleur/sécheresse)
    // pour certaines catégories (arrosage, poubelles). N'apparaissent en tâche que si en retard.
    recurringTasks: [
      { id: uid(), title:'Sortir les poubelles', category:'Ménage', weight:1, intervalDays:7, zoneId:null, lastDone: iso(-2), adaptiveTag:'poubelles' },
      { id: uid(), title:'Arroser les pots en terre cuite', category:'Jardin', weight:1, intervalDays:4, zoneId:'z-pots-terre', lastDone: iso(-3), adaptiveTag:'arrosage' },
      { id: uid(), title:'Ménage salle de bain', category:'Ménage', weight:2, intervalDays:7, zoneId:'z-sdb', lastDone: iso(-5), adaptiveTag:null },
    ],
    // Préférences de notifications push — UI prête, l'envoi réel nécessite le déploiement (voir guide)
    pushSettings: {
      googleCalendarSync: true,
      tachesAssignees: true,
      tachesRecurrentesDues: true,
      alertesMeteo: true,
      alertesUrgentes: true,
      sondagesDisponibilite: true,
      observationsJarvis: false,
    },
    // Module Audit — inventaire initial conversationnel
    audit: {
      questions: [
        { id: uid(), text:"Quel est le modèle exact de la chaudière gaz, et où se trouve la vanne de coupure principale ?", status:'pending', answer:null, needsPhoto:false, photo:null },
        { id: uid(), text:"Les panneaux solaires : quelle puissance, quelle marque, pourquoi ne sont-ils pas raccordés ?", status:'pending', answer:null, needsPhoto:true, photo:null },
        { id: uid(), text:"Y a-t-il un souci connu avec l'arrivée d'air du gaz ou la mise à la terre électrique ?", status:'pending', answer:null, needsPhoto:false, photo:null },
        { id: uid(), text:"Peux-tu prendre en photo chaque rosier / plante notable pour que je crée leur fiche visuelle ?", status:'pending', answer:null, needsPhoto:true, photo:null },
        { id: uid(), text:"Où sont rangés les outils de jardin et le matériel d'entretien (cabanon 1 ou 2) ?", status:'pending', answer:null, needsPhoto:false, photo:null },
        { id: uid(), text:"Quel est le fournisseur d'accès internet et où est la box ?", status:'pending', answer:null, needsPhoto:false, photo:null },
      ],
    },
  };
}

let state = null;
let saveTimer = null;

// Fusionne un état chargé (potentiellement ancien) avec les clés par défaut
// pour éviter les crashs quand de nouveaux champs sont ajoutés à l'app.
function hydrateState(loaded){
  const defaults = seedState();
  const merged = { ...defaults, ...loaded };
  // pour les tableaux/objets structurants ajoutés après coup, on garde ceux de l'utilisateur s'ils existent déjà
  ['zones','floorPlans','itemCategories','rotation','completedLog','jarvisPhotos','projects','observations','recurringTasks','pushSettings'].forEach(key=>{
    if (loaded[key] === undefined) merged[key] = defaults[key];
  });
  if (!loaded.audit) merged.audit = defaults.audit;
  if (!merged.projects) merged.projects = [];
  if (Array.isArray(merged.zones)){
    merged.zones.forEach(z=>{
      if (z.parentZoneId === undefined) z.parentZoneId = null;
      if (z.exposition === undefined) z.exposition = '';
      if (z.enjeux === undefined) z.enjeux = '';
      if (z.photo === undefined) z.photo = null;
      if (z.tidiness === undefined) z.tidiness = 80;
    });
  }
  if (Array.isArray(merged.plants)){
    merged.plants.forEach(p=>{ if (!p.customFields) p.customFields = []; if (!p.statusBars) p.statusBars = []; });
  }
  // anciennes tâches enregistrées avec "done" : on les migre vers l'historique et on les retire de la liste active
  if (Array.isArray(merged.tasks)){
    const stillActive = [];
    merged.tasks.forEach(t=>{
      if (t.done){
        merged.completedLog.push({ person:t.assignee, date:t.dueDate||todayISO(), detail:t.title, category:t.category, weight:t.weight||2 });
      } else {
        if (t.weight===undefined) t.weight = 2;
        stillActive.push(t);
      }
    });
    merged.tasks = stillActive;
  }
  return merged;
}

// -----------------------------------------------------------------------
// Photos & fichiers : stockés en clés séparées (pas dans le gros blob d'état)
// pour pouvoir en accumuler beaucoup sans faire exploser la taille de
// l'état principal. `state` ne contient que des clés de référence
// (ex: "photo:abc123"), photoCache contient les données réelles en mémoire.
// -----------------------------------------------------------------------
let photoCache = {};

async function storePhoto(dataUrl){
  try{
    const res = await fetch('/api/upload-photo', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ dataUrl })
    });
    const data = await res.json();
    if (!res.ok || !data.url){ console.error('Erreur upload photo', data); return null; }
    return data.url;
  }catch(e){ console.error('Erreur upload photo', e); return null; }
}
async function deletePhoto(url){
  if (!url) return;
  try{
    await fetch('/api/delete-photo', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url })
    });
  }catch(e){}
}
function photoSrc(url){ return url || null; }

async function loadState(){
  try{
    const res = await fetch('/api/state');
    const data = await res.json();
    state = data.value ? hydrateState(JSON.parse(data.value)) : seedState();
  }catch(e){
    state = seedState();
  }
  render();
  startPolling();
}

function startPolling(){
  setInterval(async ()=>{
    try{
      const res = await fetch('/api/state');
      const data = await res.json();
      console.log('🔄 Poll reçu:', new Date().toLocaleTimeString());
      if (data.value && !document.querySelector('.modal-backdrop')){
        console.log('⚠️ Poll a écrasé les données locales');
        state = hydrateState(JSON.parse(data.value));
        render();
      }
    }catch(e){}
  }, 20000);
}

function saveState(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> flushSave(), 250);
}

function flushSave(){
  clearTimeout(saveTimer);
  console.log('💾 Sauvegarde envoyée:', new Date().toLocaleTimeString());
  try{
    fetch('/api/state', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ value: JSON.stringify(state) }),
      keepalive: true
    });
  }catch(e){ console.error('Erreur de sauvegarde', e); }
}

if (typeof window !== 'undefined'){
  window.addEventListener('beforeunload', flushSave);
}

// Vérifie les barres d'état personnalisées de tous les éléments : si l'une
// passe sous le seuil (30) et a une action associée (tâche ou projet), on la
// déclenche automatiquement une fois (hystérésis : il faut remonter au-dessus
// de 50 avant qu'elle puisse se redéclencher).
const STATUS_BAR_THRESHOLD = 30;
const STATUS_BAR_RESET = 50;
function checkStatusBarTriggers(s){
  s.plants.forEach(p=>{
    (p.statusBars||[]).forEach(b=>{
      if (b.value >= STATUS_BAR_RESET) b.triggered = false;
      if (b.lowAction!=='none' && b.value < STATUS_BAR_THRESHOLD && !b.triggered){
        b.triggered = true;
        if (b.lowAction === 'task'){
          s.tasks.push({ id:uid(), title: b.taskTitle || `${b.label} — ${p.name}`, category: b.taskCategory||'Jardin', weight:1, assignee: currentUserId, dueDate: todayISO(), log:[] });
        } else if (b.lowAction === 'project'){
          s.projects.push({ id:uid(), name: b.taskTitle || `${p.name} — ${b.label} à traiter`, status:'suggested',
            justification: `"${b.label}" de "${p.name}" est descendu à ${b.value}/100.`, chat:[], materials:[], createdDate: todayISO() });
        }
      }
    });
  });
}

function mutate(fn){ fn(state); checkStatusBarTriggers(state); saveState(); render(); }

/* =========================================================================
   Alertes calculées (météo, entretien, etc.)
   ========================================================================= */

function computeAlerts(){
  const alerts = [];
  const h = state.house;
  const daysLate = daysBetween(h.dernierEntretienChaudiere, todayISO());
  if (daysLate > 365){
    alerts.push({
      level:'red',
      title:'Entretien chaudière en retard',
      detail:`Dernier entretien : ${fmtDate(h.dernierEntretienChaudiere)} — soit ${Math.floor(daysLate/365)} an(s) et ${daysLate%365} j de retard.`,
      action:'Planifier un rendez-vous chauffagiste',
    });
  }
  if (!h.solairesRaccordes){
    alerts.push({
      level:'amber',
      title:'Panneaux solaires non raccordés',
      detail:'Installation présente mais non connectée au réseau — production perdue.',
      action:'Contacter Enedis / installateur pour raccordement',
    });
  }
  const weather = weatherData || getFallbackWeather();
  weather.alerts.forEach(a=>{
    alerts.push({ level:'red', title:`Alerte météo — ${a.title}`, detail:a.detail, action:a.action });
  });
  if (weatherHistory && weatherHistory.summary){
    alerts.push({
      level: weatherHistory.droughtDays>=15 ? 'red' : 'amber',
      title:'Stress hydrique cumulé',
      detail: weatherHistory.summary,
      action:'Vérifier l\'état des plantes sensibles, arroser en profondeur si besoin',
    });
  }
  const overdueTasks = state.tasks.filter(t=>daysBetween(t.dueDate, todayISO())>0);
  if (overdueTasks.length){
    alerts.push({
      level:'amber',
      title:`${overdueTasks.length} tâche(s) en retard`,
      detail: overdueTasks.map(t=>t.title).join(', '),
      action:'Voir le module Tâches',
    });
  }
  state.plants.filter(p=>p.category==='Plante' && p.health<40).forEach(p=>{
    alerts.push({ level:'red', title:`${p.name} en détresse`, detail:`Etat: ${p.health}/100`, action:'Voir le module Jardin & Matériel' });
  });
  state.observations.filter(o=>o.severity==='urgent').forEach(o=>{
    alerts.push({ level:'red', title:`Observation JARVIS — ${zoneName(o.zoneId)}`, detail:o.text, action:'Voir le module Maison' });
  });
  return alerts;
}

/* =========================================================================
   Météo — Open-Meteo (gratuit, sans clé API)
   Doc: https://open-meteo.com/en/docs
   NB: dans l'aperçu claude.ai, le fetch externe peut être bloqué par le
   bac à sable de l'iframe -> repli automatique sur des données simulées
   avec un badge "hors-ligne" explicite. Une fois hébergé (Vercel, etc.),
   ça passera en "EN DIRECT" sans rien changer au code.
   ========================================================================= */

const MERIGNAC_COORDS = { lat: 44.8333, lon: -0.6500 };

let weatherData = null;      // rempli par fetchWeather()
let weatherStatus = 'loading'; // 'loading' | 'live' | 'simulated'

function wmoToIcon(code){
  if (code===0) return '☀️';
  if ([1,2].includes(code)) return '🌤️';
  if (code===3) return '⛅';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,56,57].includes(code)) return '🌦️';
  if ([61,63,65,66,67,80,81,82].includes(code)) return '🌧️';
  if ([71,73,75,77,85,86].includes(code)) return '❄️';
  if ([95,96,99].includes(code)) return '⛈️';
  return '🌡️';
}
function wmoToText(code){
  const map = {0:'Ciel dégagé',1:'Peu nuageux',2:'Partiellement nuageux',3:'Couvert',
    45:'Brouillard',48:'Brouillard givrant',51:'Bruine légère',53:'Bruine',55:'Bruine forte',
    61:'Pluie faible',63:'Pluie',65:'Pluie forte',71:'Neige faible',73:'Neige',75:'Neige forte',
    80:'Averses',81:'Averses fortes',82:'Averses violentes',95:'Orage',96:'Orage + grêle',99:'Orage violent + grêle'};
  return map[code] || 'Conditions variables';
}

function getFallbackWeather(){
  return {
    temp: 29, feels: 32, condition:'Ensoleillé, vent modéré', icon:'☀️',
    forecast:[
      { day:'Auj.', temp:29, icon:'☀️' },
      { day:'Dem.', temp:31, icon:'🌤️' },
      { day:'J+2', temp:34, icon:'🔥' },
      { day:'J+3', temp:22, icon:'⛈️' },
    ],
    alerts:[{ title:'Canicule (simulé)', detail:"Exemple : pic à 34°C prévu dans 2 jours. Ceci est une donnée de démonstration.", action:'Arroser tôt le matin, rentrer les pots fragiles' }],
  };
}

async function fetchWeather(){
  const { lat, lon } = MERIGNAC_COORDS;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FParis&forecast_days=4`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const d = await res.json();

    const forecast = d.daily.time.map((t,i)=>({
      day: i===0 ? 'Auj.' : new Date(t).toLocaleDateString('fr-FR',{weekday:'short'}),
      temp: Math.round(d.daily.temperature_2m_max[i]),
      icon: wmoToIcon(d.daily.weather_code[i]),
    }));

    const alerts = [];
    d.daily.temperature_2m_max.forEach((tmax,i)=>{
      if (tmax >= 33){
        alerts.push({ title:'Canicule', detail:`${Math.round(tmax)}°C prévus ${i===0?"aujourd'hui":'dans '+i+' jour(s)'}. Arrosage matinal recommandé, surveiller les plantes sensibles.`, action:'Arroser tôt le matin, ombrer les pots fragiles' });
      }
      if ([95,96,99].includes(d.daily.weather_code[i])){
        alerts.push({ title:'Orage / grêle', detail:`Orage prévu ${i===0?"aujourd'hui":'dans '+i+' jour(s)'}.`, action:'Rentrer le mobilier de jardin et les pots fragiles' });
      }
    });

    weatherData = {
      temp: Math.round(d.current.temperature_2m),
      feels: Math.round(d.current.apparent_temperature),
      condition: wmoToText(d.current.weather_code),
      icon: wmoToIcon(d.current.weather_code),
      forecast, alerts,
    };
    weatherStatus = 'live';
    fetchWeatherHistory(); // en parallèle, ne bloque pas l'affichage courant
  }catch(e){
    weatherData = getFallbackWeather();
    weatherStatus = 'simulated';
  }
  render();
}

/* Historique météo (21 derniers jours) — pour raisonner en "stress cumulé"
   (sécheresse / canicule prolongée) plutôt qu'en simple prévision du lendemain.
   API archive Open-Meteo, gratuite, sans clé. */
let weatherHistory = null; // { droughtDays, heatDays, summary }

async function fetchWeatherHistory(){
  const { lat, lon } = MERIGNAC_COORDS;
  const end = new Date(); end.setDate(end.getDate()-1); // archive dispo jusqu'à J-1
  const start = new Date(end); start.setDate(start.getDate()-20);
  const fmt = (d)=> d.toISOString().slice(0,10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${fmt(start)}&end_date=${fmt(end)}&daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FParis`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const d = await res.json();
    const heatDays = d.daily.temperature_2m_max.filter(t=>t>=30).length;
    const droughtDays = d.daily.precipitation_sum.filter(p=>p<1).length;
    const totalDays = d.daily.time.length;
    let summary = null;
    if (droughtDays >= 12){
      summary = `${droughtDays} jours sur les ${totalDays} derniers sans pluie significative` + (heatDays>0 ? `, dont ${heatDays} jour(s) de canicule (≥30°C)` : '') + '. Stress hydrique cumulé probable sur les plantes.';
    } else if (heatDays >= 6){
      summary = `${heatDays} jour(s) de forte chaleur (≥30°C) sur les ${totalDays} derniers jours.`;
    }
    weatherHistory = { droughtDays, heatDays, totalDays, summary };
  }catch(e){
    weatherHistory = null;
  }
  render();
}

/* =========================================================================
   Layout / Navigation
   ========================================================================= */

const MODULES = [
  { id:'dashboard', label:'Tableau de bord',     icon:'◈' },
  { id:'maison',    label:'Maison',              icon:'⌂' },
  { id:'tasks',     label:'Tâches',              icon:'☰' },
  { id:'calendar',  label:'Calendrier',          icon:'▦' },
  { id:'documents', label:'Coffre-fort',         icon:'▣' },
  { id:'jarvis',    label:'JARVIS (IA)',         icon:'◉' },
  { id:'settings',  label:'Paramètres',          icon:'⚙' },
];

// Qui utilise l'app sur cet appareil — sert à attribuer correctement les
// actions demandées à JARVIS ("j'ai fait X"). Volontairement simple ici
// (pas de vrai compte) ; en production ce sera remplacé par une connexion
// par personne (Google/email) et ce sélecteur disparaîtra.
let currentUserId = PEOPLE[0].id;

let currentModule = 'dashboard';
let calendarFilter = 'Tous';
let calendarViewMode = 'semaine'; // 'semaine' | 'mois' | 'liste'
let calendarWeekOffset = 0;

function render(){
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderSidebar()}
    <main class="flex-1 min-h-screen overflow-y-auto">
      <div class="max-w-6xl mx-auto p-5 md:p-8 fade-in">
        ${renderModule()}
      </div>
    </main>
  `;
  attachHandlers();
}

function renderSidebar(){
  return `
  <aside class="w-16 md:w-56 shrink-0 border-r border-[var(--panel-border)] bg-[var(--bg-1)] flex flex-col">
    <div class="p-4 md:p-5 border-b border-[var(--panel-border)] flex items-center gap-2">
      <label class="w-8 h-8 rounded-full border border-[var(--cyan)] flex items-center justify-center text-[var(--cyan)] font-hud text-sm scan-ring cursor-pointer overflow-hidden shrink-0" title="Changer la photo de JARVIS">
        ${currentJarvisAvatar() ? `<img src="${currentJarvisAvatar()}" class="w-full h-full object-cover"/>` : 'J'}
        <input type="file" accept="image/*" class="hidden" data-action="jarvis-avatar-upload">
      </label>
      <div class="hidden md:block">
        <div class="font-hud font-700 text-lg leading-none tracking-wide">JARVIS</div>
        <div class="text-[10px] text-[var(--text-low)] font-mono">MÉRIGNAC · T5</div>
      </div>
    </div>
    <nav class="flex-1 py-3">
      ${MODULES.map(m=>`
        <button data-nav="${m.id}" class="nav-item w-full flex items-center gap-3 px-4 md:px-5 py-3 text-left text-sm ${currentModule===m.id?'active':'text-[var(--text-mid)]'}">
          <span class="text-base w-4 text-center">${m.icon}</span>
          <span class="hidden md:inline font-medium">${m.label}</span>
        </button>
      `).join('')}
    </nav>
    <div class="p-4 hidden md:block border-t border-[var(--panel-border)]">
      <div class="text-[10px] text-[var(--text-low)] font-mono mb-1.5">VOUS ÊTES</div>
      <select data-action="select-current-user" class="w-full text-xs rounded px-2 py-1.5 mb-2">
        ${PEOPLE.map(p=>`<option value="${p.id}" ${currentUserId===p.id?'selected':''}>${p.name}</option>`).join('')}
      </select>
      <div class="flex -space-x-2">
        ${PEOPLE.map(p=>`<div title="${p.name}" class="w-7 h-7 rounded-full border-2 border-[var(--bg-1)] flex items-center justify-center text-[10px] font-bold" style="background:${p.color}22; color:${p.color}; border-color:${p.color}55">${p.name[0]}</div>`).join('')}
      </div>
    </div>
  </aside>`;
}

function renderModule(){
  switch(currentModule){
    case 'dashboard': return renderDashboard();
    case 'maison': return renderMaison();
    case 'tasks': return renderTasks();
    case 'calendar': return renderCalendar();
    case 'documents': return renderDocuments();
    case 'jarvis': return renderJarvisChat();
    case 'settings': return renderSettings();
    default: return '';
  }
}

/* =========================================================================
   DASHBOARD
   ========================================================================= */

function renderDashboard(){
  const weather = weatherData || getFallbackWeather();
  const alerts = computeAlerts();
  const upcomingTasks = [...state.tasks].filter(t=>!t.done).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,4);

  // score global maison (0-100) à partir des alertes
  let score = 100;
  alerts.forEach(a=> score -= a.level==='red' ? 22 : 10);
  score = Math.max(8, Math.min(100, score));
  const scoreColor = score>70 ? 'var(--green)' : score>40 ? 'var(--amber)' : 'var(--red)';

  return `
  <div class="flex items-center justify-between mb-6">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">TABLEAU DE BORD</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Maison de Mérignac</h1>
    </div>
    <div class="text-right hidden sm:block">
      <div class="font-mono text-xs text-[var(--text-mid)]">${new Date().toLocaleDateString('fr-FR',{weekday:'long', day:'numeric', month:'long'})}</div>
    </div>
  </div>

  <!-- Alertes — en premier -->
  <div id="alerts-section" class="mb-6">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">ALERTES & PLANS D'ACTION</div>
    <div class="space-y-2">
      ${alerts.length ? alerts.map(a=>`
        <div class="panel rounded-lg p-4 flex items-start gap-3 border-l-2" style="border-left-color:${a.level==='red'?'var(--red)':'var(--amber)'}">
          <span class="pulse mt-1 w-2 h-2 rounded-full shrink-0" style="background:${a.level==='red'?'var(--red)':'var(--amber)'}"></span>
          <div class="flex-1">
            <div class="font-semibold text-sm">${a.title}</div>
            <div class="text-xs text-[var(--text-mid)] mt-0.5">${a.detail}</div>
            <div class="text-xs text-[var(--cyan)] mt-1">→ ${a.action}</div>
          </div>
        </div>`).join('') : '<div class="text-sm text-[var(--text-low)]">Aucune alerte — tout est nominal.</div>'}
    </div>
  </div>

  <!-- Vos tâches — personnalisé selon "Vous êtes" -->
  <div class="mb-6">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">VOS TÂCHES — ${personById(currentUserId).name.toUpperCase()}</div>
    ${(()=>{
      const mine = state.tasks.filter(t=>t.assignee===currentUserId || (t.additionalAssignees||[]).includes(currentUserId));
      if (!mine.length) return `<div class="text-sm text-[var(--text-low)]">Rien à faire pour vous en ce moment.</div>`;
      return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${mine.map(t=>{
          const late = daysBetween(t.dueDate, todayISO())>0;
          return `
          <div class="panel rounded-lg p-3 flex items-center gap-3" style="border-left:2px solid ${late?'var(--red)':'var(--cyan)'}">
            <input type="checkbox" data-action="toggle-task" data-id="${t.id}">
            <div class="flex-1">
              <div class="text-sm">${t.title}</div>
              <div class="text-[10px] font-mono ${late?'text-[var(--red)]':'text-[var(--text-low)]'}">${t.category} · ${late?'en retard, ':''}échéance ${fmtDateShort(t.dueDate)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    })()}
  </div>

  <!-- Tâches récurrentes -->
  ${renderRecurringCard()}

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
    <!-- Core status ring -->
    <div class="panel rounded-lg p-6 flex flex-col items-center justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140" class="scan-ring">
        <circle cx="70" cy="70" r="60" fill="none" stroke="#1e2a3a" stroke-width="10"/>
        <circle cx="70" cy="70" r="60" fill="none" stroke="${scoreColor}" stroke-width="10"
          stroke-dasharray="${2*Math.PI*60}" stroke-dashoffset="${2*Math.PI*60*(1-score/100)}"
          stroke-linecap="round" transform="rotate(-90 70 70)"/>
        <text x="70" y="65" text-anchor="middle" fill="var(--text-hi)" font-family="Rajdhani" font-size="30" font-weight="700">${score}</text>
        <text x="70" y="85" text-anchor="middle" fill="var(--text-low)" font-family="JetBrains Mono" font-size="9">ETAT GENERAL</text>
      </svg>
      <button data-action="scroll-alerts" class="mt-3 text-xs text-[var(--cyan)] hover:underline text-center">${alerts.length} alerte(s) active(s) →</button>
    </div>

    <!-- Meteo -->
    <div class="panel rounded-lg p-5">
      <div class="badge text-[var(--text-low)] mb-2">MÉTÉO · MÉRIGNAC</div>
      <div class="flex items-center gap-3">
        <span class="text-4xl">${weather.icon}</span>
        <div>
          <div class="font-hud text-3xl font-700">${weather.temp}°</div>
          <div class="text-xs text-[var(--text-mid)]">Ressenti ${weather.feels}° · ${weather.condition}</div>
        </div>
      </div>
      <div class="flex justify-between mt-4 pt-3 border-t border-[var(--panel-border)]">
        ${weather.forecast.map(f=>`
          <div class="text-center">
            <div class="text-[10px] text-[var(--text-low)] font-mono">${f.day}</div>
            <div class="text-lg my-1">${f.icon}</div>
            <div class="text-xs font-mono">${f.temp}°</div>
          </div>`).join('')}
      </div>
      <div class="text-[10px] mt-3 font-mono flex items-center gap-1.5">
        ${weatherStatus==='live'
          ? `<span class="w-1.5 h-1.5 rounded-full" style="background:var(--green)"></span><span style="color:var(--green)">EN DIRECT — Open-Meteo, Mérignac</span>`
          : weatherStatus==='loading'
          ? `<span class="text-[var(--text-low)]">Connexion à Open-Meteo…</span>`
          : `<span class="w-1.5 h-1.5 rounded-full" style="background:var(--amber)"></span><span class="text-[var(--amber)]">SIMULÉ — réseau externe indisponible ici, fonctionnera une fois l'app déployée</span>`}
      </div>
      ${weatherHistory && weatherHistory.summary ? `<div class="text-[10px] text-[var(--amber)] font-mono mt-1">⚠ ${weatherHistory.summary}</div>` : ''}
    </div>

    <!-- Fil d'actualités -->
    <div class="panel rounded-lg p-5">
      <div class="badge text-[var(--text-low)] mb-3">FIL D'ACTUALITÉS</div>
      <div class="space-y-2 max-h-40 overflow-y-auto">
        ${state.news.map(n=>`
          <div class="flex items-start gap-2 text-sm">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style="background:${n.type==='event'?'var(--amber)':'var(--cyan)'}"></span>
            <div><div class="text-[var(--text-hi)]">${n.text}</div><div class="text-[10px] text-[var(--text-low)] font-mono">${fmtDate(n.date)}</div></div>
          </div>`).join('') || '<div class="text-sm text-[var(--text-low)]">Rien à signaler</div>'}
      </div>
    </div>
  </div>

  <!-- Prochaines tâches -->
  <div>
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">PROCHAINES TÂCHES</div>
      <button data-nav="tasks" class="text-xs text-[var(--cyan)] hover:underline">Voir tout →</button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${upcomingTasks.map(t=>`
        <div class="panel rounded-lg p-3 flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">${t.title}</div>
            <div class="text-[10px] text-[var(--text-low)] font-mono">${t.category} · ${fmtDateShort(t.dueDate)}</div>
          </div>
          <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style="background:${personById(t.assignee).color}22; color:${personById(t.assignee).color}">${personById(t.assignee).name[0]}</div>
        </div>`).join('')}
    </div>
  </div>
  `;
}

/* =========================================================================
   JARDIN & MATÉRIEL — plantes (style "Sims") + équipement, par catégories
   ========================================================================= */

function healthColor(h){ return h>66 ? 'var(--green)' : h>35 ? 'var(--amber)' : 'var(--red)'; }

// Barres d'état calculées automatiquement pour les plantes : décroissent avec le temps
// depuis le dernier arrosage/taille, comme la barre "Rangé" mais basées sur des dates réelles.
function careBarFromDate(dateStr, intervalDays){
  if (!dateStr) return 60;
  const daysSince = daysBetween(dateStr, todayISO());
  return Math.max(0, Math.min(100, Math.round(100 - (daysSince/intervalDays)*100)));
}
function plantWateringInterval(p){ return p.toleranceChaleur==='haute' ? 6 : p.toleranceChaleur==='moyenne' ? 4 : 2; }
function plantWateringBar(p){ return careBarFromDate(p.dernierArrosage, plantWateringInterval(p)); }
function plantPruningBar(p){
  const tailleAction = (p.actions||[]).filter(a=>a.type && a.type.toLowerCase().includes('taill')).sort((a,b)=> new Date(b.date)-new Date(a.date))[0];
  if (tailleAction) return careBarFromDate(tailleAction.date, 60);
  return p.tailleRecommandee ? 30 : 85;
}

let collapsedCategories = {}; // { 'Plante': false, ... }
let historyOpen = false;
let historyFilterPerson = '';
let historyFilterCat = '';
let recurringDetectBusy = false;
let recurringSuggestions = [];
function zoneName(zoneId){ const z = state.zones.find(z=>z.id===zoneId); return z ? z.name : '—'; }

// Construit une liste plate ordonnée en arbre pour peupler un <select>, avec indentation, en excluant une zone (et ses descendants) donnée
function buildZoneTreeOptions(excludeId){
  const isDescendant = (id, ancestorId)=>{
    let z = state.zones.find(z=>z.id===id);
    while(z && z.parentZoneId){ if (z.parentZoneId===ancestorId) return true; z = state.zones.find(x=>x.id===z.parentZoneId); }
    return false;
  };
  const out = [];
  const walk = (parentId, depth)=>{
    state.zones.filter(z=>z.parentZoneId===parentId).forEach(z=>{
      if (excludeId && (z.id===excludeId || isDescendant(z.id, excludeId))) return;
      out.push({ value:z.id, label:'—'.repeat(depth)+' '+z.name });
      walk(z.id, depth+1);
    });
  };
  walk(null, 0);
  return out;
}

function renderPlants(){
  return `
  <div class="flex items-center justify-between mb-6 flex-wrap gap-2">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">JARDIN & INTÉRIEUR</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Jardin & Matériel</h1>
    </div>
    <div class="flex gap-2">
      <button data-action="add-category" class="btn-ghost text-sm px-3 py-2 rounded-md">+ Catégorie</button>
      <button data-action="add-item" class="btn-primary text-sm px-4 py-2 rounded-md">+ Nouvel élément</button>
    </div>
  </div>

  ${state.itemCategories.map(cat=>{
    const items = state.plants.filter(p=>p.category===cat);
    const isOpen = !collapsedCategories[cat];
    return `
    <div class="mb-4">
      <button data-action="toggle-category" data-cat="${cat}" class="w-full flex items-center justify-between panel rounded-lg px-4 py-2.5 mb-2">
        <span class="text-sm font-semibold flex items-center gap-2">
          <span class="text-[var(--cyan)]">${isOpen?'▾':'▸'}</span> ${cat}
          <span class="text-[10px] text-[var(--text-low)] font-mono">(${items.length})</span>
        </span>
      </button>
      ${isOpen ? `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${items.length ? items.map(p=>renderItemCard(p)).join('') : `<div class="text-sm text-[var(--text-low)] col-span-full">Aucun élément dans cette catégorie.</div>`}
      </div>` : ''}
    </div>`;
  }).join('')}
  `;
}

function renderItemCard(p){
  const isPlant = p.category === 'Plante';
  return `
      <div class="panel rounded-lg p-4">
        <div class="flex items-start justify-between mb-2">
          <div>
            <div class="font-semibold">${p.name}</div>
            <div class="text-[11px] text-[var(--text-low)] font-mono">${p.subCategory||''} · ${zoneName(p.zoneId)}</div>
          </div>
          <button data-action="delete-plant" data-id="${p.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
        </div>

                ${photoSrc(p.photo) ? `
          <div class="relative mb-3">
            <img src="${photoSrc(p.photo)}" class="w-full h-28 object-cover rounded-md border border-[var(--panel-border)]"/>
            <button data-action="remove-plant-photo" data-id="${p.id}" class="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-black/80 text-[var(--red)] rounded-full text-sm font-bold">✕</button>
          </div>`
          : `<label class="w-full h-28 rounded-md mb-3 border border-dashed border-[var(--panel-border)] flex items-center justify-center text-[var(--text-low)] text-xs cursor-pointer hover:border-[var(--cyan)]">
               + Ajouter une photo
               <input type="file" accept="image/*" class="hidden" data-action="plant-photo" data-id="${p.id}">
             </label>`}

        ${isPlant ? `
        <div class="flex justify-between items-center text-[11px] mb-1">
          <span class="text-[var(--text-mid)]">Santé globale</span>
          <span class="font-mono" style="color:${healthColor(p.health)}">${p.health}/100</span>
        </div>
        <div class="health-bar mb-2">
          <div class="health-fill" style="width:${p.health}%; background:${healthColor(p.health)}"></div>
        </div>
        <div class="space-y-1 mb-3">
          <div class="flex items-center gap-2">
            <span class="text-[9px] text-[var(--text-low)] font-mono w-14">ARROSAGE</span>
            <div class="flex-1 health-bar" style="height:5px"><div class="health-fill" style="width:${plantWateringBar(p)}%; background:${barColor(plantWateringBar(p))}"></div></div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[9px] text-[var(--text-low)] font-mono w-14">TAILLAGE</span>
            <div class="flex-1 health-bar" style="height:5px"><div class="health-fill" style="width:${plantPruningBar(p)}%; background:${barColor(plantPruningBar(p))}"></div></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-mid)] mb-1">
          <div>Arrosé: <span class="text-[var(--text-hi)] font-mono">${fmtDateShort(p.dernierArrosage)}</span></div>
          <div>Exposition: <span class="text-[var(--text-hi)]">${p.exposition||'—'}</span></div>
          <div class="col-span-2">Tolérance chaleur: <span class="text-[var(--text-hi)]">${p.toleranceChaleur}</span></div>
        </div>
        <button data-action="edit-plant-traits" data-id="${p.id}" class="text-[10px] text-[var(--cyan)] hover:underline mb-2">Modifier exposition/tolérance</button>

        <div class="flex gap-2 mb-3">
          <button data-action="water-plant" data-id="${p.id}" class="btn-ghost text-xs px-2 py-1 rounded flex-1">💧 Arroser</button>
          <button data-action="prune-plant" data-id="${p.id}" class="btn-ghost text-xs px-2 py-1 rounded flex-1">✂️ Taillé</button>
          <input type="range" min="0" max="100" value="${p.health}" data-action="set-health" data-id="${p.id}" class="flex-1 accent-[var(--cyan)]">
        </div>

        ${p.actions.length ? `
          <div class="border-t border-[var(--panel-border)] pt-2 space-y-1">
            ${p.actions.map(a=>`
              <label class="flex items-center gap-2 text-xs ${a.done?'opacity-40 line-through':''}">
                <input type="checkbox" ${a.done?'checked':''} data-action="toggle-plant-action" data-plant="${p.id}" data-action-id="${a.id}">
                <span class="flex-1">${a.type}</span>
                <span class="text-[var(--text-low)] font-mono">${fmtDateShort(a.date)}</span>
              </label>`).join('')}
          </div>` : ''}
        ` : `
        <div class="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-mid)] mb-1">
          <div>État: <span class="text-[var(--text-hi)]">${p.etat||'—'}</span></div>
          <div>Quantité: <span class="text-[var(--text-hi)] font-mono">${p.quantite||1}</span></div>
        </div>
        ${p.notes ? `<div class="text-xs text-[var(--text-mid)] mt-1 mb-2">${p.notes}</div>` : ''}
        <button data-action="edit-item-traits" data-id="${p.id}" class="text-[10px] text-[var(--cyan)] hover:underline mb-2">Modifier état/quantité/notes</button>
        `}

        ${(p.statusBars||[]).length ? `
        <div class="space-y-1 mt-2">
          ${p.statusBars.map(b=>`
            <div>
              <div class="flex items-center justify-between text-[10px] mb-0.5">
                <span class="text-[var(--text-mid)]">${b.label}${b.lowAction!=='none'?` <span class="text-[var(--text-low)]">(${b.lowAction==='task'?'→ tâche':'→ projet'} si bas)</span>`:''}</span>
                <button data-action="delete-status-bar" data-item="${p.id}" data-bar="${b.id}" class="text-[var(--text-low)] hover:text-[var(--red)]">✕</button>
              </div>
              <div class="flex items-center gap-2">
                <input type="range" min="0" max="100" value="${b.value}" data-action="set-status-bar" data-item="${p.id}" data-bar="${b.id}" class="flex-1 accent-[var(--cyan)]" style="height:14px">
                <span class="text-[10px] font-mono w-7 text-right">${b.value}</span>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
        <button data-action="add-status-bar" data-item="${p.id}" class="text-[10px] text-[var(--cyan)] hover:underline mt-2 block">+ Ajouter une barre d'état</button>

        ${(p.customFields||[]).length ? `
        <div class="border-t border-[var(--panel-border)] pt-2 mt-2 space-y-1">
          ${p.customFields.map(f=>`
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-[var(--text-mid)]">${f.label}</span>
              <span class="flex items-center gap-1">
                <button data-action="edit-custom-field" data-item="${p.id}" data-field="${f.id}" class="text-[var(--text-hi)] hover:text-[var(--cyan)]">${f.value}</button>
                <button data-action="delete-custom-field" data-item="${p.id}" data-field="${f.id}" class="text-[var(--text-low)] hover:text-[var(--red)]">✕</button>
              </span>
            </div>
          `).join('')}
        </div>` : ''}
        <button data-action="add-custom-field" data-item="${p.id}" class="text-[10px] text-[var(--cyan)] hover:underline mt-2">+ Ajouter une info</button>
      </div>
  `;
}

/* =========================================================================
   MAISON — zones par étage, avec le plan à intégrer plus tard
   ========================================================================= */

let currentFolderId = null; // null = racine (tous les root zones)

function zoneChildren(zoneId){ return state.zones.filter(z=>z.parentZoneId===zoneId); }
function zoneBreadcrumb(zone){
  const chain = [];
  let z = zone;
  while(z){ chain.unshift(z); z = z.parentZoneId ? state.zones.find(x=>x.id===z.parentZoneId) : null; }
  return chain;
}
function zoneItemsDeep(zoneId){
  const direct = state.plants.filter(p=>p.zoneId===zoneId);
  const childItems = zoneChildren(zoneId).flatMap(c=>zoneItemsDeep(c.id));
  return direct.concat(childItems);
}
function zoneTidinessDeep(zoneId){
  const own = state.zones.find(z=>z.id===zoneId);
  const values = [own.tidiness];
  zoneChildren(zoneId).forEach(c=> values.push(zoneTidinessDeep(c.id)));
  return Math.round(values.reduce((a,b)=>a+b,0)/values.length);
}
function zoneHealthDeep(zoneId){
  const items = zoneItemsDeep(zoneId).filter(p=>p.category==='Plante');
  if (!items.length) return null;
  const avgHealth = items.reduce((sum,p)=>sum+p.health,0)/items.length;
  const overdueActions = items.reduce((n,p)=> n + (p.actions||[]).filter(a=>!a.done && daysBetween(a.date, todayISO())>0).length, 0);
  return Math.max(0, Math.min(100, Math.round(avgHealth - overdueActions*5)));
}
// "Ménage" : basé sur les tâches récurrentes de catégorie Ménage rattachées à cette zone (ou une sous-zone)
function zoneContains(ancestorId, id){
  let z = state.zones.find(z=>z.id===id);
  while(z){ if (z.id===ancestorId) return true; z = z.parentZoneId ? state.zones.find(x=>x.id===z.parentZoneId) : null; }
  return false;
}
function zoneMenageDeep(zoneId){
  const related = state.recurringTasks.filter(r=> r.category==='Ménage' && r.zoneId && zoneContains(zoneId, r.zoneId));
  if (!related.length) return null;
  const scores = related.map(r=>{
    const st = recurringStatus(r);
    if (st.severity==='ok') return 100;
    return Math.max(0, 100 - (st.overdue+1)*20);
  });
  return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
}
function zoneAlertCountDeep(zoneId){
  return zoneItemsDeep(zoneId).filter(p=>p.category==='Plante' && p.health<40).length;
}
function barColor(v){ return v>66 ? 'var(--green)' : v>35 ? 'var(--amber)' : 'var(--red)'; }

function renderZoneFolderCard(zone){
  const health = zoneHealthDeep(zone.id);
  const tidiness = zoneTidinessDeep(zone.id);
  const menage = zoneMenageDeep(zone.id);
  const alertCount = zoneAlertCountDeep(zone.id);
  const src = photoSrc(zone.photo);
  return `
  <div class="panel rounded-lg p-3">
    <button data-action="open-folder" data-id="${zone.id}" class="w-full text-left">
      ${src ? `<img src="${src}" class="w-full h-24 object-cover rounded-md mb-2"/>`
        : `<div class="w-full h-24 rounded-md mb-2 border border-dashed border-[var(--panel-border)] flex items-center justify-center text-[var(--text-low)] text-xs">Dossier</div>`}
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium">${zone.name}</div>
        ${alertCount ? `<span class="w-2 h-2 rounded-full pulse shrink-0" style="background:var(--red)"></span>` : ''}
      </div>
    </button>
    <div class="space-y-1 mt-2">
      ${health!==null ? `
        <div class="flex items-center gap-2">
          <span class="text-[9px] text-[var(--text-low)] font-mono w-12">PLANTES</span>
          <div class="flex-1 health-bar" style="height:5px"><div class="health-fill" style="width:${health}%; background:${barColor(health)}"></div></div>
        </div>` : ''}
      ${menage!==null ? `
        <div class="flex items-center gap-2">
          <span class="text-[9px] text-[var(--text-low)] font-mono w-12">MÉNAGE</span>
          <div class="flex-1 health-bar" style="height:5px"><div class="health-fill" style="width:${menage}%; background:${barColor(menage)}"></div></div>
        </div>` : ''}
      <div class="flex items-center gap-2">
        <span class="text-[9px] text-[var(--text-low)] font-mono w-12">RANGÉ</span>
        <div class="flex-1 health-bar" style="height:5px"><div class="health-fill" style="width:${tidiness}%; background:${barColor(tidiness)}"></div></div>
      </div>
    </div>
    <label class="text-[9px] text-[var(--cyan)] hover:underline mt-1 inline-block cursor-pointer">
      ${src?'Changer photo':'+ Photo'}<input type="file" accept="image/*" class="hidden" data-action="zone-photo" data-id="${zone.id}">
    </label>
  </div>`;
}

function renderMaison(){
  const rootZones = state.zones.filter(z=>!z.parentZoneId);
  const folder = currentFolderId ? state.zones.find(z=>z.id===currentFolderId) : null;
  const children = folder ? zoneChildren(folder.id) : rootZones;
  const items = folder ? state.plants.filter(p=>p.zoneId===folder.id) : [];
  const breadcrumb = folder ? zoneBreadcrumb(folder) : [];
  const zoneEvents = folder ? state.events.filter(e=> e.title.toLowerCase().includes(folder.name.toLowerCase())) : [];
  const zoneObservations = folder ? state.observations.filter(o=>o.zoneId===folder.id) : [];
  const health = folder ? zoneHealthDeep(folder.id) : null;
  const menage = folder ? zoneMenageDeep(folder.id) : null;
  const tidiness = folder ? zoneTidinessDeep(folder.id) : null;

  return `
  <div class="flex items-center justify-between mb-4">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">DOSSIER MAISON</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Maison</h1>
    </div>
    <button data-action="add-zone" class="btn-primary text-sm px-4 py-2 rounded-md">+ Nouvelle zone ici</button>
  </div>

  <div class="flex items-center gap-1 text-xs mb-4 flex-wrap">
    <button data-action="open-folder" data-id="" class="text-[var(--cyan)] hover:underline">Maison</button>
    ${breadcrumb.map(z=>`<span class="text-[var(--text-low)]">&rsaquo;</span><button data-action="open-folder" data-id="${z.id}" class="${folder && z.id===folder.id?'text-[var(--text-hi)]':'text-[var(--cyan)] hover:underline'}">${z.name}</button>`).join('')}
  </div>

  ${folder ? `
  <div class="panel rounded-lg p-4 mb-4">
    <div class="flex items-start gap-4">
      ${photoSrc(folder.photo) ? `
        <div class="relative w-28 h-28 shrink-0">
          <img src="${photoSrc(folder.photo)}" class="w-full h-full object-cover rounded-md"/>
          <button data-action="remove-zone-photo" data-id="${folder.id}" class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/80 text-[var(--red)] rounded-full text-xs font-bold">✕</button>
          <label class="absolute bottom-1 right-1 text-[9px] bg-black/60 text-[var(--cyan)] px-1.5 py-0.5 rounded cursor-pointer">
            Changer<input type="file" accept="image/*" class="hidden" data-action="zone-photo" data-id="${folder.id}">
          </label>
        </div>`
        : `<label class="w-28 h-28 rounded-md border border-dashed border-[var(--panel-border)] flex flex-col items-center justify-center text-[var(--text-low)] text-xs cursor-pointer shrink-0">
             + Photo<input type="file" accept="image/*" class="hidden" data-action="zone-photo" data-id="${folder.id}">
           </label>`}
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <h2 class="font-hud text-xl font-700">${folder.name}</h2>
          <div class="flex gap-2">
            <button data-action="edit-zone-meta" data-id="${folder.id}" class="btn-ghost text-xs px-2 py-1 rounded">Modifier</button>
            <button data-action="delete-zone" data-id="${folder.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">Supprimer</button>
          </div>
        </div>
        <div class="space-y-1.5 mt-2">
          ${health!==null ? `
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-low)] font-mono w-16">PLANTES</span>
            <div class="flex-1 health-bar" style="height:8px"><div class="health-fill" style="width:${health}%; background:${barColor(health)}"></div></div>
            <span class="text-[10px] font-mono w-8 text-right">${health}</span>
          </div>` : ''}
          ${menage!==null ? `
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-low)] font-mono w-16">MÉNAGE</span>
            <div class="flex-1 health-bar" style="height:8px"><div class="health-fill" style="width:${menage}%; background:${barColor(menage)}"></div></div>
            <span class="text-[10px] font-mono w-8 text-right">${menage}</span>
          </div>` : ''}
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-low)] font-mono w-16">RANGÉ</span>
            <input type="range" min="0" max="100" value="${tidiness}" data-action="set-tidiness" data-id="${folder.id}" class="flex-1 accent-[var(--cyan)]" style="height:8px">
            <span class="text-[10px] font-mono w-8 text-right">${tidiness}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">
          ${folder.exposition ? `<span class="text-[10px] font-mono px-2 py-1 rounded-full border border-[var(--panel-border)] text-[var(--cyan)]">Exposition: ${folder.exposition}</span>` : ''}
          ${folder.enjeux ? `<span class="text-[10px] font-mono px-2 py-1 rounded-full border border-[var(--panel-border)] text-[var(--amber)]">Enjeu: ${folder.enjeux}</span>` : ''}
          ${!folder.exposition && !folder.enjeux ? `<button data-action="edit-zone-meta" data-id="${folder.id}" class="text-[10px] text-[var(--cyan)] hover:underline">+ Ajouter exposition/enjeux</button>` : ''}
        </div>
      </div>
    </div>
  </div>` : `<div class="text-[10px] text-[var(--text-low)] font-mono mb-4">Cliquez sur une piece/zone pour l'ouvrir, comme un dossier.</div>`}

  ${children.length ? `
  <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">${folder?'SOUS-ZONES':'PIECES & ZONES'} (${children.length})</div>
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
    ${children.map(renderZoneFolderCard).join('')}
  </div>` : ''}

  ${folder ? `
  <div class="flex items-center justify-between mb-2">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">CONTENU (${items.length})</div>
    <button data-action="add-item" data-zone="${folder.id}" class="text-xs text-[var(--cyan)] hover:underline">+ Nouvel élément ici</button>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
    ${items.length ? items.map(renderItemCard).join('') : `<div class="text-sm text-[var(--text-low)] col-span-full">Rien enregistré directement ici.</div>`}
  </div>

  ${zoneEvents.length ? `
  <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">EVENEMENTS LIES</div>
  <div class="space-y-1 mb-6">
    ${zoneEvents.map(e=>`<div class="text-sm">${e.title} - <span class="text-[var(--text-low)] font-mono text-xs">${fmtDateShort(e.start)}</span></div>`).join('')}
  </div>` : ''}

  <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">OBSERVATIONS JARVIS</div>
  <div class="space-y-2">
    ${zoneObservations.length ? zoneObservations.map(o=>`
      <div class="flex items-start gap-2 text-sm">
        <span class="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style="background:${o.severity==='urgent'?'var(--red)':o.severity==='attention'?'var(--amber)':'var(--text-low)'}"></span>
        <div class="flex-1">${o.text}<div class="text-[10px] text-[var(--text-low)] font-mono">${fmtDateShort(o.date)}</div></div>
        <button data-action="delete-observation" data-id="${o.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">Suppr</button>
      </div>
    `).join('') : `<div class="text-sm text-[var(--text-low)]">Aucune observation ici - JARVIS les ajoute quand vous lui envoyez une photo.</div>`}
  </div>
  ` : ''}
  `;
}

/* =========================================================================
   TÂCHES & ÉQUITÉ
   ========================================================================= */

function renderTasks(){
  // Équité pondérée : chaque tâche complétée compte pour son "poids" (durée/difficulté)
  const weightSum = Object.fromEntries(PEOPLE.map(p=>[p.id,0]));
  const countSum = Object.fromEntries(PEOPLE.map(p=>[p.id,0]));
  state.completedLog.forEach(l=>{
    weightSum[l.person] = (weightSum[l.person]||0) + (l.weight||1);
    countSum[l.person] = (countSum[l.person]||0) + 1;
  });
  const maxWeight = Math.max(1, ...Object.values(weightSum));

  const categories = ['Ménage','Cuisine','Jardin','Déchetterie','Bricolage'];
  const weightLabel = {1:'Rapide', 2:'Moyen', 3:'Long'};

  return `
  <div class="flex items-center justify-between mb-6">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">CHARGE DOMESTIQUE</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Tâches</h1>
    </div>
    <button data-action="add-task" class="btn-primary text-sm px-4 py-2 rounded-md">+ Nouvelle tâche</button>
  </div>

  <!-- Equite -->
  <div class="panel rounded-lg p-5 mb-3">
    <div class="badge text-[var(--text-low)] mb-3">RÉPARTITION DE LA CHARGE — pondérée par durée/difficulté</div>
    <div class="space-y-3">
      ${PEOPLE.map(p=>`
        <div class="flex items-center gap-3">
          <div class="w-16 text-sm font-medium" style="color:${p.color}">${p.name}</div>
          <div class="flex-1 health-bar" style="height:10px">
            <div class="health-fill" style="width:${(weightSum[p.id]/maxWeight)*100}%; background:${p.color}"></div>
          </div>
          <div class="w-20 text-right font-mono text-xs text-[var(--text-mid)]">${weightSum[p.id]} pts · ${countSum[p.id]}t</div>
        </div>
      `).join('')}
    </div>
    <div class="text-[10px] text-[var(--text-low)] font-mono mt-3">1 point = tâche "rapide", 2 = "moyenne", 3 = "longue". Les tâches cochées sortent de la liste active et alimentent ce calcul.</div>
  </div>

  <!-- Tâches récurrentes -->
  <div class="mb-6">
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">TÂCHES RÉCURRENTES</div>
      <div class="flex gap-2">
        <button data-action="detect-recurring" class="text-xs text-[var(--cyan)] hover:underline">${recurringDetectBusy ? 'JARVIS analyse…' : 'JARVIS : détecter des récurrences'}</button>
        <button data-action="add-recurring" class="text-xs text-[var(--cyan)] hover:underline">+ Ajouter</button>
      </div>
    </div>
    ${recurringSuggestions.length ? `
    <div class="space-y-2 mb-2">
      ${recurringSuggestions.map((sug,i)=>`
        <div class="panel rounded-lg p-3 border-l-2" style="border-left-color:var(--cyan)">
          <div class="text-sm">${sug.title} <span class="text-[10px] text-[var(--text-low)] font-mono">(${sug.category}, tous les ${sug.intervalDays}j)</span></div>
          <div class="text-xs text-[var(--text-mid)] mt-1">${sug.reason||''}</div>
          <div class="flex gap-2 mt-2">
            <button data-action="accept-recurring-suggestion" data-index="${i}" class="btn-primary text-xs px-3 py-1 rounded">Créer</button>
            <button data-action="reject-recurring-suggestion" data-index="${i}" class="btn-ghost text-xs px-3 py-1 rounded">Ignorer</button>
          </div>
        </div>
      `).join('')}
    </div>` : ''}
    <div class="space-y-1">
      ${state.recurringTasks.map(rt=>{
        const status = recurringStatus(rt);
        return `
        <div class="panel rounded-lg p-3 flex items-center gap-3">
          <div class="flex-1">
            <div class="text-sm">${rt.title}</div>
            <div class="text-[10px] text-[var(--text-low)] font-mono">${rt.category} · tous les ${rt.intervalDays}j${rt.adaptiveTag?` · adaptatif (${rt.adaptiveTag})`:''} · dernier: il y a ${status.daysSince}j</div>
          </div>
          <button data-action="delete-recurring" data-id="${rt.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
        </div>`;
      }).join('') || '<div class="text-sm text-[var(--text-low)]">Aucune tâche récurrente.</div>'}
    </div>
  </div>

  <!-- Historique repliable -->
  <div class="mb-6">
    <button data-action="toggle-history" class="w-full flex items-center justify-between panel rounded-lg px-4 py-2.5">
      <span class="text-sm font-semibold flex items-center gap-2">
        <span class="text-[var(--cyan)]">${historyOpen?'▾':'▸'}</span> Historique complet (${state.completedLog.length})
      </span>
    </button>
    ${historyOpen ? `
    <div class="panel rounded-lg p-4 mt-2">
      <div class="flex gap-2 flex-wrap mb-3">
        <span class="text-[10px] text-[var(--text-low)] font-mono self-center mr-1">PAR PERSONNE</span>
        <button data-action="history-filter-person" data-value="" class="${historyFilterPerson===''?'btn-primary':'btn-ghost'} text-xs px-2 py-1 rounded-full">Tous</button>
        ${PEOPLE.map(p=>`<button data-action="history-filter-person" data-value="${p.id}" class="${historyFilterPerson===p.id?'btn-primary':'btn-ghost'} text-xs px-2 py-1 rounded-full">${p.name}</button>`).join('')}
      </div>
      <div class="flex gap-2 flex-wrap mb-3">
        <span class="text-[10px] text-[var(--text-low)] font-mono self-center mr-1">PAR CATÉGORIE</span>
        <button data-action="history-filter-cat" data-value="" class="${historyFilterCat===''?'btn-primary':'btn-ghost'} text-xs px-2 py-1 rounded-full">Toutes</button>
        ${categories.map(c=>`<button data-action="history-filter-cat" data-value="${c}" class="${historyFilterCat===c?'btn-primary':'btn-ghost'} text-xs px-2 py-1 rounded-full">${c}</button>`).join('')}
      </div>
      <div class="space-y-1 max-h-80 overflow-y-auto">
        ${[...state.completedLog].reverse()
          .filter(l=> (!historyFilterPerson || l.person===historyFilterPerson) && (!historyFilterCat || l.category===historyFilterCat))
          .map(l=>`
          <div class="flex items-center gap-2 text-xs border-b border-[var(--panel-border)] pb-1.5">
            <span class="w-2 h-2 rounded-full shrink-0" style="background:${personById(l.person).color}"></span>
            <span class="font-medium" style="color:${personById(l.person).color}">${personById(l.person).name}</span>
            <span class="flex-1 text-[var(--text-hi)]">${l.detail}</span>
            <span class="text-[var(--text-low)] font-mono">${l.category} · ${fmtDateShort(l.date)}</span>
          </div>
        `).join('') || '<div class="text-sm text-[var(--text-low)]">Rien pour ce filtre.</div>'}
      </div>
    </div>` : ''}
  </div>

  <!-- Sondages -->
  <div class="mb-6">
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">SONDAGES DE DISPONIBILITÉ</div>
      <button data-action="add-poll" class="text-xs text-[var(--cyan)] hover:underline">+ Créer un sondage</button>
    </div>
    <div class="space-y-2">
      ${state.polls.map(poll=>{
        const votedYes = PEOPLE.filter(p=>poll.votes[p.id]===true);
        const votedNo = PEOPLE.filter(p=>poll.votes[p.id]===false);
        const pending = PEOPLE.filter(p=>poll.votes[p.id]===null || poll.votes[p.id]===undefined);
        const required = poll.requiredPeople || 1;
        return `
        <div class="panel rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-medium">${poll.question} <span class="text-[10px] text-[var(--text-low)] font-mono">(besoin de ${required} personne${required>1?'s':''})</span></div>
            <span class="text-[10px] font-mono text-[var(--text-low)]">échéance ${fmtDateShort(poll.deadline)}</span>
          </div>
          <div class="flex flex-wrap gap-2">
            ${PEOPLE.map(p=>`
              <div class="flex items-center gap-1 text-xs border border-[var(--panel-border)] rounded-full px-2 py-1">
                <span style="color:${p.color}">${p.name}</span>
                <button data-action="poll-vote" data-poll="${poll.id}" data-person="${p.id}" data-vote="true" class="${poll.votes[p.id]===true?'text-[var(--green)]':'text-[var(--text-low)]'}">✓</button>
                <button data-action="poll-vote" data-poll="${poll.id}" data-person="${p.id}" data-vote="false" class="${poll.votes[p.id]===false?'text-[var(--red)]':'text-[var(--text-low)]'}">✕</button>
              </div>`).join('')}
          </div>
          ${poll.resolvedAssignees && poll.resolvedAssignees.length ? `
            <div class="text-xs text-[var(--green)] mt-2">✓ Attribué automatiquement à ${poll.resolvedAssignees.map(id=>personById(id).name).join(', ')}.</div>
          ` : pending.length===0 && votedYes.length===0 ? `
            <div class="text-xs text-[var(--red)] mt-2 mb-1">Personne disponible — à reporter :</div>
            <div class="flex gap-2 flex-wrap">
              <button data-action="poll-reschedule" data-poll="${poll.id}" data-days="1" class="btn-ghost text-xs px-2 py-1 rounded">+1 jour</button>
              <button data-action="poll-reschedule" data-poll="${poll.id}" data-days="2" class="btn-ghost text-xs px-2 py-1 rounded">+2 jours</button>
              <button data-action="poll-reschedule-custom" data-poll="${poll.id}" class="btn-ghost text-xs px-2 py-1 rounded">Choisir une date</button>
            </div>` : votedYes.length>0 ? `<div class="text-xs text-[var(--green)] mt-2">${votedYes.map(p=>p.name).join(', ')} disponible(s)${votedYes.length<required?` — en attente de ${required-votedYes.length} de plus`:''}.</div>` : ''}
        </div>`;
      }).join('') || '<div class="text-sm text-[var(--text-low)]">Aucun sondage actif.</div>'}
    </div>
  </div>

  <!-- Liste des tâches par catégorie -->
  <div>
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">TÂCHES</div>
    ${categories.map(cat=>{
      const items = state.tasks.filter(t=>t.category===cat);
      if(!items.length) return '';
      return `
      <div class="mb-4">
        <div class="text-xs text-[var(--text-mid)] mb-1">${cat}</div>
        <div class="space-y-1">
          ${items.map(t=>{
            const assigneeUnavailable = isUnavailable(t.assignee, t.dueDate);
            return `
            <div class="panel rounded-lg p-3 flex items-center gap-3 flex-wrap">
              <button data-action="toggle-task" data-id="${t.id}" title="Marquer fait" class="btn-ghost text-xs px-2 py-1.5 rounded text-[var(--green)]">✓ Fait</button>
              <button data-action="not-done-task" data-id="${t.id}" title="Pas fait — décale la tâche" class="btn-ghost text-xs px-2 py-1.5 rounded text-[var(--text-low)]">✗ Pas fait</button>
              <div class="flex-1 min-w-[140px]">
                <div class="text-sm">${t.title}</div>
                <div class="text-[10px] text-[var(--text-low)] font-mono">Échéance ${fmtDateShort(t.dueDate)} · ${weightLabel[t.weight]||'Moyen'}
                  ${assigneeUnavailable ? `<span class="text-[var(--amber)]">· ${personById(t.assignee).name} indisponible ce jour-là</span>` : ''}
                </div>
              </div>
              <div class="flex gap-1">
                ${PEOPLE.map(p=>{
                  const isAssigned = t.assignee===p.id || (t.additionalAssignees||[]).includes(p.id);
                  return `<button data-action="toggle-assignee" data-id="${t.id}" data-person="${p.id}" title="${p.name}" class="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center" style="background:${isAssigned?p.color:p.color+'22'}; color:${isAssigned?'#04211f':p.color}">${p.name[0]}</button>`;
                }).join('')}
              </div>
              <button data-action="reassign-fair" data-id="${t.id}" title="Réattribuer équitablement" class="btn-ghost text-xs px-2 py-1 rounded">⇄ Équité</button>
              <button data-action="delete-task" data-id="${t.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>
  `;
}

/* =========================================================================
   CALENDRIER
   ========================================================================= */

// --- Google Calendar : jetons stockés sur l'appareil de la personne connectée ---
function getGoogleTokens(){
  try{ const raw = localStorage.getItem('jarvis:google-tokens'); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
}
async function getValidGoogleAccessToken(){
  const tokens = getGoogleTokens();
  if (!tokens) return null;
  if (tokens.access_token && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  try{
    const res = await fetch('/api/auth/google/refresh', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ refresh_token: tokens.refresh_token })
    });
    const data = await res.json();
    if (!res.ok) return null;
    const updated = { ...tokens, access_token: data.access_token, expires_at: data.expires_at };
    localStorage.setItem('jarvis:google-tokens', JSON.stringify(updated));
    return data.access_token;
  }catch(e){ return null; }
}
function disconnectGoogle(){ localStorage.removeItem('jarvis:google-tokens'); googleEvents = []; render(); }

let googleEvents = [];
let googleSyncStatus = 'idle';

async function syncGoogleCalendar(){
  const token = await getValidGoogleAccessToken();
  if (!token){ googleEvents = []; render(); return; }
  googleSyncStatus = 'loading'; render();
  try{
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now()+14*86400000).toISOString();
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok){ googleSyncStatus = 'error'; render(); return; }
    googleEvents = data.items || [];
    googleSyncStatus = 'idle';
    if (!state.pushSettings.googleCalendarSync){ render(); return; }
    mutate(s=>{
      const existingIds = new Set(s.unavailabilities.filter(u=>u.googleEventId).map(u=>u.googleEventId));
      googleEvents.forEach(ev=>{
        if (ev.transparency === 'transparent') return;
        if (!ev.start?.dateTime) return;
        if (existingIds.has(ev.id)) return;
        const day = ev.start.dateTime.slice(0,10);
        s.unavailabilities.push({ id: uid(), person: currentUserId, label: ev.summary || 'Google Calendar', start: day, end: day, googleEventId: ev.id, fromGoogle: true });
      });
      const currentIds = new Set(googleEvents.map(e=>e.id));
      s.unavailabilities = s.unavailabilities.filter(u=> !u.fromGoogle || currentIds.has(u.googleEventId));
    });
  }catch(e){ googleSyncStatus = 'error'; render(); }
}

async function pushTaskToGoogleCalendar(task){
  const token = await getValidGoogleAccessToken();
  if (!token) return null;
  try{
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method:'POST',
      headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ summary: `JARVIS — ${task.title}`, start: { date: task.dueDate }, end: { date: task.dueDate } })
    });
    const data = await res.json();
    if (res.ok) return data.id;
  }catch(e){}
  return null;
}

function startOfWeek(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = day===0 ? -6 : 1-day;
  d.setDate(d.getDate()+diff);
  d.setHours(0,0,0,0);
  return d;
}
function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function isoDate(d){ return d.toISOString().slice(0,10); }
function minutesSinceMidnight(d){ return d.getHours()*60 + d.getMinutes(); }

const CAL_HOUR_START = 7, CAL_HOUR_END = 22, CAL_PX_PER_HOUR = 48;

function layoutDayEvents(events){
  const sorted = [...events].sort((a,b)=>a.startMin-b.startMin);
  const columns = [];
  sorted.forEach(ev=>{
    let placed = false;
    for (const col of columns){
      if (col[col.length-1].endMin <= ev.startMin){ col.push(ev); placed = true; break; }
    }
    if (!placed) columns.push([ev]);
  });
  const totalCols = columns.length || 1;
  const out = [];
  columns.forEach((col, colIdx)=> col.forEach(ev=> out.push({ ...ev, col: colIdx, totalCols })));
  return out;
}

function allDayItemsFor(dateStr){
  const items = [];
  state.tasks.filter(t=>t.dueDate===dateStr).forEach(t=>{
    items.push({ id:'t-'+t.id, title:t.title, kind:'tâche', color:'var(--cyan)' });
  });
  state.events.filter(e=>e.start===dateStr).forEach(e=>{
    items.push({ id:'e-'+e.id, title:e.title, kind:e.category, color:'var(--amber)' });
  });
  if (dateStr === isoDate(new Date())){
    state.recurringTasks.forEach(rt=>{
      const st = recurringStatus(rt);
      if (st.severity!=='ok') items.push({ id:'r-'+rt.id, title:rt.title+' (récurrent)', kind:'récurrent', color:'var(--amber)' });
    });
  }
  googleEvents.filter(ev=> ev.start?.date === dateStr).forEach(ev=>{
    items.push({ id:'g-'+ev.id, title: ev.summary||'(Google)', kind:'Google', color:'var(--text-low)' });
  });
  return items;
}

function timedItemsFor(dateStr){
  return googleEvents
    .filter(ev=> ev.start?.dateTime && ev.start.dateTime.slice(0,10)===dateStr)
    .map(ev=>{
      const start = new Date(ev.start.dateTime);
      const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : new Date(start.getTime()+3600000);
      return { id: ev.id, title: ev.summary||'(sans titre)', startMin: minutesSinceMidnight(start), endMin: Math.max(minutesSinceMidnight(end), minutesSinceMidnight(start)+20) };
    });
}

function renderCalendar(){
  const today = new Date(); today.setHours(0,0,0,0);
  const weekStart = addDays(startOfWeek(today), calendarWeekOffset*7);
  const weekDays = [0,1,2,3,4,5,6].map(i=> addDays(weekStart, i));

  const categories = ['Tous','Jardin','Ménage','Cuisine','Déchetterie','Bricolage'];
  const listItems = [...state.events]
    .filter(e=> calendarFilter==='Tous' || e.category===calendarFilter)
    .sort((a,b)=> new Date(a.start)-new Date(b.start));

  return `
  <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">PLANNING</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Calendrier</h1>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button data-action="add-event" class="btn-primary text-sm px-3 py-2 rounded-md">+ Événement</button>
      <button data-action="add-unavailability" class="btn-ghost text-sm px-3 py-2 rounded-md">+ Indisponibilité</button>
    </div>
  </div>

  <div class="panel rounded-lg p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
    <div class="text-xs">
      ${getGoogleTokens() ? `<span class="text-[var(--green)]">● Google Calendar connecté</span>` : `<span class="text-[var(--text-low)]">Google Calendar non connecté</span>`}
      ${googleSyncStatus==='loading' ? ' — synchronisation...' : ''}
    </div>
    <div class="flex gap-2">
      ${getGoogleTokens() ? `<button data-action="sync-google" class="btn-ghost text-xs px-3 py-1.5 rounded">Synchroniser</button>` : `<a href="/api/auth/google/login" class="btn-primary text-xs px-3 py-1.5 rounded inline-block">Connecter Google Calendar</a>`}
    </div>
  </div>

  <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
    <div class="flex gap-2">
      <button data-action="cal-view" data-mode="semaine" class="${calendarViewMode==='semaine'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Semaine</button>
      <button data-action="cal-view" data-mode="mois" class="${calendarViewMode==='mois'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Mois</button>
      <button data-action="cal-view" data-mode="liste" class="${calendarViewMode==='liste'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Liste</button>
    </div>
    ${calendarViewMode==='semaine' ? `
    <div class="flex items-center gap-2">
      <button data-action="cal-week-nav" data-dir="-1" class="btn-ghost text-xs px-2 py-1 rounded">←</button>
      <button data-action="cal-week-nav" data-dir="0" class="btn-ghost text-xs px-3 py-1 rounded">Aujourd'hui</button>
      <button data-action="cal-week-nav" data-dir="1" class="btn-ghost text-xs px-2 py-1 rounded">→</button>
    </div>` : ''}
  </div>

  ${calendarViewMode==='semaine' ? renderWeekGrid(weekDays) : ''}
  ${calendarViewMode==='mois' ? renderMonthGrid(weekStart) : ''}
  ${calendarViewMode==='liste' ? renderCalendarList(listItems, categories) : ''}

  <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2 mt-6">INDISPONIBILITÉS</div>
  <div class="space-y-2">
    ${state.unavailabilities.map(u=>`
      <div class="panel rounded-lg p-3 flex items-center gap-3">
        <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style="background:${personById(u.person).color}22; color:${personById(u.person).color}">${personById(u.person).name[0]}</div>
        <div class="flex-1 text-sm">${u.label} <span class="text-[var(--text-low)] font-mono text-xs">(${fmtDateShort(u.start)} → ${fmtDateShort(u.end)})</span></div>
        <button data-action="delete-unavail" data-id="${u.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
      </div>
    `).join('') || '<div class="text-sm text-[var(--text-low)]">Aucune indisponibilité déclarée.</div>'}
  </div>
  `;
}

function renderCalendarList(listItems, categories){
  return `
  <div class="flex gap-2 mb-4 flex-wrap">
    ${categories.map(c=>`
      <button data-action="filter-cal" data-cat="${c}" class="${calendarFilter===c?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">${c}</button>
    `).join('')}
  </div>
  <div class="space-y-2 mb-6">
    ${listItems.map(e=>`
      <div class="panel rounded-lg p-3 flex items-center gap-3">
        <div class="w-14 text-center shrink-0">
          <div class="text-[10px] text-[var(--text-low)] font-mono">${fmtDateShort(e.start)}</div>
        </div>
        <div class="flex-1">
          <div class="text-sm font-medium">${e.title}</div>
          <div class="text-[10px] font-mono" style="color:var(--cyan)">${e.category}</div>
        </div>
        ${e.person ? `<div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style="background:${personById(e.person).color}22; color:${personById(e.person).color}">${personById(e.person).name[0]}</div>` : ''}
        <button data-action="delete-event" data-id="${e.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
      </div>
    `).join('') || '<div class="text-sm text-[var(--text-low)]">Aucun événement dans cette catégorie.</div>'}
  </div>
  `;
}

function renderMonthGrid(weekStart){
  const refDate = weekStart;
  const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({length:42}, (_,i)=> addDays(gridStart, i));
  const monthLabel = refDate.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });

  return `
  <div class="text-sm font-semibold mb-2 capitalize">${monthLabel}</div>
  <div class="grid grid-cols-7 gap-1 mb-6">
    ${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d=>`<div class="text-[10px] text-[var(--text-low)] font-mono text-center pb-1">${d}</div>`).join('')}
    ${days.map(d=>{
      const dStr = isoDate(d);
      const inMonth = d.getMonth()===refDate.getMonth();
      const jarvisCount = allDayItemsFor(dStr).filter(i=>i.kind!=='Google').length;
      const googleCount = allDayItemsFor(dStr).filter(i=>i.kind==='Google').length + timedItemsFor(dStr).length;
      const isToday = dStr === isoDate(new Date());
      return `
      <button data-action="cal-pick-day" data-date="${dStr}" class="panel rounded p-1.5 text-left h-16 ${inMonth?'':'opacity-30'} ${isToday?'border-[var(--cyan)]':''}">
        <div class="text-[10px] font-mono">${d.getDate()}</div>
        <div class="flex gap-0.5 mt-1 flex-wrap">
          ${jarvisCount ? `<span class="w-1.5 h-1.5 rounded-full" style="background:var(--cyan)"></span>` : ''}
          ${googleCount ? `<span class="w-1.5 h-1.5 rounded-full" style="background:var(--text-low)"></span>` : ''}
        </div>
      </button>`;
    }).join('')}
  </div>
  `;
}

function renderWeekGrid(weekDays){
  const totalHeight = (CAL_HOUR_END - CAL_HOUR_START) * CAL_PX_PER_HOUR;
  const hours = [];
  for (let h=CAL_HOUR_START; h<=CAL_HOUR_END; h++) hours.push(h);

  return `
  <div class="mb-6 overflow-x-auto">
    <div style="min-width:700px">
      <div class="grid" style="grid-template-columns: 50px repeat(7, 1fr);">
        <div></div>
        ${weekDays.map(d=>{
          const dStr = isoDate(d);
          const isToday = dStr === isoDate(new Date());
          return `<div class="text-center pb-2">
            <div class="text-[10px] text-[var(--text-low)] font-mono">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div>
            <div class="text-sm font-semibold ${isToday?'text-[var(--cyan)]':''}">${d.getDate()}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="grid" style="grid-template-columns: 50px repeat(7, 1fr);">
        <div></div>
        ${weekDays.map(d=>{
          const dStr = isoDate(d);
          const items = allDayItemsFor(dStr);
          return `<div class="px-1 pb-2 space-y-1 min-h-[24px]">
            ${items.map(it=>`<div class="text-[9px] rounded px-1 py-0.5 truncate" style="background:${it.color}22; color:${it.color}" title="${it.title}">${it.title}</div>`).join('')}
          </div>`;
        }).join('')}
      </div>

      <div class="grid" style="grid-template-columns: 50px repeat(7, 1fr);">
        <div class="relative" style="height:${totalHeight}px">
          ${hours.map(h=>`<div class="absolute text-[9px] text-[var(--text-low)] font-mono" style="top:${(h-CAL_HOUR_START)*CAL_PX_PER_HOUR-6}px; right:4px">${h}h</div>`).join('')}
        </div>
        ${weekDays.map(d=>{
          const dStr = isoDate(d);
          const positioned = layoutDayEvents(timedItemsFor(dStr));
          return `
          <div class="relative border-l border-[var(--panel-border)]" style="height:${totalHeight}px">
            ${hours.map(h=>`<div class="absolute w-full border-t border-[var(--panel-border)]" style="top:${(h-CAL_HOUR_START)*CAL_PX_PER_HOUR}px"></div>`).join('')}
            ${positioned.map(ev=>{
              const top = Math.max(0, (ev.startMin - CAL_HOUR_START*60)/60*CAL_PX_PER_HOUR);
              const height = Math.max(16, (ev.endMin-ev.startMin)/60*CAL_PX_PER_HOUR);
              const widthPct = 100/ev.totalCols;
              const leftPct = ev.col*widthPct;
              return `<div class="absolute rounded px-1 py-0.5 text-[9px] overflow-hidden panel" style="top:${top}px; height:${height}px; left:${leftPct}%; width:${widthPct-2}%; background:rgba(61,214,208,0.15); border-color:var(--cyan);" title="${ev.title}">${ev.title}</div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>
  `;
}

/* =========================================================================
   COFFRE-FORT DOCUMENTAIRE
   ========================================================================= */

function renderDocuments(){
  return `
  <div class="flex items-center justify-between mb-6">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">ARCHIVES</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">Coffre-fort documentaire</h1>
    </div>
    <button data-action="add-doc" class="btn-primary text-sm px-4 py-2 rounded-md">+ Ajouter un document</button>
  </div>

  <div class="text-[10px] text-[var(--text-low)] font-mono mb-4">
    Fichiers légers (images, PDF < ~1,5 Mo) stockés directement. Pour de gros volumes en production, prévoir un vrai stockage (Drive, S3) — le prototype garde tout dans le stockage local de l'app.
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    ${state.documents.map(d=>`
      <div class="panel rounded-lg p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold text-sm">${d.name}</div>
            <div class="text-[10px] font-mono text-[var(--cyan)] mt-0.5">${d.category}</div>
          </div>
          <button data-action="delete-doc" data-id="${d.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
        </div>
        ${d.note ? `<div class="text-xs text-[var(--text-mid)] mt-2">${d.note}</div>` : ''}
        <div class="text-[10px] text-[var(--text-low)] font-mono mt-2 mb-2">${fmtDate(d.date)}</div>

        ${d.file ? `
          <div class="flex gap-2 mt-2 pt-2 border-t border-[var(--panel-border)]">
            <button data-action="view-doc" data-id="${d.id}" class="btn-ghost text-xs px-2 py-1 rounded flex-1">👁 Voir</button>
            <a href="${photoSrc(d.file)||'#'}" download="${d.name}" class="btn-ghost text-xs px-2 py-1 rounded flex-1 text-center">⬇ Télécharger</a>
          </div>
        ` : `
          <label class="btn-ghost text-xs px-2 py-1 rounded mt-2 inline-block cursor-pointer">
            📎 Joindre un fichier
            <input type="file" accept="image/*,application/pdf" class="hidden" data-action="doc-file" data-id="${d.id}">
          </label>
        `}
      </div>
    `).join('')}
  </div>
  `;
}

/* =========================================================================
   JARVIS — Assistant IA (Claude API multimodal)
   ========================================================================= */

let jarvisBusy = false;
let pendingImages = [];
let lastFailedMessage = null;
let jarvisTab = 'chat'; // 'chat' | 'audit'
let auditBusy = false;
let pendingAuditPhoto = {}; // { [questionId]: dataUrl }

function renderSettings(){
  const labels = {
    googleCalendarSync: "Importer automatiquement les indisponibilités depuis Google Calendar",
    tachesAssignees: "Notification quand une tâche m'est assignée",
    tachesRecurrentesDues: "Notification quand une tâche récurrente est due",
    alertesMeteo: "Notification pour les alertes météo (canicule, orage...)",
    alertesUrgentes: "Notification pour les alertes urgentes de la maison",
    sondagesDisponibilite: "Notification pour les sondages de disponibilité",
    observationsJarvis: "Notification pour les observations de JARVIS",
  };
  const tokens = getGoogleTokens();

  return `
  <div class="mb-6">
    <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">RÉGLAGES</div>
    <h1 class="font-hud text-2xl md:text-3xl font-700">Paramètres</h1>
  </div>

  <div class="panel rounded-lg p-4 mb-4">
    <div class="badge text-[var(--text-low)] mb-3">GOOGLE CALENDAR</div>
    <div class="text-sm mb-2">${tokens ? '● Connecté sur cet appareil' : 'Non connecté'}</div>
    <div class="flex gap-2">
      ${tokens
        ? `<button data-action="disconnect-google" class="btn-ghost text-xs px-3 py-1.5 rounded text-[var(--red)]">Déconnecter</button>`
        : `<a href="/api/auth/google/login" class="btn-primary text-xs px-3 py-1.5 rounded inline-block">Connecter</a>`}
    </div>
  </div>
  <div class="panel rounded-lg p-4 mb-4">
    <div class="badge text-[var(--text-low)] mb-3">SAUVEGARDE DES DONNÉES</div>
    <div class="flex gap-2 flex-wrap">
      <button data-action="export-data" class="btn-primary text-xs px-3 py-1.5 rounded">Exporter mes données</button>
      <button data-action="import-data" class="btn-ghost text-xs px-3 py-1.5 rounded">Importer une sauvegarde</button>
    </div>
    <div class="text-[10px] text-[var(--text-low)] font-mono mt-2">
      Exporter copie toutes vos données (hors photos) dans le presse-papier — collez-les dans une note pour les garder en sécurité.
    </div>
  </div>
  <div class="panel rounded-lg p-4">
    <div class="badge text-[var(--text-low)] mb-3">NOTIFICATIONS & SYNCHRONISATION</div>
    <div class="space-y-3">
      ${Object.keys(labels).map(key=>`
        <label class="flex items-center justify-between gap-3 text-sm cursor-pointer">
          <span class="flex-1">${labels[key]}</span>
          <input type="checkbox" data-action="toggle-setting" data-key="${key}" ${state.pushSettings[key] ? 'checked' : ''} class="accent-[var(--cyan)] w-4 h-4">
        </label>
      `).join('')}
    </div>
    <div class="text-[10px] text-[var(--text-low)] font-mono mt-3">
      Les vraies notifications push (alertes sur le téléphone même app fermée) nécessitent une étape technique supplémentaire — ces réglages préparent déjà ce qui sera envoyé une fois branché.
    </div>
  </div>
  `;
}

function renderJarvisChat(){
  return `
  <div class="mb-4 flex items-center justify-between">
    <div>
      <div class="text-[11px] font-mono text-[var(--text-low)] tracking-widest">ASSISTANT</div>
      <h1 class="font-hud text-2xl md:text-3xl font-700">JARVIS</h1>
    </div>
    <div class="flex gap-2">
      <button data-action="jarvis-tab" data-tab="chat" class="${jarvisTab==='chat'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Discussion</button>
      ${jarvisTab==='chat' ? `<button data-action="clear-chat" class="btn-ghost text-xs px-3 py-1.5 rounded-full text-[var(--red)]">🗑 Vider</button>` : ''}
      <button data-action="jarvis-tab" data-tab="projects" class="${jarvisTab==='projects'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Projets</button>
      <button data-action="jarvis-tab" data-tab="audit" class="${jarvisTab==='audit'?'btn-primary':'btn-ghost'} text-xs px-3 py-1.5 rounded-full">Audit initial</button>
    </div>
  </div>
  ${jarvisTab==='chat' ? renderChatTab() : jarvisTab==='projects' ? renderProjectsTab() : renderAuditTab()}
  `;
}

function renderChatTab(){
  return `
  <div class="flex flex-col h-[calc(100vh-9rem)] max-h-[820px]">
    <div id="chat-log" class="flex-1 overflow-y-auto space-y-3 panel rounded-lg p-4 mb-3">
      ${state.chat.map(m=>`
        <div class="flex ${m.role==='user'?'justify-end':'justify-start'}">
          <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role==='user' ? 'bg-[var(--cyan-dim)] text-[var(--text-hi)]' : 'bg-[var(--bg-0)] border border-[var(--panel-border)]'}">
            ${(m.images||[]).map(img=>`<img src="${photoSrc(img)}" class="rounded mb-2 max-h-40"/>`).join('')}
            ${m.isError ? `<button data-action="retry-jarvis" class="text-xs text-[var(--cyan)] hover:underline mt-1">↻ Réessayer</button>` : ''}
            <div style="white-space:pre-wrap">${m.text}</div>
          </div>
        </div>
      `).join('')}
      ${jarvisBusy ? `<div class="text-xs text-[var(--text-low)] font-mono">JARVIS analyse…</div>` : ''}
    </div>

    ${pendingImages.length ? `<div class="mb-2 flex items-center gap-2 flex-wrap">
      ${pendingImages.map((img,i)=>`<div class="relative"><img src="${img}" class="h-14 rounded border border-[var(--panel-border)]"/><button data-action="clear-image" data-index="${i}" class="absolute -top-1 -right-1 bg-black/70 text-[var(--red)] rounded-full w-4 h-4 text-[10px] leading-none">✕</button></div>`).join('')}
    </div>` : ''}

    <div class="flex gap-2">
      <label class="btn-ghost rounded-md px-3 flex items-center cursor-pointer text-lg">
        📷<input type="file" accept="image/*" multiple class="hidden" data-action="jarvis-image">
      </label>
      <input id="jarvis-input" type="text" placeholder="Ex: Les plants de tomates sont morts, on en a plus..."
        class="flex-1 rounded-md px-3 py-2 text-sm" data-action="jarvis-input-field">
      <button data-action="jarvis-send" class="btn-primary rounded-md px-4 text-sm">Envoyer</button>
    </div>
    <div class="text-[10px] text-[var(--text-low)] font-mono mt-2">
      JARVIS peut créer des tâches, mettre à jour l'état des plantes, et diagnostiquer des photos. Confirmez les actions proposées.
    </div>
  </div>
  `;
}

/* =========================================================================
   PROJETS — suggérés par JARVIS ou créés manuellement, chat dédié + matériel
   ========================================================================= */

let selectedProjectId = null;
let projectChatBusy = false;
let projectsBusy = false;

function renderProjectsTab(){
  const project = state.projects.find(p=>p.id===selectedProjectId);
  if (project) return renderProjectDetail(project);

  const suggested = state.projects.filter(p=>p.status==='suggested');
  const active = state.projects.filter(p=>p.status==='active');

  return `
  <div class="flex items-center justify-between mb-4">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">SUGGESTIONS DE JARVIS</div>
    <button data-action="suggest-projects" class="text-xs text-[var(--cyan)] hover:underline">${projectsBusy ? 'JARVIS réfléchit…' : '+ Proposer des projets'}</button>
  </div>
  <div class="space-y-2 mb-6">
    ${suggested.length ? suggested.map(p=>`
      <div class="panel rounded-lg p-4">
        <div class="text-sm font-semibold mb-1">${p.name}</div>
        <div class="text-xs text-[var(--text-mid)] mb-3">${p.justification||''}</div>
        <div class="flex gap-2">
          <button data-action="start-project" data-id="${p.id}" class="btn-primary text-xs px-3 py-1.5 rounded">Démarrer</button>
          <button data-action="ignore-project" data-id="${p.id}" class="btn-ghost text-xs px-3 py-1.5 rounded">Ignorer</button>
        </div>
      </div>
    `).join('') : `<div class="text-sm text-[var(--text-low)]">Aucune suggestion pour l'instant.</div>`}
  </div>

  <div class="flex items-center justify-between mb-2">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">MES PROJETS (${active.length})</div>
    <button data-action="add-project" class="text-xs text-[var(--cyan)] hover:underline">+ Nouveau projet</button>
  </div>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    ${active.length ? active.map(p=>`
      <button data-action="open-project" data-id="${p.id}" class="panel rounded-lg p-4 text-left">
        <div class="flex items-start justify-between">
          <div class="text-sm font-semibold">${p.name}</div>
          <span class="text-[10px] text-[var(--text-low)] font-mono">${p.materials.length} article(s)</span>
        </div>
        <div class="text-xs text-[var(--text-mid)] mt-1">${p.chat.length} message(s) · créé ${fmtDateShort(p.createdDate)}</div>
      </button>
    `).join('') : `<div class="text-sm text-[var(--text-low)]">Aucun projet actif.</div>`}
  </div>
  `;
}

function renderProjectDetail(p){
  return `
  <button data-action="close-project" class="text-xs text-[var(--cyan)] hover:underline mb-3">← Tous les projets</button>
  <div class="flex items-center justify-between mb-4">
    <h2 class="font-hud text-xl font-700">${p.name}</h2>
    <div class="flex gap-2">
      <button data-action="rename-project" data-id="${p.id}" class="btn-ghost text-xs px-3 py-1.5 rounded">Renommer</button>
      <button data-action="delete-project" data-id="${p.id}" class="btn-ghost text-xs px-3 py-1.5 rounded text-[var(--red)]">Supprimer</button>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="lg:col-span-2 flex flex-col h-[60vh]">
      <div id="project-chat-log" class="flex-1 overflow-y-auto space-y-3 panel rounded-lg p-4 mb-3">
        ${p.chat.map(m=>`
          <div class="flex ${m.role==='user'?'justify-end':'justify-start'}">
            <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role==='user' ? 'bg-[var(--cyan-dim)] text-[var(--text-hi)]' : 'bg-[var(--bg-0)] border border-[var(--panel-border)]'}" style="white-space:pre-wrap">${m.text}</div>
          </div>
        `).join('') || `<div class="text-sm text-[var(--text-low)]">Décrivez le projet à JARVIS pour commencer à le préparer.</div>`}
        ${projectChatBusy ? `<div class="text-xs text-[var(--text-low)] font-mono">JARVIS réfléchit…</div>` : ''}
      </div>
      <div class="flex gap-2">
        <input id="project-input" type="text" placeholder="Discutez du projet avec JARVIS…" class="flex-1 rounded-md px-3 py-2 text-sm">
        <button data-action="project-send" data-id="${p.id}" class="btn-primary rounded-md px-4 text-sm">Envoyer</button>
      </div>
    </div>

    <div class="panel rounded-lg p-4">
      <div class="badge text-[var(--text-low)] mb-3">MATÉRIEL À ACHETER</div>
      <div class="space-y-1 mb-3">
        ${p.materials.length ? p.materials.map(m=>`
          <label class="flex items-center gap-2 text-sm ${m.bought?'opacity-40 line-through':''}">
            <input type="checkbox" ${m.bought?'checked':''} data-action="toggle-material" data-project="${p.id}" data-mat="${m.id}">
            <span class="flex-1">${m.name}</span>
            <button data-action="delete-material" data-project="${p.id}" data-mat="${m.id}" class="text-[var(--text-low)] hover:text-[var(--red)] text-xs">✕</button>
          </label>
        `).join('') : `<div class="text-xs text-[var(--text-low)]">Rien pour l'instant — JARVIS peut l'alimenter au fil de la discussion.</div>`}
      </div>
      <button data-action="add-material" data-project="${p.id}" class="btn-ghost text-xs px-2 py-1.5 rounded w-full">+ Ajouter un article</button>
    </div>
  </div>
  `;
}

async function suggestProjects(){
  projectsBusy = true; render();
  const prompt = `Maison de Mérignac : ${JSON.stringify({house:state.house, alertes: computeAlerts().map(a=>a.title), plantesEnDifficulte: state.plants.filter(p=>p.category==='Plante'&&p.health<50).map(p=>p.name)})}.
Propose 2 à 4 projets pertinents pour cette colocation (Camil, Luc, Clément), chacun avec une justification FACTUELLE courte basée sur l'état réel de la maison ci-dessus (pas de généralités). Exemples de bons projets: raccorder les panneaux solaires, planifier l'entretien chaudière, aménager le potager, etc. Réponds en JSON strict: {"projects":[{"name":"...", "justification":"..."}]}`;
  try{
    const res = await fetch('/api/jarvis-chat', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:700, messages:[{ role:'user', content:prompt }] })
    });
    const data = await res.json();
    const cleaned = (data.content||[]).map(b=>b.text||'').join('').replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(cleaned);
    (parsed.projects||[]).forEach(pr=>{
      state.projects.push({ id:uid(), name:pr.name, status:'suggested', justification:pr.justification, chat:[], materials:[], createdDate:todayISO() });
    });
  }catch(e){ /* silencieux — on retentera */ }
  projectsBusy = false;
  saveState(); render();
}

async function sendProjectMessage(projectId, text){
  const p = state.projects.find(p=>p.id===projectId);
  if (!p) return;
  p.chat.push({ role:'user', text });
  projectChatBusy = true;
  render();

  const materialsList = p.materials.map(m=>m.name).join(', ') || 'aucun pour l\'instant';
  const systemPrompt = `Tu es JARVIS et tu aides à préparer le projet "${p.name}" pour la colocation de Mérignac (Camil, Luc, Clément). ${p.justification?('Contexte: '+p.justification):''}
Matériel déjà listé: ${materialsList}.
Réponds en JSON strict: {"reply":"réponse conversationnelle en français", "materialsToAdd":["..."], "materialsToRemove":["..."]}. Les tableaux peuvent être vides. N'ajoute que du matériel vraiment évoqué dans la conversation.`;

  try{
    const res = await fetch('/api/jarvis-chat', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:800, system: systemPrompt, messages:[{ role:'user', content:text }] })
    });
    const data = await res.json();
    const cleaned = (data.content||[]).map(b=>b.text||'').join('').replace(/```json|```/g,'').trim();
    let parsed;
    try{ parsed = JSON.parse(cleaned); } catch(e){ parsed = { reply: cleaned || '...', materialsToAdd:[], materialsToRemove:[] }; }
    (parsed.materialsToAdd||[]).forEach(name=> p.materials.push({ id:uid(), name, bought:false }));
    (parsed.materialsToRemove||[]).forEach(name=>{ p.materials = p.materials.filter(m=>m.name!==name); });
    p.chat.push({ role:'assistant', text: parsed.reply || '...' });
  }catch(e){
    p.chat.push({ role:'assistant', text:"Erreur de connexion. Réessaie dans un instant." });
  }
  projectChatBusy = false;
  saveState(); render();
  requestAnimationFrame(()=>{ const el = document.getElementById('project-chat-log'); if(el) el.scrollTop = el.scrollHeight; });
}

function renderAuditTab(){
  const pending = state.audit.questions.filter(q=>q.status==='pending');
  const answered = state.audit.questions.filter(q=>q.status==='answered');
  const ignored = state.audit.questions.filter(q=>q.status==='ignored');

  return `
  <div class="mb-4 text-sm text-[var(--text-mid)] panel rounded-lg p-4">
    Audit initial : JARVIS pose ses questions une par une. Répondez, dites <span class="text-[var(--amber)]">"je ne sais pas"</span> pour la reporter en fin de file, ou <span class="text-[var(--red)]">"non pertinent"</span> pour l'écarter définitivement. Certaines demandent une photo (état d'une plante, pour créer sa fiche visuelle, etc.).
  </div>

  <div class="flex items-center justify-between mb-2">
    <div class="text-xs font-mono text-[var(--text-low)] tracking-widest">FILE D'ATTENTE (${pending.length})</div>
    <button data-action="audit-generate" class="text-xs text-[var(--cyan)] hover:underline">${auditBusy ? 'JARVIS réfléchit…' : '+ Générer de nouvelles questions'}</button>
  </div>

  <div class="space-y-3 mb-6">
    ${pending.length ? pending.map((q,i)=>`
      <div class="panel rounded-lg p-4 ${i===0?'border-[var(--cyan)]':''}">
        <div class="text-sm mb-2">${q.text}</div>
        ${q.needsPhoto ? `<div class="text-[10px] text-[var(--amber)] font-mono mb-2">📷 Photo souhaitée</div>` : ''}

        ${pendingAuditPhoto[q.id] ? `<img src="${pendingAuditPhoto[q.id]}" class="h-16 rounded mb-2 border border-[var(--panel-border)]"/>` : ''}

        <div class="flex gap-2 flex-wrap items-center">
          <input type="text" placeholder="Votre réponse…" data-audit-answer="${q.id}" class="flex-1 min-w-[160px] rounded px-2 py-1.5 text-sm">
          <label class="btn-ghost text-xs px-2 py-1.5 rounded cursor-pointer">
            📷<input type="file" accept="image/*" class="hidden" data-action="audit-photo" data-id="${q.id}">
          </label>
          <button data-action="audit-answer" data-id="${q.id}" class="btn-primary text-xs px-3 py-1.5 rounded">Valider</button>
          <button data-action="audit-dontknow" data-id="${q.id}" class="btn-ghost text-xs px-2 py-1.5 rounded">Je ne sais pas</button>
          <button data-action="audit-ignore" data-id="${q.id}" class="btn-ghost text-xs px-2 py-1.5 rounded text-[var(--text-low)]">Non pertinent</button>
        </div>
      </div>
    `).join('') : `<div class="text-sm text-[var(--text-low)]">File vide — cliquez sur "Générer de nouvelles questions" pour continuer l'audit.</div>`}
  </div>

  ${answered.length ? `
  <div class="text-xs font-mono text-[var(--text-low)] tracking-widest mb-2">RÉPONDUES (${answered.length})</div>
  <div class="space-y-1 mb-6">
    ${answered.map(q=>`
      <div class="panel rounded-lg p-3">
        <div class="text-xs text-[var(--text-mid)]">${q.text}</div>
        <div class="text-sm mt-1">${q.answer||''}</div>
        ${q.photo ? `<img src="${photoSrc(q.photo)}" class="h-14 rounded mt-2 border border-[var(--panel-border)]"/>` : ''}
      </div>
    `).join('')}
  </div>` : ''}

  ${ignored.length ? `<div class="text-[10px] text-[var(--text-low)] font-mono">${ignored.length} question(s) écartée(s).</div>` : ''}
  `;
}

function buildJarvisSystemPrompt(){
  const stressLine = weatherHistory && weatherHistory.summary ? `\nStress météo cumulé (21 derniers jours) : ${weatherHistory.summary}` : '';
  return `Tu es JARVIS, l'assistant IA domestique de la colocation de Mérignac (T5 103m², 2 jardins, 2 cabanons, chaudière gaz, panneaux solaires non raccordés). Colocataires: Camil, Luc, Clément.

La personne qui te parle actuellement est: ${personById(currentUserId).name} (id: "${currentUserId}").

Zones de la maison, hiérarchiques (pour situer précisément ce que tu vois sur une photo, ex: dans "Terrasse" ou dans son sous-lieu "Pots en terre cuite") :
${state.zones.map(z=>`${zoneBreadcrumb(z).map(x=>x.name).join(' > ')} [id:${z.id}]${z.exposition?` (exposition: ${z.exposition})`:''}${z.enjeux?` (enjeux: ${z.enjeux})`:''}`).join('\n')}
${stressLine}

État actuel de la maison (JSON):
${JSON.stringify({
  house: state.house,
  plants: state.plants.map(p=>({id:p.id,name:p.name,category:p.category,health:p.health,zoneId:p.zoneId,exposition:p.exposition,toleranceChaleur:p.toleranceChaleur,statusBars:(p.statusBars||[]).map(b=>({label:b.label,value:b.value}))})),
  tachesActives: state.tasks.map(t=>({id:t.id,title:t.title,category:t.category,assignee:t.assignee})),
  tachesRecurrentes: state.recurringTasks.map(r=>({id:r.id,title:r.title,intervalDays:r.intervalDays,adaptiveTag:r.adaptiveTag})),
})}

Quand on t'envoie une photo, analyse-la en détail comme le ferait quelqu'un qui visite la maison :
- Plante : espèce probable, état (hydratation, jaunissement, taille nécessaire, parasites visibles), en tenant compte du stress météo cumulé ci-dessus si pertinent (une plante fatiguée après 3 semaines de sécheresse n'a pas le même diagnostic qu'une plante isolée).
- Matériau/équipement : nature, état de dégradation (rouille, fissure, usure), urgence d'intervention.
- Contexte du lieu : dans quelle zone ça se trouve si identifiable, exposition probable (mur sud = chaleur, etc.), et tout enjeu visible même non demandé explicitly (volet manquant, accès difficile, encombrement, etc.) si ça te semble utile de le signaler.
- Sois honnête sur l'incertitude : tu identifies visuellement, tu ne mesures rien. Dis "probablement" plutôt que d'affirmer quand ce n'est pas clair.

Quand la personne te fait un retour terrain qui contredit ou affine ce que tu sais (ex: "la lavande tient mieux la sécheresse que ce que tu penses", "cette plante ne va pas bien à cet endroit", "on arrose trop/pas assez"), mets à jour les données correspondantes ET explique brièvement pourquoi dans "reply". Si le problème semble structurel (mauvais emplacement, exposition inadaptée, objet à remplacer comme une pergola abîmée), propose un projet via "suggest_project" plutôt que juste une tâche ponctuelle.

Quand la personne te décrit plusieurs plantes ou objets à la suite (ex: elle énumère tout ce qu'il y a sur sa terrasse), crée-les TOUS d'un coup via plusieurs actions "create_item" dans la même réponse — pas besoin de confirmer un par un. Déduis pour chacun : la catégorie (Plante/Matériel), la sous-catégorie, la zone (si elle dit "tout ça c'est sur la terrasse", applique cette zone à tous), l'exposition (hérite de la zone si elle n'est pas précisée autrement), et la tolérance à la chaleur si tu peux l'estimer depuis l'espèce. Si la zone est réellement ambiguë pour un élément précis, demande une seule clarification groupée à la fin plutôt que de bloquer toute la création.

Réponds TOUJOURS en JSON strict, sans texte avant/après, sans balises markdown, avec ce format exact:
{
  "reply": "réponse conversationnelle en français, naturelle et concise, qui explique ton raisonnement si tu ajustes quelque chose",
  "actions": [
    { "type": "create_task", "title": "...", "category": "Ménage|Cuisine|Jardin|Déchetterie|Bricolage", "assignee": "camil|luc|clement|null", "alreadyDone": true|false },
    { "type": "complete_task", "taskId": "..." },
    { "type": "create_item", "name": "...", "category": "Plante|Matériel", "subCategory": "...", "zoneId": "...", "exposition": "Plein soleil|Mi-ombre|Ombre (si Plante)", "toleranceChaleur": "faible|moyenne|haute (si Plante)", "notes": "..." },
    { "type": "update_plant_health", "plantId": "...", "health": 0-100 },
    { "type": "update_plant_traits", "plantId": "...", "exposition": "Plein soleil|Mi-ombre|Ombre (optionnel)", "toleranceChaleur": "faible|moyenne|haute (optionnel)" },
    { "type": "update_status_bar", "plantId": "...", "barLabel": "nom exact de la barre existante", "value": 0-100 },
    { "type": "mark_plant_dead", "plantId": "..." },
    { "type": "adjust_recurring_interval", "recurringTaskId": "...", "newIntervalDays": nombre, "reason": "pourquoi tu ajustes" },
    { "type": "suggest_project", "name": "...", "justification": "raison factuelle basée sur ce que la personne vient de dire" },
    { "type": "log_observation", "zoneId": "...ou null si inconnu", "text": "constat factuel et concis", "severity": "info|attention|urgent" }
  ]
}

Règles importantes:
- Si la personne dit avoir déjà fait quelque chose (ex: "j'ai fait la salle de bain, sol et douche"), cherche une tâche active correspondante dans "tachesActives". Si tu la trouves clairement, utilise "complete_task" avec son id. Si elle n'existe pas, utilise "create_task" avec "alreadyDone": true et assignee "${currentUserId}" (par défaut, c'est cette personne qui a fait l'action, sauf si elle précise quelqu'un d'autre).
- Sur une photo, utilise "log_observation" pour tout enjeu ou constat qui mérite d'être gardé en mémoire (mur qui chauffe, volet manquant, étagère à ranger...), même si tu ne crées pas de tâche immédiatement. Utilise "attention" ou "urgent" seulement si ça justifie vraiment une action à prévoir — pas pour de simples remarques.
- Si la demande est ambiguë (plusieurs tâches possibles, catégorie pas claire, référence à une plante que tu ne peux pas identifier avec certitude), NE DEVINE PAS : renvoie un tableau "actions" vide et pose la question de clarification dans "reply".
- N'invente jamais de plantId, taskId, recurringTaskId ou zoneId qui n'existe pas dans l'état fourni — utilise zoneId: null si tu ne sais pas situer.`;
}

async function sendToJarvis(userText, images){
  images = images || [];
  jarvisBusy = true;
  const imageKeys = [];
  for (const img of images){ imageKeys.push(await storePhoto(img)); }
  state.chat.push({ role:'user', text:userText || `(${images.length} photo(s) envoyée(s))`, images: imageKeys });
  render();
  scrollChatToBottom();

  const content = [];
  images.forEach(imageBase64=>{
    const mediaType = imageBase64.substring(5, imageBase64.indexOf(';'));
    const data = imageBase64.split(',')[1];
    content.push({ type:'image', source:{ type:'base64', media_type: mediaType, data } });
  });
  content.push({ type:'text', text: userText || "Voici des photos, peux-tu me dire ce qu'il se passe ?" });
  try{
    const res = await fetch('/api/jarvis-chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        model:'claude-sonnet-4-6',
        max_tokens:1000,
        system: buildJarvisSystemPrompt(),
        messages:[{ role:'user', content }],
      })
    });
    const data = await res.json();
    const rawText = (data.content || []).map(b=>b.text||'').join('');
    const cleaned = rawText.replace(/```json|```/g,'').trim();
    let parsed;
    try{ parsed = JSON.parse(cleaned); }
    catch(e){ parsed = { reply: rawText || "Je n'ai pas pu traiter la réponse.", actions: [] }; }

    applyJarvisActions(parsed.actions || []);
    checkStatusBarTriggers(state);
    state.chat.push({ role:'assistant', text: parsed.reply || '...' });
    lastFailedMessage = null;
  }catch(err){
    state.chat.push({ role:'assistant', text: "Erreur de connexion à l'assistant.", isError:true });
    lastFailedMessage = { text: userText, images };
  }

  jarvisBusy = false;
  pendingImages = [];
  saveState();
  render();
  scrollChatToBottom();
}

function applyJarvisActions(actions){
  actions.forEach(a=>{
    if (a.type === 'create_task'){
      if (a.alreadyDone){
        state.completedLog.push({ person: a.assignee || currentUserId, date: todayISO(), detail: a.title || 'Tâche', category: a.category || 'Ménage', weight: 2 });
      } else {
        state.tasks.push({
          id: uid(), title: a.title || 'Nouvelle tâche', category: a.category || 'Ménage',
          weight: 2, assignee: a.assignee || currentUserId, dueDate: todayISO(), log:[]
        });
      }
    } else if (a.type === 'complete_task'){
      const idx = state.tasks.findIndex(t=>t.id===a.taskId);
      if (idx>-1){
        const t = state.tasks[idx];
        state.completedLog.push({ person: t.assignee || currentUserId, date: todayISO(), detail: t.title, category: t.category, weight: t.weight||2 });
        state.tasks.splice(idx,1);
      }
    } else if (a.type === 'update_plant_health'){
      const p = state.plants.find(x=>x.id===a.plantId);
      if (p) p.health = Math.max(0, Math.min(100, a.health));
    } else if (a.type === 'create_item'){
      const zoneOk = a.zoneId && state.zones.some(z=>z.id===a.zoneId);
      const category = state.itemCategories.includes(a.category) ? a.category : 'Plante';
      if (category === 'Plante'){
        state.plants.push({ id:uid(), name:a.name||'Plante', category, subCategory:a.subCategory||'', zoneId: zoneOk?a.zoneId:null, photo:null,
          health:80, exposition:a.exposition||'Plein soleil', toleranceChaleur:a.toleranceChaleur||'moyenne',
          dernierArrosage:todayISO(), tailleRecommandee:false, notes:a.notes||'', customFields:[], statusBars:[], actions:[] });
      } else {
        state.plants.push({ id:uid(), name:a.name||'Objet', category, subCategory:a.subCategory||'', zoneId: zoneOk?a.zoneId:null, photo:null,
          etat:'Bon état', quantite:1, notes:a.notes||'', customFields:[], statusBars:[], actions:[] });
      }
    } else if (a.type === 'update_plant_traits'){
      const p = state.plants.find(x=>x.id===a.plantId);
      if (p){
        if (a.exposition) p.exposition = a.exposition;
        if (a.toleranceChaleur) p.toleranceChaleur = a.toleranceChaleur;
      }
    } else if (a.type === 'update_status_bar'){
      const p = state.plants.find(x=>x.id===a.plantId);
      const b = p && p.statusBars.find(b=>b.label.toLowerCase()===String(a.barLabel||'').toLowerCase());
      if (b) b.value = Math.max(0, Math.min(100, a.value));
    } else if (a.type === 'mark_plant_dead'){
      const idx = state.plants.findIndex(x=>x.id===a.plantId);
      if (idx>-1){
        state.tasks.push({ id: uid(), title:`Nettoyer emplacement : ${state.plants[idx].name}`, category:'Jardin', weight:2, assignee: currentUserId, dueDate: todayISO(), log:[] });
        state.plants.splice(idx,1);
      }
    } else if (a.type === 'adjust_recurring_interval'){
      const rt = state.recurringTasks.find(r=>r.id===a.recurringTaskId);
      if (rt && a.newIntervalDays){ rt.intervalDays = Math.max(1, a.newIntervalDays); }
    } else if (a.type === 'suggest_project'){
      state.projects.push({ id: uid(), name: a.name || 'Projet suggéré par JARVIS', status:'suggested', justification: a.justification || '', chat:[], materials:[], createdDate: todayISO() });
    } else if (a.type === 'log_observation'){
      state.observations.push({ id: uid(), zoneId: a.zoneId || null, text: a.text || '', severity: a.severity || 'info', date: todayISO() });
    }
  });
}

async function detectRecurringTasks(){
  recurringDetectBusy = true; render();
  const history = state.completedLog.slice(-40).map(l=>({ titre:l.detail, categorie:l.category, date:l.date }));
  const existing = state.recurringTasks.map(r=>r.title);
  const prompt = `Voici l'historique récent des tâches ménagères effectuées dans la colocation de Mérignac: ${JSON.stringify(history)}.
Tâches déjà suivies comme récurrentes: ${JSON.stringify(existing)}.
Identifie des tâches qui reviennent avec un rythme régulier et qui ne sont PAS déjà suivies. Pour l'arrosage : privilégie une tâche groupée par zone (ex: "Arroser les pots en terre cuite") plutôt qu'une tâche par plante individuelle — les plantes d'une même zone se soignent ensemble. Réponds en JSON strict: {"suggestions":[{"title":"...", "category":"Ménage|Cuisine|Jardin|Déchetterie|Bricolage", "intervalDays": nombre, "reason":"pourquoi tu penses que c'est récurrent, en une phrase"}]}. Si rien de clair ne ressort, renvoie un tableau vide.`;
  try{
    const res = await fetch('/api/jarvis-chat', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:700, messages:[{ role:'user', content:prompt }] })
    });
    const data = await res.json();
    const cleaned = (data.content||[]).map(b=>b.text||'').join('').replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(cleaned);
    recurringSuggestions = parsed.suggestions || [];
  }catch(e){ recurringSuggestions = []; }
  recurringDetectBusy = false;
  render();
}

async function generateAuditQuestions(){
  auditBusy = true; render();
  const known = state.audit.questions.filter(q=>q.status==='answered').map(q=>({q:q.text, r:q.answer}));
  const prompt = `Voici l'état actuel de la maison de Mérignac (colocation Camil/Luc/Clément, T5 103m²) et les réponses déjà obtenues lors de l'audit initial: ${JSON.stringify({house:state.house, zones:state.zones.map(z=>z.name), reponsesDejaObtenues:known})}.
Propose 3 à 5 NOUVELLES questions d'audit pertinentes et importantes (pas déjà posées), pour compléter l'inventaire de la maison (équipements, historique, points de vigilance, zones, plantes/matériel). Reste sobre : uniquement des questions vraiment utiles, pas de remplissage. Réponds en JSON strict, sans texte autour, format: {"questions":[{"text":"...", "needsPhoto": true|false}]}`;
  try{
    const res = await fetch('/api/jarvis-chat', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:800, messages:[{ role:'user', content:prompt }] })
    });
    const data = await res.json();
    const rawText = (data.content||[]).map(b=>b.text||'').join('');
    const cleaned = rawText.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(cleaned);
    (parsed.questions||[]).forEach(q=>{
      state.audit.questions.push({ id: uid(), text:q.text, status:'pending', answer:null, needsPhoto: !!q.needsPhoto, photo:null });
    });
  }catch(e){
    state.audit.questions.push({ id: uid(), text:"(Erreur de génération — réessayez dans un instant)", status:'ignored', answer:null, needsPhoto:false, photo:null });
  }
  auditBusy = false;
  saveState(); render();
}

function scrollChatToBottom(){
  requestAnimationFrame(()=>{
    const el = document.getElementById('chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/* =========================================================================
   Petits utilitaires: modales de saisie
   ========================================================================= */

function openPrompt({title, fields, onSubmit}){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="panel rounded-lg p-5 w-full max-w-sm">
      <div class="font-hud text-lg font-700 mb-3">${title}</div>
      <div class="space-y-2" id="modal-fields">
        ${fields.map((f,i)=>{
          if (f.type==='select'){
            return `<div><label class="text-xs text-[var(--text-mid)]">${f.label}</label>
              <select data-field="${i}" class="w-full rounded px-2 py-1.5 text-sm mt-1">
                ${f.options.map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}
              </select></div>`;
          }
          return `<div><label class="text-xs text-[var(--text-mid)]">${f.label}</label>
            <input data-field="${i}" type="${f.type||'text'}" value="${f.value||''}" placeholder="${f.placeholder||''}" class="w-full rounded px-2 py-1.5 text-sm mt-1"></div>`;
        }).join('')}
      </div>
      <div class="flex gap-2 mt-4">
        <button id="modal-cancel" class="btn-ghost flex-1 rounded py-1.5 text-sm">Annuler</button>
        <button id="modal-ok" class="btn-primary flex-1 rounded py-1.5 text-sm">Valider</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#modal-cancel').onclick = ()=> modal.remove();
  modal.querySelector('#modal-ok').onclick = ()=>{
    const values = fields.map((f,i)=> modal.querySelector(`[data-field="${i}"]`).value);
    modal.remove();
    onSubmit(values);
  };
}

function fileToDataURL(file){
  return new Promise((resolve)=>{
    const reader = new FileReader();
    reader.onload = (e)=> resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

// Modale dédiée pour ajouter un élément au module Jardin & Matériel :
// les champs changent selon la catégorie choisie (Plante vs Matériel vs catégorie custom).
// Modale pour ajouter une barre d'état personnalisée (ex: "Usure" sur la pergola),
// avec choix de ce qui se passe automatiquement si elle descend trop bas.
function openStatusBarModal(itemId){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="panel rounded-lg p-5 w-full max-w-sm">
      <div class="font-hud text-lg font-700 mb-3">Nouvelle barre d'état</div>
      <div class="space-y-2">
        <div>
          <label class="text-xs text-[var(--text-mid)]">Nom</label>
          <input id="sb-label" type="text" class="w-full rounded px-2 py-1.5 text-sm mt-1" placeholder="ex: Usure, Propreté…">
        </div>
        <div>
          <label class="text-xs text-[var(--text-mid)]">Valeur initiale</label>
          <input id="sb-value" type="number" min="0" max="100" value="80" class="w-full rounded px-2 py-1.5 text-sm mt-1">
        </div>
        <div>
          <label class="text-xs text-[var(--text-mid)]">Si ça descend sous ${STATUS_BAR_THRESHOLD}/100…</label>
          <select id="sb-action" class="w-full rounded px-2 py-1.5 text-sm mt-1">
            <option value="none">Rien (juste informatif)</option>
            <option value="task">Créer une tâche</option>
            <option value="project">Proposer un projet</option>
          </select>
        </div>
        <div id="sb-task-fields">
          <label class="text-xs text-[var(--text-mid)]">Titre de la tâche</label>
          <input id="sb-title" type="text" class="w-full rounded px-2 py-1.5 text-sm mt-1" placeholder="ex: Arroser les pots">
          <label class="text-xs text-[var(--text-mid)] mt-2 block">Catégorie</label>
          <select id="sb-category" class="w-full rounded px-2 py-1.5 text-sm mt-1">
            ${['Ménage','Cuisine','Jardin','Déchetterie','Bricolage'].map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div id="sb-project-fields" style="display:none">
          <label class="text-xs text-[var(--text-mid)]">Nom du projet</label>
          <input id="sb-project-title" type="text" class="w-full rounded px-2 py-1.5 text-sm mt-1" placeholder="ex: Réparer/changer la pergola">
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button id="sb-cancel" class="btn-ghost flex-1 rounded py-1.5 text-sm">Annuler</button>
        <button id="sb-ok" class="btn-primary flex-1 rounded py-1.5 text-sm">Ajouter</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const actionSelect = modal.querySelector('#sb-action');
  const taskFields = modal.querySelector('#sb-task-fields');
  const projectFields = modal.querySelector('#sb-project-fields');
  const sync = ()=>{
    taskFields.style.display = actionSelect.value==='task' ? '' : 'none';
    projectFields.style.display = actionSelect.value==='project' ? '' : 'none';
  };
  sync();
  actionSelect.addEventListener('change', sync);
  modal.querySelector('#sb-cancel').onclick = ()=> modal.remove();
  modal.querySelector('#sb-ok').onclick = ()=>{
    const label = modal.querySelector('#sb-label').value.trim();
    if (!label){ modal.remove(); return; }
    const value = parseInt(modal.querySelector('#sb-value').value)||80;
    const lowAction = actionSelect.value;
    const taskTitle = lowAction==='task' ? modal.querySelector('#sb-title').value.trim() : lowAction==='project' ? modal.querySelector('#sb-project-title').value.trim() : '';
    const taskCategory = modal.querySelector('#sb-category').value;
    modal.remove();
    mutate(s=>{
      const p = s.plants.find(p=>p.id===itemId);
      if (p) p.statusBars.push({ id:uid(), label, value, lowAction, taskTitle, taskCategory, triggered:false });
    });
  };
}

function openItemModal(defaultZoneId){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="panel rounded-lg p-5 w-full max-w-sm">
      <div class="font-hud text-lg font-700 mb-3">Nouvel élément</div>
      <div class="space-y-2">
        <div>
          <label class="text-xs text-[var(--text-mid)]">Catégorie</label>
          <select id="im-category" class="w-full rounded px-2 py-1.5 text-sm mt-1">
            ${state.itemCategories.map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-[var(--text-mid)]">Nom</label>
          <input id="im-name" type="text" class="w-full rounded px-2 py-1.5 text-sm mt-1" placeholder="ex: Rosiers, Tondeuse…">
        </div>
        <div>
          <label class="text-xs text-[var(--text-mid)]">Sous-catégorie / type (optionnel)</label>
          <input id="im-sub" type="text" class="w-full rounded px-2 py-1.5 text-sm mt-1" placeholder="ex: Rosier, Outillage…">
        </div>
        <div>
          <label class="text-xs text-[var(--text-mid)]">Emplacement</label>
          <select id="im-zone" class="w-full rounded px-2 py-1.5 text-sm mt-1">
            ${buildZoneTreeOptions().map(o=>`<option value="${o.value}" ${o.value===defaultZoneId?'selected':''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div id="im-plant-fields">
          <label class="text-xs text-[var(--text-mid)]">Exposition</label>
          <select id="im-exposition" class="w-full rounded px-2 py-1.5 text-sm mt-1">
            <option>Plein soleil</option><option>Mi-ombre</option><option>Ombre</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button id="im-cancel" class="btn-ghost flex-1 rounded py-1.5 text-sm">Annuler</button>
        <button id="im-ok" class="btn-primary flex-1 rounded py-1.5 text-sm">Ajouter</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const catSelect = modal.querySelector('#im-category');
  const plantFields = modal.querySelector('#im-plant-fields');
  const zoneSelect = modal.querySelector('#im-zone');
  const expositionSelect = modal.querySelector('#im-exposition');
  const syncFields = ()=>{ plantFields.style.display = catSelect.value === 'Plante' ? '' : 'none'; };
  syncFields();
  catSelect.addEventListener('change', syncFields);

  // Hérite l'exposition de la zone choisie (ou de son parent le plus proche qui en a une)
  const inheritExposition = ()=>{
    let z = state.zones.find(z=>z.id===zoneSelect.value);
    while(z && !z.exposition && z.parentZoneId){ z = state.zones.find(x=>x.id===z.parentZoneId); }
    if (z && z.exposition){
      const match = [...expositionSelect.options].find(o=>o.value.toLowerCase()===z.exposition.toLowerCase() || z.exposition.toLowerCase().includes(o.value.toLowerCase()));
      if (match) expositionSelect.value = match.value;
    }
  };
  zoneSelect.addEventListener('change', inheritExposition);
  inheritExposition();

  modal.querySelector('#im-cancel').onclick = ()=> modal.remove();
  modal.querySelector('#im-ok').onclick = ()=>{
    const name = modal.querySelector('#im-name').value.trim();
    if (!name){ modal.remove(); return; }
    const category = catSelect.value;
    const sub = modal.querySelector('#im-sub').value.trim();
    const zoneId = zoneSelect.value;
    modal.remove();
    mutate(s=>{
      if (category === 'Plante'){
        const exposition = expositionSelect?.value || 'Plein soleil';
        s.plants.push({ id:uid(), name, category, subCategory:sub, zoneId, photo:null,
          health:80, exposition, toleranceChaleur:'moyenne', dernierArrosage:todayISO(), tailleRecommandee:false, notes:'', customFields:[], statusBars:[], actions:[] });
      } else {
        s.plants.push({ id:uid(), name, category, subCategory:sub, zoneId, photo:null,
          etat:'Bon état', quantite:1, notes:'', customFields:[], statusBars:[], actions:[] });
      }
    });
  };
}

function resizeImage(file, maxDim=600){
  return new Promise((resolve)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = img.width*scale; canvas.height = img.height*scale;
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================================
   Handlers
   ========================================================================= */

function attachHandlers(){
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{ currentModule = el.dataset.nav; render(); });
  });

  const click = (sel, fn) => document.querySelectorAll(sel).forEach(el=> el.addEventListener('click', fn));
  const change = (sel, fn) => document.querySelectorAll(sel).forEach(el=> el.addEventListener('change', fn));

  // Dashboard
  click('[data-action="scroll-alerts"]', ()=>{
    const el = document.getElementById('alerts-section');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  change('[data-action="select-current-user"]', (e)=>{ currentUserId = e.currentTarget.value; render(); });

  // Jardin & Matériel — catégories
  click('[data-action="toggle-category"]', (e)=>{
    const cat = e.currentTarget.dataset.cat;
    collapsedCategories[cat] = !collapsedCategories[cat];
    render();
  });
  click('[data-action="add-category"]', ()=> openPrompt({
    title:'Nouvelle catégorie',
    fields:[{label:'Nom de la catégorie', value:'', placeholder:'ex: Outils, Électroménager…'}],
    onSubmit:([name])=>{
      if(!name || state.itemCategories.includes(name)) return;
      mutate(s=> s.itemCategories.push(name));
    }
  }));
  click('[data-action="add-item"]', (e)=> openItemModal(e.currentTarget.dataset.zone || currentFolderId));
  click('[data-action="edit-plant-traits"]', (e)=>{
  const p = state.plants.find(p=>p.id===e.currentTarget.dataset.id);
  if (!p) return;
  openPrompt({
    title:`Modifier "${p.name}"`,
    fields:[
      {label:'Zone', type:'select', options: buildZoneTreeOptions()},
      {label:'Exposition', type:'select', options:[{value:'Plein soleil',label:'Plein soleil'},{value:'Mi-ombre',label:'Mi-ombre'},{value:'Ombre',label:'Ombre'}]},
            {label:'Tolérance à la chaleur', type:'select', options:[{value:'faible',label:'Faible'},{value:'moyenne',label:'Moyenne'},{value:'haute',label:'Haute'}]},
    ],
    onSubmit:([zoneId,exposition,toleranceChaleur])=> mutate(s=>{
        const pp = s.plants.find(pp=>pp.id===p.id);
        if (pp){ pp.zoneId = zoneId; pp.exposition = exposition; pp.toleranceChaleur = toleranceChaleur; }
      })
  });
});
  click('[data-action="edit-item-traits"]', (e)=>{
  const p = state.plants.find(p=>p.id===e.currentTarget.dataset.id);
  if (!p) return;
  openPrompt({
    title:`Modifier "${p.name}"`,
    fields:[
      {label:'Zone', type:'select', options: buildZoneTreeOptions()},
      {label:'État', value:p.etat||''},
      {label:'Quantité', type:'number', value:String(p.quantite||1)},
      {label:'Notes', value:p.notes||''},
    ],
    onSubmit:([zoneId,etat,quantite,notes])=> mutate(s=>{
        const pp = s.plants.find(pp=>pp.id===p.id);
        if (pp){ pp.zoneId = zoneId; pp.etat = etat; pp.quantite = parseInt(quantite)||1; pp.notes = notes; }
      })
  });
});
  click('[data-action="edit-custom-field"]', (e)=>{
    const p = state.plants.find(p=>p.id===e.currentTarget.dataset.item);
    const f = p && p.customFields.find(f=>f.id===e.currentTarget.dataset.field);
    if (!f) return;
    openPrompt({
      title:'Modifier l\'info',
      fields:[{label:'Nom du champ', value:f.label}, {label:'Valeur', value:f.value}],
      onSubmit:([label,value])=> mutate(s=>{
        const pp = s.plants.find(pp=>pp.id===p.id);
        const ff = pp && pp.customFields.find(ff=>ff.id===f.id);
        if (ff){ ff.label = label; ff.value = value; }
      })
    });
  });
  click('[data-action="add-status-bar"]', (e)=> openStatusBarModal(e.currentTarget.dataset.item));
  document.querySelectorAll('[data-action="set-status-bar"]').forEach(el=>{
    el.addEventListener('input', (e)=>{
      const p = state.plants.find(p=>p.id===e.target.dataset.item);
      const b = p && p.statusBars.find(b=>b.id===e.target.dataset.bar);
      if (b) b.value = parseInt(e.target.value);
      saveState();
    });
    el.addEventListener('change', ()=> mutate(()=>{}));
  });
  click('[data-action="delete-status-bar"]', (e)=> mutate(s=>{
    const p = s.plants.find(p=>p.id===e.currentTarget.dataset.item);
    if (p) p.statusBars = p.statusBars.filter(b=>b.id!==e.currentTarget.dataset.bar);
  }));
  click('[data-action="add-custom-field"]', (e)=> openPrompt({
    title:'Nouvelle info',
    fields:[{label:'Nom du champ', value:'', placeholder:'ex: Nombre de pieds, État de taille…'}, {label:'Valeur', value:''}],
    onSubmit:([label,value])=>{
      if(!label) return;
      mutate(s=>{ const p = s.plants.find(p=>p.id===e.currentTarget.dataset.item); if(p) p.customFields.push({ id:uid(), label, value }); });
    }
  }));
  click('[data-action="delete-custom-field"]', (e)=> mutate(s=>{
    const p = s.plants.find(p=>p.id===e.currentTarget.dataset.item);
    if (p) p.customFields = p.customFields.filter(f=>f.id!==e.currentTarget.dataset.field);
  }));
  click('[data-action="delete-plant"]', (e)=> mutate(s=> s.plants = s.plants.filter(p=>p.id!==e.currentTarget.dataset.id)));
  click('[data-action="remove-plant-photo"]', async (e)=>{
  const id = e.currentTarget.dataset.id;
  const p = state.plants.find(p=>p.id===id);
  if (!p || !p.photo) return;
  const oldPhoto = p.photo;
  await deletePhoto(oldPhoto);
  mutate(s=>{ const pp = s.plants.find(pp=>pp.id===id); if (pp) pp.photo = null; });
});
  click('[data-action="water-plant"]', (e)=> mutate(s=>{
    const p = s.plants.find(p=>p.id===e.currentTarget.dataset.id);
    if(p){ p.dernierArrosage = todayISO(); p.health = Math.min(100, p.health+8); }
  }));
  click('[data-action="prune-plant"]', (e)=> mutate(s=>{
    const p = s.plants.find(p=>p.id===e.currentTarget.dataset.id);
    if(p){ p.tailleRecommandee = false; p.actions.push({ id:uid(), type:'Taille', date: todayISO(), done:true }); }
  }));
  document.querySelectorAll('[data-action="set-health"]').forEach(el=>{
    el.addEventListener('input', (e)=>{
      const p = state.plants.find(p=>p.id===e.target.dataset.id);
      if(p) p.health = parseInt(e.target.value);
      saveState();
    });
    el.addEventListener('change', ()=> render());
  });
  click('[data-action="toggle-plant-action"]', (e)=> mutate(s=>{
    const p = s.plants.find(p=>p.id===e.currentTarget.dataset.plant);
    const a = p && p.actions.find(a=>a.id===e.currentTarget.dataset.actionId);
    if(a) a.done = !a.done;
  }));
  document.querySelectorAll('[data-action="plant-photo"]').forEach(el=>{
    el.addEventListener('change', async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const dataUrl = await resizeImage(file);
      const key = await storePhoto(dataUrl);
      mutate(s=>{ const p = s.plants.find(p=>p.id===e.target.dataset.id); if(p) p.photo = key; });
    });
  });

  // Maison — navigation dossier + zones
  click('[data-action="open-folder"]', (e)=>{ currentFolderId = e.currentTarget.dataset.id || null; render(); });
  click('[data-action="add-zone"]', ()=> openPrompt({
    title:'Nouvelle zone',
    fields:[
      {label:'Nom', value:'', placeholder:'ex: Terrasse, Pots en terre cuite…'},
      {label:'Zone parente (optionnel)', type:'select', options:[{value:'',label:'Aucune (zone racine)'}, ...buildZoneTreeOptions()]},
      {label:'Étage / zone', type:'select', options:[{value:'RDC',label:'RDC'},{value:'Étage',label:'Étage'},{value:'Extérieur',label:'Extérieur'}]},
      {label:'Type', type:'select', options:[{value:'pièce',label:'Pièce'},{value:'jardin',label:'Jardin / extérieur'}]},
      {label:'Exposition (optionnel)', value:'', placeholder:'ex: Plein sud, mi-ombre…'},
      {label:'Enjeux (optionnel)', value:'', placeholder:'ex: chauffe beaucoup, devant fenêtre salon…'},
    ],
    onSubmit:([name,parentZoneId,floor,type,exposition,enjeux])=>{
      if(!name) return;
      const effectiveParent = parentZoneId || currentFolderId || '';
      mutate(s=>{
        const parent = effectiveParent ? s.zones.find(z=>z.id===effectiveParent) : null;
        const z = { id:uid(), name, parentZoneId: effectiveParent||null, floor: parent?parent.floor:floor, type, exposition, enjeux, photo:null, tidiness:80 };
        s.zones.push(z); currentFolderId = z.id;
      });
    }
  }));
  click('[data-action="remove-zone-photo"]', async (e)=>{
  const id = e.currentTarget.dataset.id;
  const z = state.zones.find(z=>z.id===id);
  if (!z || !z.photo) return;
  const oldPhoto = z.photo;
  await deletePhoto(oldPhoto);
  mutate(s=>{ const zz = s.zones.find(zz=>zz.id===id); if (zz) zz.photo = null; });
});
  click('[data-action="edit-zone-meta"]', (e)=>{
    const z = state.zones.find(z=>z.id===e.currentTarget.dataset.id);
    if (!z) return;
    openPrompt({
      title:`Modifier "${z.name}"`,
      fields:[
        {label:'Nom', value:z.name},
        {label:'Exposition', value:z.exposition||'', placeholder:'ex: Plein sud, mi-ombre…'},
        {label:'Enjeux', value:z.enjeux||'', placeholder:'ex: chauffe beaucoup, devant fenêtre salon…'},
      ],
      onSubmit:([name,exposition,enjeux])=> mutate(s=>{
        const zz = s.zones.find(zz=>zz.id===z.id);
        if (zz){ if(name) zz.name = name; zz.exposition = exposition; zz.enjeux = enjeux; }
      })
    });
  });
  document.querySelectorAll('[data-action="zone-photo"]').forEach(el=>{
    el.addEventListener('change', async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const dataUrl = await resizeImage(file, 800);
      const key = await storePhoto(dataUrl);
      mutate(s=>{ const z = s.zones.find(z=>z.id===e.target.dataset.id); if(z) z.photo = key; });
    });
  });
  document.querySelectorAll('[data-action="set-tidiness"]').forEach(el=>{
    el.addEventListener('input', (e)=>{
      const z = state.zones.find(z=>z.id===e.target.dataset.id);
      if (z) z.tidiness = parseInt(e.target.value);
      saveState();
    });
    el.addEventListener('change', ()=> render());
  });
  click('[data-action="delete-zone"]', (e)=> mutate(s=>{
    const id = e.currentTarget.dataset.id;
    const target = s.zones.find(z=>z.id===id);
    const parentId = target ? target.parentZoneId : null;
    // reparente les sous-zones au parent de la zone supprimée (ou racine) pour ne rien perdre
    s.zones.forEach(z=>{ if (z.parentZoneId===id) z.parentZoneId = parentId; });
    s.plants.forEach(p=>{ if (p.zoneId===id) p.zoneId = parentId; });
    s.zones = s.zones.filter(z=>z.id!==id);
    currentFolderId = parentId;
  }));
  click('[data-action="delete-observation"]', (e)=> mutate(s=> s.observations = s.observations.filter(o=>o.id!==e.currentTarget.dataset.id)));

  // Tasks
  click('[data-action="add-task"]', ()=> openPrompt({
    title:'Nouvelle tâche',
    fields:[
      {label:'Titre', value:''},
      {label:'Catégorie', type:'select', options:['Ménage','Cuisine','Jardin','Déchetterie','Bricolage'].map(c=>({value:c,label:c}))},
      {label:'Durée / difficulté', type:'select', options:[{value:'1',label:'Rapide'},{value:'2',label:'Moyenne'},{value:'3',label:'Longue'}]},
      {label:'Assigné à', type:'select', options: PEOPLE.map(p=>({value:p.id,label:p.name}))},
      {label:'Échéance', type:'date', value: todayISO()},
    ],
    onSubmit:([title,category,weight,assignee,dueDate])=>{
      if(!title) return;
      mutate(s=> s.tasks.push({ id:uid(), title, category, weight:parseInt(weight), assignee, dueDate, log:[] }));
    }
  }));
  // Tâche cochée = terminée : elle sort de la liste active et alimente l'historique d'équité
  click('[data-action="toggle-task"]', (e)=> mutate(s=>{
    const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
    if(!t) return;
    const everyone = [t.assignee, ...(t.additionalAssignees||[])].filter(Boolean);
    everyone.forEach(personId=>{
      s.completedLog.push({ person:personId, date:todayISO(), detail:t.title, category:t.category, weight:t.weight||2 });
    });
    s.tasks = s.tasks.filter(x=>x.id!==t.id);
  }));
  click('[data-action="toggle-assignee"]', (e)=> mutate(s=>{
    const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
    if (!t) return;
    const personId = e.currentTarget.dataset.person;
    const current = [t.assignee, ...(t.additionalAssignees||[])].filter(Boolean);
    if (current.includes(personId)){
      if (current.length<=1) return; // au moins une personne assignée
      if (t.assignee===personId){
        const rest = t.additionalAssignees||[];
        t.assignee = rest[0];
        t.additionalAssignees = rest.slice(1);
      } else {
        t.additionalAssignees = (t.additionalAssignees||[]).filter(id=>id!==personId);
      }
    } else {
      if (!t.assignee) t.assignee = personId;
      else t.additionalAssignees = [...(t.additionalAssignees||[]), personId];
    }
  }));
  click('[data-action="delete-task"]', (e)=> mutate(s=> s.tasks = s.tasks.filter(t=>t.id!==e.currentTarget.dataset.id)));
  change('[data-action="assign-task"]', (e)=> mutate(s=>{
    const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
    if(t) t.assignee = e.currentTarget.value;
  }));
  click('[data-action="reassign-fair"]', (e)=> mutate(s=>{
    const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
    if(t) t.assignee = pickFairAssignee(t.category, t.dueDate, t.assignee);
  }));
  click('[data-action="reschedule-task"]', (e)=> mutate(s=>{
    const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
    if(t){ const d = new Date(t.dueDate); d.setDate(d.getDate()+parseInt(e.currentTarget.dataset.days)); t.dueDate = d.toISOString().slice(0,10); }
  }));
  click('[data-action="not-done-task"]', (e)=> openPrompt({
    title:'Pas fait — reporter à',
    fields:[{label:'Décaler de combien de jours ?', type:'select', options:[{value:'1',label:'+1 jour'},{value:'2',label:'+2 jours'},{value:'3',label:'+3 jours'},{value:'7',label:'+1 semaine'}]}],
    onSubmit:([days])=> mutate(s=>{
      const t = s.tasks.find(t=>t.id===e.currentTarget.dataset.id);
      if(t){ const d = new Date(t.dueDate); d.setDate(d.getDate()+parseInt(days)); t.dueDate = d.toISOString().slice(0,10); }
    })
  }));
  click('[data-action="toggle-history"]', ()=>{ historyOpen = !historyOpen; render(); });
  click('[data-action="history-filter-person"]', (e)=>{ historyFilterPerson = e.currentTarget.dataset.value; render(); });
  click('[data-action="history-filter-cat"]', (e)=>{ historyFilterCat = e.currentTarget.dataset.value; render(); });

  // Tâches récurrentes
  click('[data-action="recurring-done"]', (e)=> mutate(s=>{
    const rt = s.recurringTasks.find(r=>r.id===e.currentTarget.dataset.id);
    if (rt){
      s.completedLog.push({ person: currentUserId, date: todayISO(), detail: rt.title, category: rt.category, weight: rt.weight||1 });
      rt.lastDone = todayISO();
      // Tâche d'arrosage groupée par zone : on arrose réellement toutes les plantes de la zone
      if (rt.adaptiveTag==='arrosage' && rt.zoneId){
        zoneItemsDeep(rt.zoneId).filter(p=>p.category==='Plante').forEach(p=>{
          p.dernierArrosage = todayISO(); p.health = Math.min(100, p.health+8);
        });
      }
    }
  }));
  click('[data-action="add-recurring"]', ()=> openPrompt({
    title:'Nouvelle tâche récurrente',
    fields:[
      {label:'Titre', value:'', placeholder:'ex: Arroser les pots en terre cuite'},
      {label:'Catégorie', type:'select', options:['Ménage','Cuisine','Jardin','Déchetterie','Bricolage'].map(c=>({value:c,label:c}))},
      {label:'Zone (optionnel — groupe tous les éléments de la zone)', type:'select', options:[{value:'',label:'Aucune / non lié à une zone'}, ...buildZoneTreeOptions()]},
      {label:'Intervalle (jours)', type:'number', value:'7'},
      {label:'Adaptatif météo', type:'select', options:[{value:'',label:'Non'},{value:'arrosage',label:'Oui — arrosage (raccourci si sécheresse)'},{value:'poubelles',label:'Oui — poubelles (raccourci si forte chaleur)'}]},
    ],
    onSubmit:([title,category,zoneId,intervalDays,adaptiveTag])=>{
      if(!title) return;
      mutate(s=> s.recurringTasks.push({ id:uid(), title, category, weight:1, intervalDays: parseInt(intervalDays)||7, zoneId: zoneId||null, lastDone: todayISO(), adaptiveTag: adaptiveTag||null }));
    }
  }));
  click('[data-action="delete-recurring"]', (e)=> mutate(s=> s.recurringTasks = s.recurringTasks.filter(r=>r.id!==e.currentTarget.dataset.id)));
  click('[data-action="detect-recurring"]', ()=>{ if(!recurringDetectBusy) detectRecurringTasks(); });
  click('[data-action="accept-recurring-suggestion"]', (e)=>{
    const idx = parseInt(e.currentTarget.dataset.index);
    const sug = recurringSuggestions[idx];
    if (sug) mutate(s=> s.recurringTasks.push({ id:uid(), title:sug.title, category:sug.category||'Ménage', weight:1, intervalDays:sug.intervalDays||7, zoneId:null, lastDone: todayISO(), adaptiveTag:null }));
    recurringSuggestions = recurringSuggestions.filter((_,i)=>i!==idx);
    render();
  });
  click('[data-action="reject-recurring-suggestion"]', (e)=>{
    const idx = parseInt(e.currentTarget.dataset.index);
    recurringSuggestions = recurringSuggestions.filter((_,i)=>i!==idx);
    render();
  });

  // Polls
  click('[data-action="add-poll"]', ()=> openPrompt({
    title:'Nouveau sondage',
    fields:[
      {label:'Question', value:''},
      {label:'Personnes requises', type:'select', options:[{value:'1',label:'1 (proposée à la personne la plus équitable en premier)'},{value:'2',label:'2'},{value:'3',label:'3 (toute la coloc)'}]},
      {label:'Échéance', type:'date', value: todayISO()},
    ],
    onSubmit:([question,requiredPeople,deadline])=>{
      if(!question) return;
      mutate(s=> s.polls.push({ id:uid(), question, deadline, requiredPeople: parseInt(requiredPeople)||1, resolved:false, resolvedAssignees:null, votes:Object.fromEntries(PEOPLE.map(p=>[p.id,null])) }));
    }
  }));
  click('[data-action="poll-vote"]', (e)=> mutate(s=>{
    const poll = s.polls.find(p=>p.id===e.currentTarget.dataset.poll);
    if(!poll) return;
    poll.votes[e.currentTarget.dataset.person] = e.currentTarget.dataset.vote === 'true';
    // Auto-résolution : dès que le nombre requis de "oui" est atteint, on attribue
    // en priorité aux personnes les moins chargées (équité) parmi celles qui ont dit oui.
    const required = poll.requiredPeople || 1;
    const yesIds = PEOPLE.filter(p=>poll.votes[p.id]===true).map(p=>p.id);
    if (!poll.resolvedAssignees && yesIds.length >= required){
      const weightSum = Object.fromEntries(PEOPLE.map(p=>[p.id,0]));
      s.completedLog.forEach(l=> weightSum[l.person] = (weightSum[l.person]||0) + (l.weight||1));
      const sorted = [...yesIds].sort((a,b)=> weightSum[a]-weightSum[b]);
      poll.resolvedAssignees = sorted.slice(0, required);
    }
  }));
  click('[data-action="poll-reschedule"]', (e)=> mutate(s=>{
    const poll = s.polls.find(p=>p.id===e.currentTarget.dataset.poll);
    if(poll){
      const d = new Date(poll.deadline); d.setDate(d.getDate()+parseInt(e.currentTarget.dataset.days));
      poll.deadline = d.toISOString().slice(0,10);
      poll.votes = Object.fromEntries(PEOPLE.map(p=>[p.id,null]));
    }
  }));
  click('[data-action="poll-reschedule-custom"]', (e)=> openPrompt({
    title:'Reporter le sondage',
    fields:[{label:'Nouvelle échéance', type:'date', value: todayISO()}],
    onSubmit:([deadline])=> mutate(s=>{
      const poll = s.polls.find(p=>p.id===e.currentTarget.dataset.poll);
      if(poll){ poll.deadline = deadline; poll.votes = Object.fromEntries(PEOPLE.map(p=>[p.id,null])); }
    })
  }));

  // Calendar
  click('[data-action="cal-view"]', (e)=>{ calendarViewMode = e.currentTarget.dataset.mode; render(); });
click('[data-action="cal-week-nav"]', (e)=>{
  const dir = parseInt(e.currentTarget.dataset.dir);
  calendarWeekOffset = dir===0 ? 0 : calendarWeekOffset+dir;
  render();
});
click('[data-action="cal-pick-day"]', (e)=>{
  const picked = new Date(e.currentTarget.dataset.date);
  const today = new Date(); today.setHours(0,0,0,0);
  const diffWeeks = Math.round((startOfWeek(picked) - startOfWeek(today)) / (7*86400000));
  calendarWeekOffset = diffWeeks;
  calendarViewMode = 'semaine';
  render();
});
  click('[data-action="filter-cal"]', (e)=> { calendarFilter = e.currentTarget.dataset.cat; render(); });
  click('[data-action="sync-google"]', ()=> syncGoogleCalendar());
click('[data-action="disconnect-google"]', ()=> disconnectGoogle());
click('[data-action="toggle-setting"]', (e)=> mutate(s=>{
  const key = e.currentTarget.dataset.key;
  s.pushSettings[key] = !s.pushSettings[key];
}));  
  click('[data-action="export-data"]', ()=>{
    try{
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-sauvegarde-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }catch(e){
      alert("Erreur lors de l'export.");
    }
  });
  click('[data-action="import-data"]', ()=>{
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try{
        const imported = hydrateState(JSON.parse(text));
        state = imported;
        flushSave();
        render();
        alert("Import réussi !");
      }catch(err){
        alert("Le fichier n'est pas valide.");
      }
    };
    input.click();
  });
click('[data-action="add-event"]', ()=> openPrompt({
    title:'Nouvel événement',
    fields:[
      {label:'Titre', value:''},
      {label:'Catégorie', type:'select', options:['Jardin','Ménage','Cuisine','Déchetterie','Bricolage'].map(c=>({value:c,label:c}))},
      {label:'Date', type:'date', value: todayISO()},
      {label:'Personne (optionnel)', type:'select', options:[{value:'',label:'—'}, ...PEOPLE.map(p=>({value:p.id,label:p.name}))]},
    ],
    onSubmit:([title,category,start,person])=>{
      if(!title) return;
      mutate(s=> s.events.push({ id:uid(), title, category, start, person: person||null }));
    }
  }));
  click('[data-action="delete-event"]', (e)=> mutate(s=> s.events = s.events.filter(ev=>ev.id!==e.currentTarget.dataset.id)));
  click('[data-action="add-unavailability"]', ()=> openPrompt({
    title:'Nouvelle indisponibilité',
    fields:[
      {label:'Personne', type:'select', options: PEOPLE.map(p=>({value:p.id,label:p.name}))},
      {label:'Libellé', value:'Indisponible', placeholder:'ex: vacances, garde du soir 19h30-22h'},
      {label:'Début', type:'date', value: todayISO()},
      {label:'Fin', type:'date', value: todayISO()},
    ],
    onSubmit:([person,label,start,end])=> mutate(s=> s.unavailabilities.push({ id:uid(), person, label, start, end }))
  }));
  click('[data-action="delete-unavail"]', (e)=> mutate(s=> s.unavailabilities = s.unavailabilities.filter(u=>u.id!==e.currentTarget.dataset.id)));

  // Documents
  click('[data-action="add-doc"]', ()=> openPrompt({
    title:'Nouveau document',
    fields:[
      {label:'Nom', value:''},
      {label:'Catégorie', type:'select', options:['Bail','Assurance','Diagnostic','Facture','Autre'].map(c=>({value:c,label:c}))},
      {label:'Note (optionnel)', value:''},
    ],
    onSubmit:([name,category,note])=>{
      if(!name) return;
      mutate(s=> s.documents.push({ id:uid(), name, category, note, date: todayISO(), file:null, fileType:null }));
    }
  }));
  click('[data-action="delete-doc"]', (e)=> mutate(s=> s.documents = s.documents.filter(d=>d.id!==e.currentTarget.dataset.id)));
  document.querySelectorAll('[data-action="doc-file"]').forEach(el=>{
    el.addEventListener('change', async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      if (file.size > 4*1024*1024){ alert("Fichier trop volumineux (max ~4 Mo par fichier dans ce prototype)."); return; }
      const isImage = file.type.startsWith('image/');
      const dataUrl = isImage ? await resizeImage(file, 1600) : await fileToDataURL(file);
      const key = await storePhoto(dataUrl);
      mutate(s=>{ const d = s.documents.find(d=>d.id===e.target.dataset.id); if(d){ d.file = key; d.fileType = file.type; } });
    });
  });
  click('[data-action="view-doc"]', (e)=>{
    const d = state.documents.find(d=>d.id===e.currentTarget.dataset.id);
    const src = d ? photoSrc(d.file) : null;
    if (src){
      const w = window.open();
      if (d.fileType && d.fileType.startsWith('image/')) w.document.write(`<img src="${src}" style="max-width:100%">`);
      else w.location.href = src;
    }
  });

  // JARVIS avatar
  const avatarInput = document.querySelector('[data-action="jarvis-avatar-upload"]');
  if (avatarInput) avatarInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const dataUrl = await resizeImage(file, 300);
    const key = await storePhoto(dataUrl);
    mutate(s=> s.jarvisPhotos.push(key));
  });

  // Jarvis tabs
  click('[data-action="jarvis-tab"]', (e)=>{ jarvisTab = e.currentTarget.dataset.tab; render(); });

  // Jarvis chat
  const imgInput = document.querySelector('[data-action="jarvis-image"]');
  if (imgInput) imgInput.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const file of files){
      const resized = await resizeImage(file, 800);
      pendingImages.push(resized);
    }
    render();
  });
  click('[data-action="clear-image"]', (e)=> { pendingImages.splice(parseInt(e.currentTarget.dataset.index), 1); render(); });
  click('[data-action="retry-jarvis"]', ()=> { if (lastFailedMessage) sendToJarvis(lastFailedMessage.text, lastFailedMessage.images); });
  click('[data-action="clear-chat"]', async ()=>{
    for (const m of state.chat){ for (const key of (m.images||[])){ await deletePhoto(key); } }
    mutate(s=>{ s.chat = [{ role:'assistant', text:"Bonjour. JARVIS en ligne. Je surveille la maison de Mérignac — jardins, tâches, entretien. Dites-moi ce qu'il se passe, ou envoyez-moi une photo." }]; });
  });
  const sendBtn = document.querySelector('[data-action="jarvis-send"]');
  const input = document.getElementById('jarvis-input');
  const doSend = ()=>{
    const text = input.value.trim();
    if (!text && !pendingImages.length) return;
    input.value = '';
    const imgs = [...pendingImages];
    sendToJarvis(text, imgs);
  };
  if (sendBtn) sendBtn.addEventListener('click', doSend);
  if (input) input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSend(); });
  scrollChatToBottom();

  // Projets
  click('[data-action="suggest-projects"]', ()=>{ if(!projectsBusy) suggestProjects(); });
  click('[data-action="start-project"]', (e)=> mutate(s=>{
    const p = s.projects.find(p=>p.id===e.currentTarget.dataset.id);
    if (p) p.status = 'active';
  }));
  click('[data-action="ignore-project"]', (e)=> mutate(s=> s.projects = s.projects.filter(p=>p.id!==e.currentTarget.dataset.id)));
  click('[data-action="add-project"]', ()=> openPrompt({
    title:'Nouveau projet',
    fields:[{label:'Nom du projet', value:''}],
    onSubmit:([name])=>{
      if(!name) return;
      mutate(s=>{
        const p = { id:uid(), name, status:'active', justification:null, chat:[], materials:[], createdDate:todayISO() };
        s.projects.push(p);
        selectedProjectId = p.id;
      });
    }
  }));
  click('[data-action="open-project"]', (e)=>{ selectedProjectId = e.currentTarget.dataset.id; render(); });
  click('[data-action="close-project"]', ()=>{ selectedProjectId = null; render(); });
  click('[data-action="rename-project"]', (e)=> openPrompt({
    title:'Renommer le projet',
    fields:[{label:'Nouveau nom', value: state.projects.find(p=>p.id===e.currentTarget.dataset.id)?.name || ''}],
    onSubmit:([name])=>{
      if(!name) return;
      mutate(s=>{ const p = s.projects.find(p=>p.id===e.currentTarget.dataset.id); if(p) p.name = name; });
    }
  }));
  click('[data-action="delete-project"]', (e)=> mutate(s=>{
    s.projects = s.projects.filter(p=>p.id!==e.currentTarget.dataset.id);
    selectedProjectId = null;
  }));
  click('[data-action="project-send"]', (e)=>{
    const input = document.getElementById('project-input');
    const text = input.value.trim();
    if (!text || projectChatBusy) return;
    input.value = '';
    sendProjectMessage(e.currentTarget.dataset.id, text);
  });
  const projInput = document.getElementById('project-input');
  if (projInput) projInput.addEventListener('keydown', (e)=>{
    if (e.key==='Enter'){
      const btn = document.querySelector('[data-action="project-send"]');
      if (btn) btn.click();
    }
  });
  click('[data-action="toggle-material"]', (e)=> mutate(s=>{
    const p = s.projects.find(p=>p.id===e.currentTarget.dataset.project);
    const m = p && p.materials.find(m=>m.id===e.currentTarget.dataset.mat);
    if (m) m.bought = !m.bought;
  }));
  click('[data-action="delete-material"]', (e)=> mutate(s=>{
    const p = s.projects.find(p=>p.id===e.currentTarget.dataset.project);
    if (p) p.materials = p.materials.filter(m=>m.id!==e.currentTarget.dataset.mat);
  }));
  click('[data-action="add-material"]', (e)=> openPrompt({
    title:'Nouvel article',
    fields:[{label:'Nom', value:''}],
    onSubmit:([name])=>{
      if(!name) return;
      mutate(s=>{ const p = s.projects.find(p=>p.id===e.currentTarget.dataset.project); if(p) p.materials.push({ id:uid(), name, bought:false }); });
    }
  }));

  // Audit
  click('[data-action="audit-generate"]', ()=>{ if(!auditBusy) generateAuditQuestions(); });
  document.querySelectorAll('[data-action="audit-photo"]').forEach(el=>{
    el.addEventListener('change', async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      pendingAuditPhoto[e.target.dataset.id] = await resizeImage(file, 700);
      render();
    });
  });
  click('[data-action="audit-answer"]', async (e)=>{
    const id = e.currentTarget.dataset.id;
    const input = document.querySelector(`[data-audit-answer="${id}"]`);
    const answer = input ? input.value.trim() : '';
    if (!answer && !pendingAuditPhoto[id]) return;
    const photoKey = pendingAuditPhoto[id] ? await storePhoto(pendingAuditPhoto[id]) : null;
    delete pendingAuditPhoto[id];
    mutate(s=>{
      const q = s.audit.questions.find(q=>q.id===id);
      if (q){ q.status = 'answered'; q.answer = answer || '(voir photo)'; q.photo = photoKey; }
    });
  });
  click('[data-action="audit-dontknow"]', (e)=> mutate(s=>{
    // reste "pending" mais repart en fin de file
    const id = e.currentTarget.dataset.id;
    const idx = s.audit.questions.findIndex(q=>q.id===id);
    if (idx>-1){ const [q] = s.audit.questions.splice(idx,1); s.audit.questions.push(q); }
  }));
  click('[data-action="audit-ignore"]', (e)=> mutate(s=>{
    const q = s.audit.questions.find(q=>q.id===e.currentTarget.dataset.id);
    if (q) q.status = 'ignored';
  }));
}

loadState().then(()=>{
  fetchWeather();
  syncGoogleCalendar();
});

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

  }, []);

  return <div id="app" className="flex min-h-screen"></div>;
}
