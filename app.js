/* ===================== EasySkill — Gestion de centre de formation ===================== */
const STORAGE_KEY = "easyskill_db_v1";
const APP = document.getElementById("app");
/* Logo officiel du Ministère (armoiries + intitulé + République du Bénin) : fixe, non modifiable par l'utilisateur */
const MINISTERE_LOGO = "ministere-logo.png";
const BULLETIN_DECISIONS = ["Félicitations", "Encouragements", "Tableau d'honneur", "Avertissement", "Blâme"];

function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s){ return (s===undefined||s===null?"":String(s)).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function formatFCFA(n){ return (Number(n)||0).toLocaleString("fr-FR",{maximumFractionDigits:0})+" FCFA"; }
function formatDate(d){ if(!d) return "-"; try{ return new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"});}catch(e){return d;} }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function monthKeyNow(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function monthLabel(key){ if(!key) return "-"; const [y,m]=key.split("-"); const names=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]; return names[parseInt(m,10)-1]+" "+y; }
function currentSchoolYear(){ const now=new Date(); const y=now.getFullYear(); return now.getMonth()>=7? y+"-"+(y+1) : (y-1)+"-"+y; }

function defaultDB(){
  const filieres = [
    {id:"fil_pharma", nom:"Auxiliaire de Pharmacie", matieres:[]},
    {id:"fil_delegue", nom:"Délégué Médical", matieres:[]},
    {id:"fil_info", nom:"Maintenance Informatique", matieres:[]},
    {id:"fil_secretariat", nom:"Secrétariat", matieres:[]},
    {id:"fil_hotel", nom:"Hôtellerie & Restauration", matieres:[]},
    {id:"fil_elec", nom:"Électricité Bâtiment", matieres:[]},
    {id:"fil_solaire", nom:"Installation et Maintenance des Systèmes Solaires Photovoltaïques", matieres:[]}
  ];
  const fraisTypes = [
    {id:"frais_inscription", nom:"Inscription", montant:10000, filiereId:null},
    {id:"frais_blouse", nom:"Blouse", montant:7000, filiereId:null},
    {id:"frais_tenue", nom:"Tenue scolaire", montant:10500, filiereId:null},
    {id:"frais_scolarite", nom:"Scolarité", montant:125000, filiereId:null},
    {id:"frais_tp_hotel", nom:"Frais de TP Hôtellerie-Restauration", montant:35000, filiereId:"fil_hotel"},
    {id:"frais_tenue_tp_hotel", nom:"Tenue TP Hôtellerie-Restauration", montant:15000, filiereId:"fil_hotel"},
    {id:"frais_diplome", nom:"Frais de remise de diplôme", montant:35000, filiereId:null}
  ];
  return {
    settings:{
      centerName:"CFAP Formation", centerSubtitle:"L'École des Métiers Professionnels",
      site:"Site de Natitingou", phone:"01 61 28 63 64", logo:"logo.png",
      directeur:"",
      anneeScolaire: currentSchoolYear(), pinAdmin:"1234", pinSecretariat:"0000",
      caisseFondInitial: 0, nextReceiptNo: 1
    },
    filieres, fraisTypes,
    students:[], payments:[], teachers:[], salaryPayments:[],
    expenses:[], revenues:[], caisseMovements:[]
  };
}

/* Les photos des élèves sont stockées séparément (une clé localStorage par élève) plutôt que
   dans le même bloc JSON que tout le reste. Avant, chaque enregistrement (paiement, note, etc.)
   ré-écrivait TOUTES les photos de TOUS les élèves à chaque fois, ce qui remplissait très vite
   le quota du navigateur et faisait échouer l'enregistrement dès qu'une photo était ajoutée. */
const PHOTO_PREFIX = "easyskill_photo_";
function savePhoto(studentId, dataUrl){
  try{
    if(dataUrl) localStorage.setItem(PHOTO_PREFIX+studentId, dataUrl);
    else localStorage.removeItem(PHOTO_PREFIX+studentId);
    cloudPushPhotoDebounced(studentId, dataUrl);
    return true;
  }catch(e){ console.error(e); return false; }
}
function loadPhoto(studentId){
  try{ return localStorage.getItem(PHOTO_PREFIX+studentId) || ""; }catch(e){ return ""; }
}
function deletePhoto(studentId){ try{ localStorage.removeItem(PHOTO_PREFIX+studentId); }catch(e){} }

/* Complète un objet de données brut (venant du localStorage OU du cloud) avec les valeurs par
   défaut manquantes, et applique les petites migrations nécessaires. Ne gère pas les photos
   (gérées séparément, voir plus bas). */
function normalizeDB(parsed){
  const merged = Object.assign(defaultDB(), parsed||{});
  merged.settings = Object.assign(defaultDB().settings, (parsed&&parsed.settings)||{});
  // migration : anciennes quittances qui n'avaient pas encore de numéro purement numérique
  merged.payments = merged.payments||[];
  if(merged.payments.some(p=>!p.receiptNo)){
    const ordered = merged.payments.slice().sort((a,b)=> String(a.date||"").localeCompare(String(b.date||"")) || String(a.id).localeCompare(String(b.id)));
    let n = Number(merged.settings.nextReceiptNo)||1;
    ordered.forEach(p=>{ if(!p.receiptNo){ p.receiptNo = String(n).padStart(5,"0"); n++; } });
    merged.settings.nextReceiptNo = n;
  }
  return merged;
}

let db = loadDB();
function loadDB(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      const merged = normalizeDB(parsed);
      merged.students = (merged.students||[]).map(s=>{
        const stored = loadPhoto(s.id);
        if(stored) s.photo = stored;
        else if(s.photo) savePhoto(s.id, s.photo); // migration : ancienne photo enregistrée dans le bloc principal
        return s;
      });
      return merged;
    }
  }catch(e){}
  return defaultDB();
}
/* Remplace les données locales (db) par des données reçues du cloud, en conservant les photos
   déjà présentes localement (les photos ne transitent pas par le document principal). */
function applyCloudData(data){
  const merged = normalizeDB(data);
  merged.students = (merged.students||[]).map(s=>{
    const stored = loadPhoto(s.id);
    if(stored) s.photo = stored;
    return s;
  });
  db = merged;
}
function saveLocalCacheOnly(){
  try{
    const serializable = Object.assign({}, db, {
      students: (db.students||[]).map(s=>{ const copy = Object.assign({}, s); delete copy.photo; return copy; })
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    return true;
  }catch(e){
    console.error(e);
    return false;
  }
}
function saveDB(){
  const ok = saveLocalCacheOnly();
  if(!ok){
    showToast("Échec de l'enregistrement (stockage plein). Réduisez la taille des photos ou libérez de l'espace.", "err");
    return false;
  }
  cloudPushDebounced();
  return true;
}

/* ---------- synchronisation en ligne (Admin ↔ Secrétariat, depuis n'importe quel PC) ---------- */
let cloudStatus = "idle"; // idle | disabled | syncing | online | offline | error
let cloudPushTimer = null;

function cloudPushDebounced(){
  if(!cloudIsEnabled()){ cloudStatus="disabled"; return; }
  cloudStatus = "syncing"; updateSyncBadgeDOM();
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(async ()=>{
    const payload = Object.assign({}, db, {
      students: (db.students||[]).map(s=>{ const copy=Object.assign({}, s); delete copy.photo; return copy; })
    });
    const ok = await cloudPushMain(payload);
    cloudStatus = ok ? "online" : (navigator.onLine ? "error" : "offline");
    updateSyncBadgeDOM();
  }, 500);
}
function cloudPushPhotoDebounced(studentId, dataUrl){
  if(!cloudIsEnabled()) return;
  cloudStatus = "syncing"; updateSyncBadgeDOM();
  cloudPushPhoto(studentId, dataUrl).then(ok=>{
    cloudStatus = ok ? "online" : (navigator.onLine ? "error" : "offline");
    updateSyncBadgeDOM();
  });
}
/* Récupère les dernières données du cloud (appelé à l'ouverture d'un espace et au clic sur
   "Actualiser"). Si le cloud est vide (toute première utilisation), envoie les données locales
   pour initialiser la base partagée. */
async function cloudPull(){
  if(!cloudIsEnabled()){ cloudStatus="disabled"; return false; }
  cloudStatus = "syncing"; render();
  const res = await cloudFetchMain();
  if(!res.success){
    cloudStatus = navigator.onLine ? "error" : "offline";
    render();
    return false;
  }
  if(res.data){
    applyCloudData(res.data);
    saveLocalCacheOnly();
  } else {
    // rien dans le cloud encore : on y envoie ce qu'on a localement
    await cloudPushMain(Object.assign({}, db, {
      students: (db.students||[]).map(s=>{ const copy=Object.assign({}, s); delete copy.photo; return copy; })
    }));
  }
  cloudStatus = "online";
  render();
  return true;
}
function syncStudentPhoto(studentId){
  if(!cloudIsEnabled() || loadPhoto(studentId)) return;
  ensurePhotoFromCloud(studentId).then(photo=>{
    if(photo && screen && (screen.id===studentId || screen.studentId===studentId)) render();
  });
}
async function ensurePhotoFromCloud(studentId){
  if(!cloudIsEnabled()) return "";
  const local = loadPhoto(studentId);
  if(local) return local;
  const photo = await cloudFetchPhoto(studentId);
  if(photo){
    try{ localStorage.setItem(PHOTO_PREFIX+studentId, photo); }catch(e){}
    const s = studentById(studentId); if(s) s.photo = photo;
  }
  return photo;
}
function syncBadgeInfo(){
  const map = {
    idle:    {icon:"⏳", label:"…",              cls:""},
    disabled:{icon:"💾", label:"Local uniquement", cls:""},
    syncing: {icon:"🔄", label:"Synchronisation…", cls:"sync-busy"},
    online:  {icon:"☁️", label:"Synchronisé",      cls:"sync-ok"},
    offline: {icon:"⚠️", label:"Hors-ligne",       cls:"sync-warn"},
    error:   {icon:"⚠️", label:"Échec de synchro",  cls:"sync-warn"}
  };
  return map[cloudStatus] || map.idle;
}
function syncBadgeHTML(){
  const info = syncBadgeInfo();
  return `<span class="sync-badge ${info.cls}" title="${esc(info.label)}">${info.icon} ${esc(info.label)}</span>`;
}
function updateSyncBadgeDOM(){
  const el = document.querySelector(".sync-badge");
  if(!el) return;
  const info = syncBadgeInfo();
  el.className = "sync-badge "+info.cls;
  el.title = info.label;
  el.textContent = info.icon+" "+info.label;
}

/* ---------- licence d'activation ---------- */
/* Le blocage par licence n'est actif que si la synchronisation en ligne (cloud-config.js) est
   configurée : sans elle, impossible de vérifier une licence auprès du serveur, donc l'app
   fonctionne librement comme avant. */
const LICENSE_CACHE_KEY = "easyskill_license_cache";
function loadLicenseCache(){
  try{ return JSON.parse(localStorage.getItem(LICENSE_CACHE_KEY)||"null"); }catch(e){ return null; }
}
function saveLicenseCacheData(data){
  try{ localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify(data)); }catch(e){}
}
let licenseCache = loadLicenseCache();
/* Si une licence a déjà été activée sur cet appareil, on utilise son code comme identifiant
   de "centre" pour toutes les requêtes cloud : cela permet à plusieurs clients (centres)
   d'utiliser le même site/Worker, chacun avec ses propres données, isolées par leur code. */
if(licenseCache && licenseCache.key && typeof cloudSetCenter==="function"){
  cloudSetCenter(licenseCache.key);
}
let licenseActivating = false;
let licenseError = null;

function licenseEnforced(){ return cloudIsEnabled(); }
function licenseIsValid(){
  if(!licenseEnforced()) return true;
  if(!licenseCache || licenseCache.status!=="active") return false;
  if(licenseCache.expiresAt===null) return true;
  return new Date(licenseCache.expiresAt).getTime() > Date.now();
}
function licenseDaysLeft(){
  if(!licenseCache || licenseCache.expiresAt===null) return null;
  const ms = new Date(licenseCache.expiresAt).getTime() - Date.now();
  return Math.ceil(ms/86400000);
}
/* Interroge le serveur pour connaître le statut réel de la licence, et met à jour le cache
   local (utilisé pour continuer à fonctionner brièvement hors-ligne). */
async function licenseVerify(silent){
  if(!licenseEnforced()) return;
  const res = await cloudLicenseStatus();
  if(res.success){
    const d = res.data;
    licenseCache = {
      key: (d && d.key) || (licenseCache&&licenseCache.key) || "",
      expiresAt: d && d.exists ? (d.expiresAt||null) : null,
      status: d && d.exists ? (d.active ? "active" : "expired") : "inactive",
      lastCheckedAt: new Date().toISOString()
    };
    saveLicenseCacheData(licenseCache);
  }
  if(!silent) render();
}
async function submitLicenseActivation(code){
  licenseError = null; licenseActivating = true; render();
  if(typeof cloudSetCenter==="function") cloudSetCenter(code);
  const res = await cloudLicenseActivate(code);
  licenseActivating = false;
  if(!res.success){
    licenseError = (res.data && res.data.message) || "Connexion impossible. Réessayez.";
    render();
    return;
  }
  if(!res.data || !res.data.valid){
    licenseError = (res.data && res.data.message) || "Code invalide.";
    render();
    return;
  }
  licenseCache = { key: code, expiresAt: res.data.expiresAt||null, status:"active", lastCheckedAt: new Date().toISOString() };
  saveLicenseCacheData(licenseCache);
  showToast("Licence activée avec succès.");
  render();
}
function licenseGateHTML(){
  const neverActivated = !licenseCache || licenseCache.status==="inactive";
  const title = neverActivated ? "Activation requise" : "Licence expirée";
  const msg = neverActivated
    ? "Cette application n'est pas encore activée. Entrez le code d'activation à 8 chiffres fourni par KINVOS."
    : "L'abonnement de ce centre est terminé. Entrez un nouveau code d'activation pour continuer.";
  return `<div class="role-screen">
    ${easySkillLogoHTML(64)}
    <div style="height:14px;"></div>
    <div class="logo-title" style="font-size:22px;">Easy<span>Skill</span></div>
    <div style="max-width:340px;text-align:center;margin:10px 0 4px;">
      <div style="font-weight:800;color:var(--navy-950);font-size:15px;margin-bottom:6px;">🔒 ${esc(title)}</div>
      <p class="role-p" style="margin-top:0;">${esc(msg)}</p>
    </div>
    ${licenseError? `<p style="color:var(--red-600);font-size:12.5px;text-align:center;font-weight:700;max-width:320px;">${esc(licenseError)}</p>`:""}
    <input id="license-code-input" inputmode="numeric" maxlength="8" placeholder="12345678"
      style="max-width:260px;width:100%;text-align:center;letter-spacing:.15em;font-size:19px;font-weight:700;padding:12px;border-radius:10px;border:1.5px solid var(--slate-200);margin:6px 0 10px;">
    <button class="btn btn-primary btn-full" style="max-width:260px;" data-action="submit-license" ${licenseActivating?"disabled":""}>
      ${licenseActivating? "Vérification…" : "✅ Activer"}
    </button>
    <button class="btn btn-ghost btn-full" style="max-width:260px;margin-top:8px;" data-action="license-refresh" ${licenseActivating?"disabled":""}>🔄 Revérifier ma licence</button>
    <div class="brand-credit">PAR KINVOS</div>
  </div>`;
}
function submitLicenseFromGate(){
  const el = document.getElementById("license-code-input");
  const code = el ? el.value.replace(/[^0-9]/g,"") : "";
  if(code.length<6){ licenseError = "Entrez le code complet."; render(); return; }
  submitLicenseActivation(code);
}

/* ---------- app state ---------- */
let role = null;            // 'admin' | 'secretariat'
let secTab = "eleves";      // active tab within a space
let secDrawerOpen = false;  // menu latéral (Espace Secrétariat)
let screen = null;          // sub-screen object, e.g. {type:'studentDetail', id}
let modalState = null;      // active modal object
let toast = null;
let appState = "splash";    // 'splash' -> null (puis écran des espaces)
let deferredInstallPrompt = null;

/* ---------- installation PWA (PC & mobile) ---------- */
function isStandaloneApp(){
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone===true;
}
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  render();
});
window.addEventListener("appinstalled", ()=>{ deferredInstallPrompt = null; render(); });
function triggerInstall(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(()=>{ deferredInstallPrompt = null; render(); });
  } else {
    modalState = {type:"installHelp"};
    render();
  }
}
setTimeout(()=>{ if(appState==="splash"){ appState=null; render(); } }, 2000);

function showToast(msg, type){ toast = {msg, type}; render(); setTimeout(()=>{ toast=null; hideToast(); },2600); }
/* Fait disparaître le toast sans ré-afficher toute la page : un render() complet ici recréait
   tous les champs de saisie (ex. ajout de plusieurs matières à la suite) et effaçait ce que
   l'utilisateur était en train de taper au moment où le toast se fermait tout seul. */
function hideToast(){
  const el = document.querySelector(".toast");
  if(el) el.remove(); else render();
}

/* ---------- derived helpers ---------- */
function getFiliere(id){ return db.filieres.find(f=>f.id===id); }
function filiereName(id){ const f=getFiliere(id); return f? f.nom : "—"; }
function fraisById(id){ return db.fraisTypes.find(f=>f.id===id); }
function matieresOf(filiereId){ const f=getFiliere(filiereId); return (f&&f.matieres)||[]; }
function matiereOf(filiereId, matiereId){ return matieresOf(filiereId).find(m=>m.id===matiereId); }
function fraisApplicables(filiereId){ return db.fraisTypes.filter(f=> f.filiereId===null || f.filiereId===filiereId); }
function studentTotal(student){ return (student.fraisChoisis||[]).reduce((s,fc)=>s+Number(fc.montant||0),0); }
function studentPaid(studentId){ return db.payments.filter(p=>p.studentId===studentId).reduce((s,p)=>s+Number(p.montant||0),0); }
function studentBalance(student){ return studentTotal(student) - studentPaid(student.id); }
function activeStudents(){ return db.students.filter(s=>s.statut!=="archive"); }
function studentById(id){ return db.students.find(s=>s.id===id); }
function teacherById(id){ return db.teachers.find(t=>t.id===id); }
function teacherPaidForMonth(teacherId, month){ return db.salaryPayments.filter(p=>p.teacherId===teacherId && p.mois===month).reduce((s,p)=>s+Number(p.montant||0),0); }
function teacherTotalVerse(teacherId){ return db.salaryPayments.filter(p=>p.teacherId===teacherId).reduce((s,p)=>s+Number(p.montant||0),0); }
function statutLabel(st){ return {actif:"En formation", stage:"En stage", termine:"Formation terminée", archive:"Archivé"}[st] || "En formation"; }
function statutPillClass(st){ return {actif:"pill-blue", stage:"pill-amber", termine:"pill-green", archive:"pill-red"}[st] || "pill-blue"; }
function totalExpenses(){ return (db.expenses||[]).reduce((s,e)=>s+Number(e.montant||0),0); }
function totalRevenues(){ return (db.revenues||[]).reduce((s,r)=>s+Number(r.montant||0),0); }
function expenseById(id){ return (db.expenses||[]).find(e=>e.id===id); }
function revenueById(id){ return (db.revenues||[]).find(r=>r.id===id); }
function caisseEspecesEleves(){ return db.payments.filter(p=>(p.mode||"Espèces")==="Espèces").reduce((s,p)=>s+Number(p.montant||0),0); }
function caisseEspecesRecettes(){ return (db.revenues||[]).filter(r=>(r.mode||"Espèces")==="Espèces").reduce((s,r)=>s+Number(r.montant||0),0); }
function caisseEspecesDepenses(){ return (db.expenses||[]).filter(e=>(e.mode||"Espèces")==="Espèces").reduce((s,e)=>s+Number(e.montant||0),0); }
function caisseEspecesSalaires(){ return (db.salaryPayments||[]).filter(p=>(p.mode||"Espèces")==="Espèces").reduce((s,p)=>s+Number(p.montant||0),0); }
function caisseMouvementsEntrees(){ return (db.caisseMovements||[]).filter(m=>m.type==="entree").reduce((s,m)=>s+Number(m.montant||0),0); }
function caisseMouvementsSorties(){ return (db.caisseMovements||[]).filter(m=>m.type==="sortie").reduce((s,m)=>s+Number(m.montant||0),0); }
function caisseSolde(){
  const fond = Number(db.settings.caisseFondInitial||0);
  return fond + caisseEspecesEleves() + caisseEspecesRecettes() + caisseMouvementsEntrees()
    - caisseEspecesDepenses() - caisseEspecesSalaires() - caisseMouvementsSorties();
}
function paymentById(id){ return db.payments.find(p=>p.id===id); }
function bulletinById(studentId, bulletinId){ const s=studentById(studentId); if(!s) return null; return (s.bulletins||[]).find(b=>b.id===bulletinId); }

function centerInitials(){
  const name = (db.settings.centerName||"").trim();
  if(!name) return "ES";
  const words = name.split(/\s+/).filter(Boolean);
  if(words.length && /^[A-ZÀ-Ö0-9]{2,6}$/.test(words[0])) return words[0].toUpperCase();
  const initials = words.slice(0,3).map(w=>w[0]).join("").toUpperCase();
  return initials || "ES";
}
function genMatricule(){
  const prefix = centerInitials();
  const yr = (db.settings.anneeScolaire||currentSchoolYear()).split("-")[0].slice(-2);
  const n = (db.students.length+1).toString().padStart(3,"0");
  return prefix+yr+"-"+n;
}
/* Numéro de quittance : uniquement des chiffres, ex. 00001, 00002... séquentiel et jamais réutilisé. */
function genReceiptNo(){
  const n = Number(db.settings.nextReceiptNo)||1;
  db.settings.nextReceiptNo = n+1;
  return String(n).padStart(5,"0");
}

/* ===================== RENDER ROOT ===================== */
function render(){
  try{
    let html = "";
    if(appState==="splash") html += splashHTML();
    else if(!licenseIsValid()) html += licenseGateHTML();
    else if(!role) html += roleSelectHTML();
    else if(role==="secretariat") html += spaceHTML("secretariat");
    else if(role==="admin") html += spaceHTML("admin");
    html += modalHTML();
    html += toastHTML();
    APP.innerHTML = html;
    window.scrollTo(0,0);
  }catch(err){
    console.error("Erreur d'affichage EasySkill:", err);
    APP.innerHTML = `<div style="padding:30px 20px;font-family:sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#b91c1c;">Une erreur est survenue</h2>
      <p style="color:#475569;font-size:13.5px;">L'affichage a rencontré un problème inattendu. Vos données ne sont pas perdues. Détail technique :</p>
      <pre style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:11.5px;white-space:pre-wrap;">${esc(err && err.message ? err.message : String(err))}</pre>
      <button onclick="screen=null;modalState=null;render();" style="margin-top:12px;padding:10px 16px;border-radius:10px;background:#1e3a8a;color:#fff;border:none;font-weight:700;">Revenir à l'accueil</button>
    </div>`;
  }
}

function toastHTML(){
  if(!toast) return "";
  return `<div class="toast ${toast.type==='err'?'err':''}">${esc(toast.msg)}</div>`;
}

function logoBadgeHTML(){
  if(db.settings.logo) return `<img src="${db.settings.logo}" style="width:40px;height:40px;border-radius:13px;object-fit:cover;">`;
  return `<div class="logo-badge">ES</div>`;
}

function topBarHTML(title){
  const hamburger = (role==="secretariat"||role==="admin") ? `<button class="hamburger-btn no-print" data-action="toggle-sec-drawer" title="Menu" aria-label="Menu">☰</button>` : "";
  return `<div class="topbar no-print"><div class="wrap topbar-inner">
    <div class="logo">${hamburger}${logoBadgeHTML()}<div class="logo-text">
      <div class="logo-title">Easy<span>Skill</span></div>
      <div class="logo-sub">${esc(db.settings.centerName)}</div>
    </div></div>
    <div class="topbar-right">
      <div class="page-title">${esc(title)}</div>
      ${syncBadgeHTML()}
      <button class="logout-btn no-print" data-action="cloud-refresh" title="Récupérer les dernières données">🔄</button>
      <button class="logout-btn" data-action="exit-role">🚪 Quitter</button>
    </div>
  </div></div>${(role==="secretariat"||role==="admin") ? secDrawerHTML() : ""}`;
}

function secDrawerHTML(){
  const isAdmin = role==="admin";
  const tabsAdmin = [
    {id:"dashboard", label:"Tableau de bord", icon:"📊"},
    {id:"eleves", label:"Élèves", icon:"🎓"},
    {id:"gestion", label:"Gestion élève", icon:"🔀"},
    {id:"paiements", label:"Paiement", icon:"💳"},
    {id:"enseignants", label:"Enseignants", icon:"🧑‍🏫"},
    {id:"depenses", label:"Dépenses", icon:"💸"},
    {id:"recettes", label:"Recettes", icon:"💰"},
    {id:"documents", label:"Documents", icon:"📄"},
    {id:"caisse", label:"Caisse", icon:"🗃️"},
    {id:"filieres", label:"Filières & Frais", icon:"🗂️"},
    {id:"rapports", label:"Rapports", icon:"📑"},
    {id:"parametres", label:"Paramètres", icon:"⚙️"}
  ];
  const tabsSec = [
    {id:"eleves", label:"Élèves", icon:"🎓"},
    {id:"gestion", label:"Gestion élève", icon:"🔀"},
    {id:"paiements", label:"Paiement", icon:"💳"},
    {id:"enseignants", label:"Enseignants", icon:"🧑‍🏫"},
    {id:"depenses", label:"Dépenses", icon:"💸"},
    {id:"recettes", label:"Recettes", icon:"💰"},
    {id:"documents", label:"Documents", icon:"📄"},
    {id:"caisse", label:"Caisse", icon:"🗃️"},
    {id:"filieres", label:"Filières & Frais", icon:"🗂️"}
  ];
  const tabs = isAdmin ? tabsAdmin : tabsSec;
  const items = tabs.map(t=>`
    <button class="drawer-tab ${secTab===t.id?"active":""}" data-action="set-tab" data-tab="${t.id}"><span class="tab-ic">${t.icon}</span> ${esc(t.label)}</button>`).join("");
  return `<div class="sec-drawer-backdrop no-print ${secDrawerOpen?"open":""}" data-action="close-sec-drawer"></div>
  <div class="sec-drawer no-print ${secDrawerOpen?"open":""}">
    <div class="sec-drawer-head"><span>${isAdmin?"📊 Espace Admin / Directeur":"📋 Espace Secrétariat"}</span><button class="drawer-close-btn" data-action="close-sec-drawer" aria-label="Fermer">✕</button></div>
    <div class="sec-drawer-body">${items}</div>
  </div>`;
}

function tabsHTML(tabs, active){
  return `<div class="wrap no-print"><div class="tabs">
    ${tabs.map(t=>`<button class="tab-btn ${active===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}">${t.icon} ${esc(t.label)}</button>`).join("")}
  </div></div>`;
}

/* ---------- Logo EasySkill fixe (toujours celui de l'app, jamais celui du centre) ---------- */
function easySkillLogoHTML(size){
  return `<img src="logo.png" alt="EasySkill" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*0.32)}px;object-fit:cover;box-shadow:0 3px 10px rgba(15,31,71,.28);">`;
}

/* ===================== SPLASH (démarrage) ===================== */
function splashHTML(){
  return `<div class="splash-screen">
    ${easySkillLogoHTML(130)}
    <div class="brand-credit" style="margin-top:22px;">PAR KINVOS</div>
  </div>`;
}

/* ===================== ROLE SELECT ===================== */
function roleSelectHTML(){
  const canPromptInstall = !!deferredInstallPrompt;
  return `<div class="role-screen">
    ${easySkillLogoHTML(64)}
    <div style="height:14px;"></div>
    <div class="logo-title" style="font-size:22px;">Easy<span>Skill</span></div>
    <p class="role-p">${esc(db.settings.centerName)} — choisissez votre espace pour continuer.</p>
    <button class="role-card" data-action="select-role" data-role="secretariat">
      <div class="role-ic" style="background:var(--navy-950);">📋</div>
      <div><div class="role-title">Espace Secrétariat</div><div class="role-desc">Inscriptions, paiements, attestations · code requis</div></div>
    </button>
    <button class="role-card" data-action="select-role" data-role="admin">
      <div class="role-ic" style="background:var(--orange-500);">📊</div>
      <div><div class="role-title">Espace Admin / Directeur</div><div class="role-desc">Tableau de bord, enseignants, salaires, paramètres · code requis</div></div>
    </button>
    <button class="btn btn-orange btn-full" data-action="install-app" style="max-width:340px;margin-top:16px;">⬇️ Télécharger l'application</button>
    ${!canPromptInstall? `<div class="install-hint" style="color:var(--slate-500);">Sur PC (Chrome/Edge) : cliquez sur Télécharger, ou utilisez l'icône d'installation dans la barre d'adresse.<br>Sur mobile : cliquez sur Télécharger, ou via le menu du navigateur « Ajouter à l'écran d'accueil ».</div>`:""}
    <div class="brand-credit">PAR KINVOS</div>
  </div>`;
}

function requestRoleAuth(targetRole){
  modalState = {type:"pin", mode:targetRole, value:"", error:null};
  render();
  setTimeout(()=>{ const el=document.getElementById("pin-input-0"); if(el) el.focus(); },30);
}

/* ===================== SPACE ROUTER ===================== */
function spaceHTML(sp){
  if(screen && screen.type==="studentDetail") return studentDetailHTML(screen.id);
  if(screen && screen.type==="paymentPrint") return paymentPrintHTML(screen.id);
  if(screen && screen.type==="certificate") return certificateHTML(screen.id, screen.kind);
  if(screen && screen.type==="teacherDetail") return teacherDetailHTML(screen.id);
  if(screen && screen.type==="teacherHistory") return teacherHistoryPrintHTML(screen.id);
  if(screen && screen.type==="receipt") return receiptHTML(screen.id);
  if(screen && screen.type==="bulletinPrint") return bulletinPrintHTML(screen.studentId, screen.id);
  if(screen && screen.type==="expenseReceipt") return expenseReceiptHTML(screen.id);
  if(screen && screen.type==="revenueReceipt") return revenueReceiptHTML(screen.id);
  if(screen && screen.type==="rapport") return rapportHTML(screen.kind);

  const title = sp==="admin" ? "Espace Admin / Directeur" : "Espace Secrétariat";
  const tabsAdmin = [
    {id:"dashboard", label:"Tableau de bord", icon:"📊"},
    {id:"eleves", label:"Élèves", icon:"🎓"},
    {id:"gestion", label:"Gestion élève", icon:"🔀"},
    {id:"paiements", label:"Paiement", icon:"💳"},
    {id:"enseignants", label:"Enseignants", icon:"🧑‍🏫"},
    {id:"depenses", label:"Dépenses", icon:"💸"},
    {id:"recettes", label:"Recettes", icon:"💰"},
    {id:"documents", label:"Documents", icon:"📄"},
    {id:"caisse", label:"Caisse", icon:"🗃️"},
    {id:"filieres", label:"Filières & Frais", icon:"🗂️"},
    {id:"rapports", label:"Rapports", icon:"📑"},
    {id:"parametres", label:"Paramètres", icon:"⚙️"}
  ];
  const tabsSec = [
    {id:"eleves", label:"Élèves", icon:"🎓"},
    {id:"gestion", label:"Gestion élève", icon:"🔀"},
    {id:"paiements", label:"Paiement", icon:"💳"},
    {id:"enseignants", label:"Enseignants", icon:"🧑‍🏫"},
    {id:"depenses", label:"Dépenses", icon:"💸"},
    {id:"recettes", label:"Recettes", icon:"💰"},
    {id:"documents", label:"Documents", icon:"📄"},
    {id:"caisse", label:"Caisse", icon:"🗃️"},
    {id:"filieres", label:"Filières & Frais", icon:"🗂️"}
  ];
  const tabs = sp==="admin" ? tabsAdmin : tabsSec;
  let body = "";
  if(secTab==="dashboard" && sp==="admin") body = dashboardHTML();
  else if(secTab==="enseignants") body = teachersTabHTML(sp);
  else if(secTab==="parametres" && sp==="admin") body = settingsHTML();
  else if(secTab==="filieres") body = filieresTabHTML(sp);
  else if(secTab==="gestion") body = gestionEleveTabHTML(sp);
  else if(secTab==="paiements") body = paiementsTabHTML(sp);
  else if(secTab==="depenses") body = depensesTabHTML(sp);
  else if(secTab==="recettes") body = recettesTabHTML(sp);
  else if(secTab==="documents") body = documentsTabHTML(sp);
  else if(secTab==="caisse") body = caisseTabHTML(sp);
  else if(secTab==="rapports" && sp==="admin") body = rapportsHTML();
  else body = studentsTabHTML(sp);

  return topBarHTML(title) + `<div class="wrap" style="padding:16px 16px 60px;">${body}</div>`;
}

/* ===================== DASHBOARD (admin) ===================== */
function dashboardHTML(){
  const students = activeStudents();
  const totalDu = students.reduce((s,st)=>s+studentTotal(st),0);
  const totalEncaisse = db.payments.reduce((s,p)=>s+Number(p.montant||0),0);
  const impayes = totalDu - totalEncaisse;
  const masseSalariale = db.teachers.reduce((s,t)=>s+Number(t.salaireMensuel||0),0);
  const byFiliere = db.filieres.map(f=>({f, n: students.filter(s=>s.filiereId===f.id).length})).filter(x=>x.n>0);

  return `
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-ic" style="background:var(--navy-900);">🎓</div><div class="stat-val">${students.length}</div><div class="stat-label">Élèves actifs</div></div>
    <div class="stat-card"><div class="stat-ic" style="background:var(--emerald-600);">💰</div><div class="stat-val">${formatFCFA(totalEncaisse)}</div><div class="stat-label">Total encaissé</div></div>
    <div class="stat-card"><div class="stat-ic" style="background:var(--red-600);">⚠️</div><div class="stat-val">${formatFCFA(impayes)}</div><div class="stat-label">Reste à payer</div></div>
    <div class="stat-card"><div class="stat-ic" style="background:var(--orange-500);">🧑‍🏫</div><div class="stat-val">${formatFCFA(masseSalariale)}</div><div class="stat-label">Masse salariale / mois</div></div>
  </div>
  <div class="card" style="margin-top:14px;">
    <div class="section-title">🗂️ Effectifs par filière</div>
    ${byFiliere.length? byFiliere.map(x=>`<div class="row" style="padding:8px 0;border-bottom:1px solid var(--slate-100);">
      <span style="font-size:13px;font-weight:600;">${esc(x.f.nom)}</span><span class="pill pill-blue">${x.n} élève${x.n>1?'s':''}</span>
    </div>`).join("") : `<div class="empty">Aucun élève inscrit pour le moment.</div>`}
  </div>
  <div class="card">
    <div class="section-title">🧑‍🏫 Enseignants</div>
    <div class="row"><span style="font-size:13px;color:var(--slate-600);">${db.teachers.length} enseignant(s) enregistré(s)</span>
    <button class="btn btn-ghost btn-sm" data-action="set-tab" data-tab="enseignants">Voir la liste →</button></div>
  </div>`;
}

/* ===================== ÉLÈVES : liste par filière ===================== */
let studentSearch = "";
let eleveFiliereId = null; // filière sélectionnée dans l'onglet "Élèves" (null = vue des filières)
function studentsTabHTML(sp){
  if(!eleveFiliereId) return filiereListForStudentsHTML(sp);
  return studentsByFiliereHTML(sp, eleveFiliereId);
}
function filiereListForStudentsHTML(sp){
  const students = activeStudents();
  const nonAffectes = students.filter(s=>!s.filiereId).length;
  return `
  <div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;">
    <div class="section-title" style="margin:0;">🗂️ Filières — choisissez une filière pour voir ses élèves</div>
    <span style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost" data-action="import-pdf-students">📄 Importer un PDF</button>
      <button class="btn btn-orange" data-action="new-student">➕ Nouvel élève</button>
    </span>
  </div>
  ${nonAffectes? `<div class="card" style="border-left:4px solid var(--orange-500);margin-bottom:14px;cursor:pointer;" data-action="select-eleve-filiere" data-id="unassigned">
    <div class="row">
      <span style="font-size:13.5px;font-weight:600;">🕓 Élèves non affectés <span style="color:var(--slate-500);font-weight:500;">— filière et frais à renseigner</span></span>
      <span style="display:flex;align-items:center;gap:8px;">
        <span class="pill pill-amber">${nonAffectes} élève${nonAffectes>1?'s':''}</span>
        <span style="color:var(--slate-400);">→</span>
      </span>
    </div>
  </div>` : ""}
  <div class="card">
    ${db.filieres.length? db.filieres.map(f=>{
      const n = students.filter(s=>s.filiereId===f.id).length;
      return `<div class="row" style="padding:11px 0;border-bottom:1px solid var(--slate-100);cursor:pointer;" data-action="select-eleve-filiere" data-id="${f.id}">
        <span style="font-size:13.5px;font-weight:600;">${esc(f.nom)}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span class="pill pill-blue">${n} élève${n>1?'s':''}</span>
          <span style="color:var(--slate-400);">→</span>
        </span>
      </div>`;
    }).join("") : `<div class="empty">Aucune filière enregistrée. Créez-en une dans "Filières & Frais".</div>`}
  </div>`;
}
function studentsByFiliereHTML(sp, filiereId){
  const isUnassigned = filiereId==="unassigned";
  const f = getFiliere(filiereId);
  const q = studentSearch.trim().toLowerCase();
  let list = activeStudents().filter(s=> isUnassigned ? !s.filiereId : s.filiereId===filiereId);
  if(q) list = list.filter(s=> (s.nom+" "+s.prenom+" "+s.matricule).toLowerCase().includes(q));
  list = list.slice().sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));

  return `
  <span class="link-back" data-action="back-to-filiere-list" style="cursor:pointer;">← Retour aux filières</span>
  <div class="row" style="margin:8px 0 14px;">
    <input class="search-input" placeholder="🔎 Rechercher un élève..." value="${esc(studentSearch)}" oninput="studentSearch=this.value;render();">
    ${isUnassigned? "" : `<button class="btn btn-orange" data-action="new-student" data-filiere-id="${esc(filiereId)}">➕ Nouvel élève</button>`}
  </div>
  <div class="card">
    <div class="section-title">${isUnassigned? "🕓 Élèves non affectés" : "🎓 "+esc(f?f.nom:"Filière")} — élèves inscrits (${list.length})</div>
    ${isUnassigned? `<p style="font-size:12px;color:var(--slate-500);margin-top:-4px;">Ouvrez chaque élève puis "Modifier" pour lui attribuer une filière et ses frais.</p>` : ""}
    ${list.length? `<div class="table-wrap"><table><thead><tr>
      <th>Matricule</th><th>Nom & prénom</th><th>Sexe</th><th>Solde</th><th></th>
    </tr></thead><tbody>
      ${list.map(s=>{
        const bal = studentBalance(s);
        return `<tr>
          <td>${esc(s.matricule)}</td>
          <td>${esc(s.nom)} ${esc(s.prenom)}</td>
          <td>${s.sexe==='F'?'F':'M'}</td>
          <td>${isUnassigned? `<span class="pill pill-amber">Filière à définir</span>` : (bal>0? `<span class="pill pill-red">${formatFCFA(bal)}</span>` : `<span class="pill pill-green">Soldé</span>`)}</td>
          <td><button class="btn btn-ghost btn-sm" data-action="open-student" data-id="${s.id}">Ouvrir →</button></td>
        </tr>`;
      }).join("")}
    </tbody></table></div>` : `<div class="empty">Aucun élève trouvé${isUnassigned?"":' dans cette filière. Cliquez sur "Nouvel élève" pour inscrire le premier.'}.</div>`}
  </div>`;
}

/* ===================== ÉLÈVES : détail ===================== */
function studentDetailHTML(id){
  const s = studentById(id);
  const spaceTitle = role==="admin" ? "Espace Admin / Directeur" : "Espace Secrétariat";
  if(!s) return topBarHTML(spaceTitle) + `<div class="wrap" style="padding:24px 16px;"><div class="empty">Élève introuvable.</div></div>`;
  const total = studentTotal(s);
  const paid = studentPaid(s.id);
  const bal = total - paid;
  const hist = db.payments.filter(p=>p.studentId===s.id).slice().sort((a,b)=> b.date.localeCompare(a.date));

  return topBarHTML(spaceTitle) + `<div class="wrap" style="padding:16px 16px 60px;max-width:760px;">
    <span class="link-back no-print" data-action="back-to-eleves" style="cursor:pointer;">← Retour aux élèves</span>
    <div class="card">
      <div class="row">
        <div>
          <div class="section-title" style="margin-bottom:2px;">${esc(s.nom)} ${esc(s.prenom)} <span class="pill ${statutPillClass(s.statut)}" style="margin-left:6px;">${statutLabel(s.statut)}</span></div>
          <div style="font-size:12px;color:var(--slate-500);">Matricule ${esc(s.matricule)} · ${esc(filiereName(s.filiereId))} · Année ${esc(s.anneeScolaire)}</div>
        </div>
        <button class="btn btn-ghost btn-sm no-print" data-action="edit-student" data-id="${s.id}">✏️ Modifier</button>
      </div>
      <div class="grid2" style="margin-top:14px;">
        <div style="font-size:12.5px;color:var(--slate-600);"><b>Sexe :</b> ${esc(s.sexe||"-")}</div>
        <div style="font-size:12.5px;color:var(--slate-600);"><b>Téléphone :</b> ${esc(s.telephone||"-")}</div>
        <div style="font-size:12.5px;color:var(--slate-600);"><b>Date de naissance :</b> ${formatDate(s.dateNaissance)}</div>
        <div style="font-size:12.5px;color:var(--slate-600);"><b>Date d'inscription :</b> ${formatDate(s.dateInscription)}</div>
      </div>
    </div>

    <div class="balance-box">
      <div><div class="lbl">Total dû</div><div class="val">${formatFCFA(total)}</div></div>
      <div><div class="lbl">Payé</div><div class="val">${formatFCFA(paid)}</div></div>
      <div><div class="lbl">Solde</div><div class="val">${formatFCFA(bal)}</div></div>
    </div>

    <div class="card">
      <div class="section-title">💳 Frais sélectionnés</div>
      ${(s.fraisChoisis||[]).map(fc=>`<div class="row" style="padding:7px 0;border-bottom:1px solid var(--slate-100);font-size:13px;">
        <span>${esc(fraisById(fc.fraisId)? fraisById(fc.fraisId).nom : "Frais supprimé")}</span><span style="font-weight:700;">${formatFCFA(fc.montant)}</span>
      </div>`).join("")}
    </div>

    <div class="card">
      <div class="row"><div class="section-title" style="margin:0;">🧾 Historique des paiements</div>
        <button class="btn btn-orange btn-sm no-print" data-action="add-payment" data-id="${s.id}">➕ Enregistrer un paiement</button>
      </div>
      ${hist.length? `<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Note</th><th class="no-print"></th></tr></thead><tbody>
        ${hist.map(p=>`<tr><td>${formatDate(p.date)}</td><td style="font-weight:700;">${formatFCFA(p.montant)}</td><td>${esc(p.mode||"-")}</td><td>${esc(p.note||"-")}</td><td class="no-print"><button class="btn btn-ghost btn-sm" data-action="print-receipt" data-id="${p.id}">🖨️ Quittance</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Aucun paiement enregistré.</div>`}
    </div>

    <div class="card no-print">
      <div class="row"><div class="section-title" style="margin:0;">📘 Bulletins</div>
        <button class="btn btn-orange btn-sm" data-action="new-bulletin" data-id="${s.id}">➕ Nouveau bulletin</button>
      </div>
      ${(s.bulletins||[]).length? `<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Trimestre</th><th>Moyenne</th><th>Date</th><th></th></tr></thead><tbody>
        ${(s.bulletins||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)).map(b=>`<tr><td>${esc(b.trimestre||b.periode||"-")}</td><td style="font-weight:700;">${b.moyenne!=null&&b.moyenne!==""? esc(b.moyenne)+"/20" : "-"}</td><td>${formatDate(b.date)}</td><td>${role==="admin"? `<button class="btn btn-ghost btn-sm" data-action="print-bulletin" data-id="${b.id}" data-student-id="${s.id}">🖨️ Imprimer</button>` : `<span class="pill" style="font-size:11px;">🔒 Admin</span>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Aucun bulletin enregistré.</div>`}
    </div>

    <div class="fab-bottom no-print">
      <button class="btn btn-primary" data-action="print-payment-state" data-id="${s.id}">🖨️ Imprimer l'état de paiement</button>
      ${role==="admin"? `<button class="btn btn-ghost" data-action="gen-certificate" data-id="${s.id}" data-kind="attestation">📄 Attestation</button>
      <button class="btn btn-ghost" data-action="gen-certificate" data-id="${s.id}" data-kind="diplome">🎖️ Diplôme</button>` : `<span class="pill" title="Réservé à l'administrateur" style="align-self:center;">🔒 Attestation / Diplôme : réservé à l'administrateur</span>`}
      ${s.statut==="actif"? `<button class="btn btn-ghost" data-action="student-set-statut" data-id="${s.id}" data-statut="stage">🏭 Envoyer en stage</button>`:""}
      ${s.statut==="stage"? `<button class="btn btn-ghost" data-action="student-set-statut" data-id="${s.id}" data-statut="actif">↩️ Terminer le stage</button>`:""}
      ${(s.statut==="actif"||s.statut==="stage")? `<button class="btn btn-ghost" data-action="student-set-statut" data-id="${s.id}" data-statut="termine">🏁 Terminer la formation</button>`:""}
      ${s.statut==="termine"? `<button class="btn btn-ghost" data-action="student-set-statut" data-id="${s.id}" data-statut="actif">↩️ Réactiver</button>`:""}
      ${role==="admin"? `<button class="btn btn-danger" data-action="archive-student" data-id="${s.id}">🗄️ Archiver</button>`:""}
    </div>
  </div>`;
}

/* ===================== IMPRESSION : état de paiement ===================== */
function paymentPrintHTML(id){
  const s = studentById(id);
  if(!s) return `<div class="wrap" style="padding:24px;">Élève introuvable. <button class="btn btn-ghost no-print" data-action="back-to-eleves">Retour</button></div>`;
  const total = studentTotal(s), paid = studentPaid(s.id), bal = total-paid;
  const hist = db.payments.filter(p=>p.studentId===s.id).slice().sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="back-to-student" data-id="${s.id}" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer / Enregistrer en PDF</button>
    </div>
    <div class="wrap print-area" style="max-width:680px;padding:20px 16px 60px;">
      <div class="doc-header">
        ${logoBadgeHTML()}
        <div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div>
      </div>
      <h2 style="font-family:var(--font-head);font-size:17px;color:var(--navy-950);margin:0 0 4px;">État de paiement</h2>
      <div style="font-size:12px;color:var(--slate-500);margin-bottom:16px;">Édité le ${formatDate(todayISO())} · Année scolaire ${esc(s.anneeScolaire)}</div>
      <div class="grid2" style="margin-bottom:16px;">
        <div style="font-size:13px;"><b>Élève :</b> ${esc(s.nom)} ${esc(s.prenom)}</div>
        <div style="font-size:13px;"><b>Matricule :</b> ${esc(s.matricule)}</div>
        <div style="font-size:13px;"><b>Filière :</b> ${esc(filiereName(s.filiereId))}</div>
        <div style="font-size:13px;"><b>Téléphone :</b> ${esc(s.telephone||"-")}</div>
      </div>
      <table style="margin-bottom:14px;"><thead><tr><th>Frais</th><th>Montant</th></tr></thead><tbody>
        ${(s.fraisChoisis||[]).map(fc=>`<tr><td>${esc(fraisById(fc.fraisId)? fraisById(fc.fraisId).nom : "-")}</td><td>${formatFCFA(fc.montant)}</td></tr>`).join("")}
        <tr><td style="font-weight:800;">Total dû</td><td style="font-weight:800;">${formatFCFA(total)}</td></tr>
      </tbody></table>
      <table style="margin-bottom:14px;"><thead><tr><th>Date</th><th>Montant versé</th><th>Mode</th></tr></thead><tbody>
        ${hist.length? hist.map(p=>`<tr><td>${formatDate(p.date)}</td><td>${formatFCFA(p.montant)}</td><td>${esc(p.mode||"-")}</td></tr>`).join("") : `<tr><td colspan="3" style="text-align:center;color:var(--slate-400);">Aucun versement</td></tr>`}
      </tbody></table>
      <div class="balance-box"><div><div class="lbl">Total dû</div><div class="val">${formatFCFA(total)}</div></div><div><div class="lbl">Payé</div><div class="val">${formatFCFA(paid)}</div></div><div><div class="lbl">Solde restant</div><div class="val">${formatFCFA(bal)}</div></div></div>
      <div class="sig-row"><div>Signature du secrétariat</div><div>Cachet du centre</div></div>
    </div>`;
}

/* ===================== GESTION DYNAMIQUE DE LA TAILLE/ORIENTATION DE PAGE À L'IMPRESSION =====================
   Le CSS @page ne peut pas être conditionné par une classe : on injecte donc une balise <style>
   juste avant chaque impression, avec la bonne orientation et des marges à 0 (le contenu gère
   lui-même ses marges internes). Ça évite de dépendre d'une "named page" CSS (mal supportée,
   notamment sur mobile/Android) et ça garantit que le contenu remplit toute la page A4,
   quels que soient les réglages de marges appliqués par le navigateur/système au moment de
   l'enregistrement en PDF. */
function setupPrintPage(){
  const isDiplome = screen && screen.type==="certificate" && screen.kind==="diplome";
  let styleEl = document.getElementById("dynamic-print-page");
  if(!styleEl){
    styleEl = document.createElement("style");
    styleEl.id = "dynamic-print-page";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = isDiplome
    ? `@page{size:A4 landscape;margin:0;}`
    : `@page{size:A4 portrait;margin:0;}`;
}

/* ===================== EXPORT PDF DIRECT DU DIPLÔME (paysage forcé, sans boîte d'impression) =====================
   window.print() ne permet pas de forcer fiablement l'orientation "Paysage" dans la boîte de
   dialogue du navigateur (en particulier sur Android/Chrome mobile, qui l'ignore souvent et
   affiche "Portrait" par défaut). Pour éviter tout choix manuel à l'utilisateur, on capture le
   diplôme (élément .diplome-canvas, dimensions fixes 297mm x 210mm) avec html2canvas puis on
   construit nous-mêmes un PDF A4 paysage avec jsPDF, avant de déclencher le téléchargement. */
async function downloadDiplomePDF(s, btn){
  const canvasEl = document.querySelector(".diplome-canvas");
  if(!canvasEl){ alert("Diplôme introuvable à l'export."); return; }
  if(!window.html2canvas || !window.jspdf){
    alert("La génération de PDF n'a pas pu être chargée. Vérifiez votre connexion internet au moins une fois, puis réessayez (elle sera ensuite disponible hors-ligne).");
    return;
  }
  const originalLabel = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "⏳ Génération du PDF…"; }
  try{
    // On force temporairement l'affichage à l'échelle 1 (non réduite) pour une capture nette,
    // quelle que soit la taille d'écran de l'utilisateur.
    const wrap = canvasEl.closest(".diplome-scale-wrap");
    const prevWrapStyle = wrap ? wrap.getAttribute("style")||"" : "";
    const prevCanvasStyle = canvasEl.getAttribute("style")||"";
    if(wrap){ wrap.style.width="297mm"; wrap.style.height="210mm"; wrap.style.overflow="visible"; }
    canvasEl.style.transform="none";

    const canvas = await html2canvas(canvasEl, { scale: 3, useCORS: true, backgroundColor: "#fdfbf4" });

    if(wrap) wrap.setAttribute("style", prevWrapStyle);
    canvasEl.setAttribute("style", prevCanvasStyle);

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "JPEG", 0, 0, 297, 210, undefined, "FAST");
    const fileName = `Diplome_${(s.nom||"").replace(/\s+/g,"_")}_${(s.prenom||"").replace(/\s+/g,"_")}.pdf`;
    pdf.save(fileName);
  }catch(err){
    console.error(err);
    alert("Une erreur est survenue lors de la génération du PDF. Vous pouvez réessayer, ou utiliser l'impression classique en dépannage.");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

/* ===================== EXPORT PDF DIRECT DU BULLETIN (A4 portrait forcé, page toujours remplie) =====================
   Comme pour le diplôme : window.print() ne garantit pas que le contenu (mis en page en flex pour
   pousser le cadre "Décision du conseil" et la signature vers le bas de la page) remplisse bien
   toute la hauteur A4 une fois imprimé — cela dépend du moteur d'impression du navigateur/appareil.
   On capture donc le bulletin (élément .bulletin-page) avec html2canvas, en lui imposant temporairement
   les dimensions exactes d'une page A4 (210mm x 297mm), puis on construit nous-mêmes le PDF avec jsPDF :
   le rendu est alors garanti identique quel que soit l'appareil, et la page est toujours pleine. */
async function downloadBulletinPDF(s, b, btn){
  const pageEl = document.querySelector(".bulletin-page");
  if(!pageEl){ alert("Bulletin introuvable à l'export."); return; }
  if(!window.html2canvas || !window.jspdf){
    alert("La génération de PDF n'a pas pu être chargée. Vérifiez votre connexion internet au moins une fois, puis réessayez (elle sera ensuite disponible hors-ligne).");
    return;
  }
  const originalLabel = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "⏳ Génération du PDF…"; }
  try{
    const prevStyle = pageEl.getAttribute("style")||"";
    pageEl.style.width="210mm";
    pageEl.style.height="297mm";
    pageEl.style.minHeight="297mm";
    pageEl.style.padding="14mm 16mm 16mm";
    pageEl.style.margin="0";

    const canvas = await html2canvas(pageEl, { scale: 3, useCORS: true, backgroundColor: "#ffffff" });

    pageEl.setAttribute("style", prevStyle);

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    const trimestreLabel = (b.trimestre || b.periode || "").replace(/\s+/g,"_");
    const fileName = `Bulletin_${(s.nom||"").replace(/\s+/g,"_")}_${(s.prenom||"").replace(/\s+/g,"_")}${trimestreLabel? "_"+trimestreLabel:""}.pdf`;
    pdf.save(fileName);
  }catch(err){
    console.error(err);
    alert("Une erreur est survenue lors de la génération du PDF. Vous pouvez réessayer, ou utiliser l'impression classique en dépannage.");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

/* ===================== EXPORT PDF DIRECT DE LA QUITTANCE (A4 portrait forcé, page toujours remplie) =====================
   Même principe que pour le bulletin : on impose temporairement à .quittance-page les dimensions
   exactes d'une page A4 (210mm x 297mm) puis on capture avec html2canvas avant de construire le
   PDF nous-mêmes avec jsPDF, pour garantir que la page téléchargée est toujours pleine, quel que
   soit l'appareil, sans passer par la boîte de dialogue d'impression du navigateur. */
async function downloadReceiptPDF(p, s, btn){
  const pageEl = document.querySelector(".quittance-page");
  if(!pageEl){ alert("Quittance introuvable à l'export."); return; }
  if(!window.html2canvas || !window.jspdf){
    alert("La génération de PDF n'a pas pu être chargée. Vérifiez votre connexion internet au moins une fois, puis réessayez (elle sera ensuite disponible hors-ligne).");
    return;
  }
  const originalLabel = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "⏳ Génération du PDF…"; }
  try{
    const prevStyle = pageEl.getAttribute("style")||"";
    pageEl.style.width="210mm";
    pageEl.style.height="297mm";
    pageEl.style.minHeight="297mm";
    pageEl.style.padding="10mm 12mm";
    pageEl.style.margin="0";
    pageEl.style.display="flex";
    pageEl.style.flexDirection="column";
    pageEl.style.justifyContent="center";

    const canvas = await html2canvas(pageEl, { scale: 3, useCORS: true, backgroundColor: "#ffffff" });

    pageEl.setAttribute("style", prevStyle);

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    const fileName = `Quittance_${esc(p.receiptNo||p.id)}_${(s?s.nom:"").replace(/\s+/g,"_")}_${(s?s.prenom:"").replace(/\s+/g,"_")}.pdf`;
    pdf.save(fileName);
  }catch(err){
    console.error(err);
    alert("Une erreur est survenue lors de la génération du PDF. Vous pouvez réessayer, ou utiliser l'impression classique en dépannage.");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

/* ===================== IMPRESSION : attestation / diplôme ===================== */
function certificateHTML(id, kind){
  const s = studentById(id);
  if(!s) return `<div class="wrap" style="padding:24px;">Élève introuvable. <button class="btn btn-ghost no-print" data-action="back-to-eleves">Retour</button></div>`;
  const isDiplome = kind==="diplome";
  const toolbar = `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="back-to-student" data-id="${s.id}" style="cursor:pointer;">← Retour</span>
      ${isDiplome
        ? `<button class="btn btn-primary" data-action="download-diplome-pdf" data-id="${s.id}" style="margin-left:10px;">⬇️ Télécharger le diplôme en PDF</button>`
        : `<button class="btn btn-primary" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer / Enregistrer en PDF</button>`}
      ${isDiplome? `<div style="margin-top:10px;font-size:12px;color:var(--slate-600);background:var(--slate-50);border:1px solid var(--slate-200);border-radius:8px;padding:8px 12px;max-width:600px;">Le PDF est généré directement en orientation paysage : aucun réglage à faire, il vous suffit de cliquer.</div>`:""}
    </div>`;
  if(isDiplome) return toolbar + diplomeHTML(s);
  return toolbar + `<div class="wrap print-area" style="max-width:720px;padding:10px 16px 60px;">
      <div class="cert">
        ${logoBadgeHTML()}
        <div class="sub">${esc(db.settings.centerName)}</div>
        <h1>Attestation de formation</h1>
        <p>Il est certifié que</p>
        <div class="name">${esc(s.nom)} ${esc(s.prenom)}</div>
        <p>a suivi la formation en<br>
        <b>${esc(filiereName(s.filiereId))}</b><br>
        au sein de ${esc(db.settings.centerName)}, durant l'année scolaire <b>${esc(s.anneeScolaire)}</b>.</p>
        <p>En foi de quoi cette attestation lui est délivrée pour servir et valoir ce que de droit.</p>
        <div class="sig-row"><div>Fait à ${esc(db.settings.site.replace("Site de ",""))}, le ${formatDate(todayISO())}</div><div>Le Directeur</div></div>
      </div>
    </div>`;
}

/* ---- Petits éléments décoratifs vectoriels (SVG) : toujours nets, jamais flous, même imprimés ---- */
function diplomeFlourishSVG(){
  return `<svg viewBox="0 0 100 24" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <path d="M0 12 C 18 12, 22 4, 34 8 C 40 10, 40 15, 34 16 C 28 17.5, 26 13, 32 12" fill="none" stroke="#c79a3f" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="40" cy="12" r="1.7" fill="#c79a3f"/>
    <line x1="46" y1="12" x2="100" y2="12" stroke="#c79a3f" stroke-width="1.1"/>
  </svg>`;
}
function diplomeStarPoints(cx,cy,rOuter,rInner,n){
  const pts=[];
  for(let i=0;i<n*2;i++){
    const r = i%2===0 ? rOuter : rInner;
    const a = (i/(n*2))*2*Math.PI - Math.PI/2;
    pts.push(`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
/* Sceau doré (médaille) — décoratif, texte fixe, façon "L'École des Métiers Professionnels" */
function diplomeSealSVG(centerLabel){
  const label = (centerLabel||"L'École des Métiers Professionnels").toUpperCase();
  const words = label.split(" ").reduce((lines,w)=>{
    const last=lines[lines.length-1];
    if(last && (last+" "+w).length<=16){ lines[lines.length-1]=last+" "+w; } else { lines.push(w); }
    return lines;
  },[]).slice(0,3);
  const scallop = diplomeStarPoints(60,60,58,52,24);
  let starsRow="";
  for(let i=0;i<5;i++){ starsRow += `<text x="${34+i*13}" y="97" font-size="7" fill="#7a5a12" text-anchor="middle">★</text>`; }
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sealGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f3d987"/><stop offset="50%" stop-color="#c79a3f"/><stop offset="100%" stop-color="#8a6a1f"/>
      </linearGradient>
    </defs>
    <polygon points="${scallop}" fill="url(#sealGold)"/>
    <circle cx="60" cy="60" r="50" fill="url(#sealGold)" stroke="#7a5a12" stroke-width="1"/>
    <circle cx="60" cy="60" r="44" fill="none" stroke="#fdf3d6" stroke-width="1"/>
    <circle cx="60" cy="60" r="41" fill="#0d1b3d" stroke="#c79a3f" stroke-width="1"/>
    <text x="60" y="30" font-family="Georgia, serif" font-size="9" fill="#c79a3f" text-anchor="middle">♛</text>
    <path d="M22 60 Q30 40 60 40 Q90 40 98 60" fill="none" stroke="#c79a3f" stroke-width="1"/>
    ${words.map((w,i)=>`<text x="60" y="${52+i*11}" font-family="Poppins, Arial, sans-serif" font-weight="700" font-size="8.5" fill="#fdf3d6" text-anchor="middle" letter-spacing=".3">${esc(w)}</text>`).join("")}
    <path d="M22 60 Q30 80 60 80 Q90 80 98 60" fill="none" stroke="#c79a3f" stroke-width="1"/>
    ${starsRow}
  </svg>`;
}
/* Coin haut-gauche : grand élément géométrique bleu marine (#0B1F4D) avec courbe dorée élégante — vectoriel, net à l'impression */
function diplomeCornerTLSVG(){
  return `<svg viewBox="0 0 108 140" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="tlGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f6e2a4"/><stop offset="45%" stop-color="#c79a3f"/><stop offset="100%" stop-color="#8a6a1f"/>
      </linearGradient>
    </defs>
    <path d="M0,0 L54,0 C39,4 25,19 15,44 C7,65 3,88 0,118 Z" fill="#0B1F4D"/>
    <path d="M54,0 C39,4 25,19 15,44 C7,65 3,88 0,118" fill="none" stroke="url(#tlGold)" stroke-width="2"/>
    <path d="M67,0 C48,5 31,23 19,50 C10,71 5,92 9,118" fill="none" stroke="url(#tlGold)" stroke-width=".9"/>
  </svg>`;
}
/* Coin bas-droit : plusieurs bandes courbes bleu marine superposées, liserés dorés métalliques, effet de mouvement */
function diplomeCornerBRSVG(){
  return `<svg viewBox="0 0 160 124" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="brGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f6e2a4"/><stop offset="45%" stop-color="#c79a3f"/><stop offset="100%" stop-color="#8a6a1f"/>
      </linearGradient>
    </defs>
    <path d="M160,124 L160,26 C136,33 114,58 98,90 C88,110 76,120 62,124 Z" fill="#0B1F4D"/>
    <path d="M160,26 C136,33 114,58 98,90 C88,110 76,120 62,124" fill="none" stroke="url(#brGold)" stroke-width="1.4"/>
    <path d="M160,124 L160,50 C140,56 121,76 108,102 C100,117 91,122 80,124 Z" fill="#12275a" opacity=".92"/>
    <path d="M160,50 C140,56 121,76 108,102 C100,117 91,122 80,124" fill="none" stroke="url(#brGold)" stroke-width="1.4"/>
    <path d="M160,124 L160,74 C144,79 128,94 118,114 C112,122 105,124 98,124 Z" fill="#0a1730"/>
    <path d="M160,74 C144,79 128,94 118,114 C112,122 105,124 98,124" fill="none" stroke="url(#brGold)" stroke-width="1.4"/>
  </svg>`;
}
/* Grande vague bleu marine en bas du diplôme (~17% de la hauteur) avec courbes dorées parallèles, fines et métalliques */
function diplomeWaveSVG(){
  return `<svg viewBox="0 0 990 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="waveGold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#8a6a1f"/><stop offset="50%" stop-color="#f6e2a4"/><stop offset="100%" stop-color="#8a6a1f"/>
      </linearGradient>
    </defs>
    <path d="M0,34 C140,10 260,52 400,28 C540,4 640,50 780,26 C860,12 930,28 990,18 L990,100 L0,100 Z" fill="#0B1F4D"/>
    <path d="M0,30 C140,6 260,48 400,24 C540,0 640,46 780,22 C860,8 930,24 990,14" fill="none" stroke="url(#waveGold)" stroke-width="1.4" opacity=".95"/>
    <path d="M0,42 C140,18 260,60 400,36 C540,12 640,58 780,34 C860,20 930,36 990,26" fill="none" stroke="url(#waveGold)" stroke-width="1" opacity=".7"/>
    <path d="M0,54 C140,30 260,72 400,48 C540,24 640,70 780,46 C860,32 930,48 990,38" fill="none" stroke="url(#waveGold)" stroke-width=".7" opacity=".5"/>
  </svg>`;
}
/* Ornements dorés très subtils, centre-haut et centre-bas */
function diplomeOrnTopSVG(){
  return `<svg viewBox="0 0 220 26" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ornGold1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#c79a3f" stop-opacity="0"/><stop offset="50%" stop-color="#c79a3f"/><stop offset="100%" stop-color="#c79a3f" stop-opacity="0"/>
    </linearGradient></defs>
    <line x1="0" y1="13" x2="82" y2="13" stroke="url(#ornGold1)" stroke-width="1"/>
    <line x1="138" y1="13" x2="220" y2="13" stroke="url(#ornGold1)" stroke-width="1"/>
    <circle cx="96" cy="13" r="2" fill="#c79a3f"/>
    <polygon points="110,4 119,13 110,22 101,13" fill="#c79a3f"/>
    <circle cx="124" cy="13" r="2" fill="#c79a3f"/>
  </svg>`;
}
function diplomeOrnBottomSVG(){
  return `<svg viewBox="0 0 180 20" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ornGold2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f6e2a4" stop-opacity="0"/><stop offset="50%" stop-color="#f6e2a4"/><stop offset="100%" stop-color="#f6e2a4" stop-opacity="0"/>
    </linearGradient></defs>
    <line x1="0" y1="10" x2="66" y2="10" stroke="url(#ornGold2)" stroke-width=".9"/>
    <line x1="114" y1="10" x2="180" y2="10" stroke="url(#ornGold2)" stroke-width=".9"/>
    <circle cx="90" cy="10" r="2.6" fill="none" stroke="#f6e2a4" stroke-width=".9"/>
  </svg>`;
}
/* Emblème officiel stylisé (navy/or) — écusson générique avec laurier et étoile, toujours net à l'impression */
function beninCoatOfArmsSVG(){
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="emblemGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f3d987"/><stop offset="55%" stop-color="#c79a3f"/><stop offset="100%" stop-color="#8a6a1f"/>
      </linearGradient>
    </defs>
    <path d="M50 4 L90 16 L90 46 C90 72 73 90 50 97 C27 90 10 72 10 46 L10 16 Z" fill="#0d1b3d" stroke="url(#emblemGold)" stroke-width="3"/>
    <path d="M50 12 L82 22 L82 46 C82 67 68 82 50 88 C32 82 18 67 18 46 L18 22 Z" fill="#122253"/>
    <path d="M50 24 L58 40 L76 42 L62 54 L66 72 L50 62 L34 72 L38 54 L24 42 L42 40 Z" fill="url(#emblemGold)"/>
    <path d="M22 50 C28 62 38 70 50 74" fill="none" stroke="url(#emblemGold)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M78 50 C72 62 62 70 50 74" fill="none" stroke="url(#emblemGold)" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="22" cy="49" r="2.4" fill="url(#emblemGold)"/><circle cx="26" cy="58" r="2.2" fill="url(#emblemGold)"/><circle cx="33" cy="66" r="2" fill="url(#emblemGold)"/>
    <circle cx="78" cy="49" r="2.4" fill="url(#emblemGold)"/><circle cx="74" cy="58" r="2.2" fill="url(#emblemGold)"/><circle cx="67" cy="66" r="2" fill="url(#emblemGold)"/>
  </svg>`;
}

/* ---- Diplôme : reproduction fidèle du modèle fourni (A4 paysage), variables paramétrées ----
   Contenu modifiable (variables) : nom/prénom, date & lieu de naissance, matricule, photo,
     filière, session, mention, date de délibération du jury, date & lieu de délivrance,
     logo du centre (+ filigrane), nom du centre, nom du directeur.
   Contenu fixe (identique au modèle, non modifiable) : mise en page, couleurs, ministère,
     armoiries, texte des "Vu" légaux, sceau, formules protocolaires.
   Le diplôme sort SANS signature : le directeur signe à la main après impression. */
function diplomeHTML(s){
  const nom = s.nom ? esc(s.nom) : "……………………";
  const prenom = s.prenom ? esc(s.prenom) : "……………………";
  const dateNaiss = s.dateNaissance ? formatDate(s.dateNaissance) : "…………………";
  const lieuNaiss = s.lieuNaissance ? esc(s.lieuNaissance) : "…………………";
  const matricule = s.matricule ? esc(s.matricule) : "…………";
  const filiere = esc(filiereName(s.filiereId)||"…………………");
  const session = s.session ? esc(s.session) : "…………………";
  const mention = s.mention ? esc(s.mention) : "…………………";
  const dateDelivrance = s.diplomeDate ? formatDate(s.diplomeDate) : formatDate(todayISO());
  const dateJury = s.diplomeDate ? formatDate(s.diplomeDate) : formatDate(todayISO());
  const lieuDelivrance = esc((db.settings.site||"").replace("Site de ",""));
  const anneeDelivrance = (s.diplomeDate ? s.diplomeDate.slice(0,4) : todayISO().slice(0,4));
  const centerName = esc(db.settings.centerName||"CENTRE");
  const centerAbbr = (db.settings.centerName||"CENTRE").split(/[^A-Za-zÀ-ÿ]+/)[0].toUpperCase() || "CENTRE";
  const numeroDiplome = `……………/${anneeDelivrance}/MESTFP/${centerAbbr}/DG/SA`;
  const photo = s.photo ? `<img src="${s.photo}" alt="Photo de l'élève">` : `<div class="ph-placeholder">👤</div>`;
  const logoHTML = db.settings.logo
    ? `<img src="${esc(db.settings.logo)}" alt="Logo">`
    : `<div class="logo-badge" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--navy-950),var(--navy-700) 55%,var(--orange-500));color:#fff;font-family:var(--font-head);font-weight:800;">ES</div>`;
  /* filigrane : le logo du centre répété en petit motif, jamais une seule grande image floue */
  const wm = db.settings.logo ? `<div class="diplome-wm" style="background-image:url('${esc(db.settings.logo)}');"></div>` : "";
  const directeur = (db.settings.directeur||"").trim();

  return `<div class="diplome-scale-wrap"><div class="diplome-canvas print-area">
    <div class="diplome-bgline"></div>
    ${wm}
    <div class="diplome-corner-tl">${diplomeCornerTLSVG()}</div>
    <div class="diplome-corner-br">${diplomeCornerBRSVG()}</div>
    <div class="diplome-wave">${diplomeWaveSVG()}</div>
    <div class="diplome-orn-top">${diplomeOrnTopSVG()}</div>
    <div class="diplome-orn-bottom">${diplomeOrnBottomSVG()}</div>
    <div class="diplome-border"></div>
    <div class="diplome-seal">${diplomeSealSVG(db.settings.centerSubtitle)}</div>
    <div class="diplome-photo-logo">${logoHTML}</div>
    <div class="diplome-photo-box">${photo}</div>

    <div class="diplome-header">
      <div class="diplome-header-left">
        <div class="diplome-header-left-logo"><img src="${MINISTERE_LOGO}" alt="Ministère des Enseignements Secondaire, Technique et de la Formation Professionnelle — République du Bénin"></div>
      </div>
      <div class="diplome-header-center">Centre de Formation<br>Appliquée et Professionnelle<div class="diplome-mini-orn"><span>❖</span></div></div>
    </div>

    <div class="diplome-title-wrap">
      <div class="diplome-flourish">${diplomeFlourishSVG()}</div>
      <div class="diplome-title">DIPLÔME</div>
      <div class="diplome-flourish" style="transform:scaleX(-1);">${diplomeFlourishSVG()}</div>
    </div>
    <div class="diplome-numero">N° ${numeroDiplome}</div>

    <div class="diplome-directeur-line">Le Directeur du ${centerName}&nbsp;:</div>
    <ul class="diplome-vu-list">
      <li>Vu la loi N° 2003-97 du 11 Novembre 2003 portant orientation de l'Éducation Nationale en République du Bénin ;</li>
      <li>Vu l'arrêté Ministériel No 105/MESTFP/DC/SG/MDIPIQ/DET/FP/DPAF/SGSISA/045SGG22 portant création et ouverture du Centre Privé de Formation Appliquée et Professionnelle ${centerName} ;</li>
      <li>Vu les validations théoriques et pratiques éliminées par l'impétrant ;</li>
      <li>Vu les procès-verbaux de stage, de soutenances et de délibération des membres du jury en date du <span class="diplome-id">${dateJury}</span> ;</li>
    </ul>

    <div class="diplome-statement">Soussigné, atteste que le nommé&nbsp;: <span class="diplome-id">${nom} ${prenom}</span> né(e) le <span class="diplome-id">${dateNaiss}</span> à <span class="diplome-id">${lieuNaiss}</span>, Mle&nbsp;: <span class="diplome-id">${matricule}</span></div>

    <div class="diplome-body">a satisfait avec succès les contrôles de connaissances et des aptitudes prévus par les textes réglementaires, en vue de son inscription en&nbsp;: <span class="diplome-highlight">${filiere}</span>, session de&nbsp;: <span class="diplome-id">${session}</span></div>

    <div class="diplome-fmrow">Le jury après délibération lui décerne la mention&nbsp;: <span class="diplome-highlight">${mention}</span></div>

    <div class="diplome-final">En foi de quoi, ce diplôme lui est délivré pour servir et valoir ce que de droit.</div>

    <div class="diplome-fait-line">Fait à <span class="diplome-id">${lieuDelivrance||"……………"}</span>, le <span class="diplome-id">${dateDelivrance}</span>.</div>

    <div class="diplome-footer">
      <div class="diplome-sign-label">Le Directeur</div>
      <div class="diplome-sign-line"></div>
      <div class="diplome-sign-name">${directeur? esc(directeur) : ""}</div>
    </div>
  </div></div>`;
}

/* ===================== IMPRESSION : quittance de paiement (2 exemplaires, même numéro) ===================== */
function receiptCopyHTML(p, s, soldeApres, label){
  return `<div class="doc-header" style="margin-bottom:10px;">
        ${logoBadgeHTML()}<div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div>
      </div>
      <div class="row" style="margin-bottom:4px;">
        <h2 style="font-family:var(--font-head);font-size:15.5px;color:var(--navy-950);margin:0;">Quittance de paiement</h2>
        <span class="pill pill-blue">${esc(label)}</span>
      </div>
      <div style="font-size:11.5px;color:var(--slate-500);margin-bottom:10px;">N° ${esc(p.receiptNo||p.id)} · Émise le ${formatDate(todayISO())}</div>
      <div class="grid2" style="margin-bottom:10px;">
        <div style="font-size:12.5px;"><b>Élève :</b> ${s? esc(s.nom)+" "+esc(s.prenom) : "-"}</div>
        <div style="font-size:12.5px;"><b>Matricule :</b> ${s? esc(s.matricule) : "-"}</div>
        <div style="font-size:12.5px;"><b>Filière :</b> ${s? esc(filiereName(s.filiereId)) : "-"}</div>
        <div style="font-size:12.5px;"><b>Date du paiement :</b> ${formatDate(p.date)}</div>
      </div>
      <table style="margin-bottom:10px;"><thead><tr><th>Détail</th><th>Valeur</th></tr></thead><tbody>
        <tr><td>Montant reçu</td><td style="font-weight:800;">${formatFCFA(p.montant)}</td></tr>
        <tr><td>Mode de paiement</td><td>${esc(p.mode||"-")}</td></tr>
        ${p.note? `<tr><td>Motif / Note</td><td>${esc(p.note)}</td></tr>`:""}
        <tr><td>Solde restant après ce versement</td><td style="font-weight:800;">${formatFCFA(soldeApres>0?soldeApres:0)}</td></tr>
      </tbody></table>
      <div class="sig-row" style="margin-top:20px;"><div>Signature du secrétariat</div><div>Cachet du centre</div></div>`;
}
function receiptHTML(id){
  const p = paymentById(id);
  if(!p) return `<div class="wrap" style="padding:24px;">Paiement introuvable. <button class="btn btn-ghost no-print" data-action="back-to-eleves">Retour</button></div>`;
  const s = studentById(p.studentId);
  const paidBefore = db.payments.filter(x=>x.studentId===p.studentId && (x.date<p.date || (x.date===p.date && x.id<p.id))).reduce((sum,x)=>sum+Number(x.montant||0),0);
  const total = s? studentTotal(s) : 0;
  const soldeApres = total - (paidBefore + Number(p.montant||0));
  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="${s?'back-to-student':'back-to-eleves'}" data-id="${s?s.id:''}" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="download-receipt-pdf" data-id="${p.id}" style="margin-left:10px;">⬇️ Télécharger la quittance en PDF</button>
      <button class="btn btn-ghost" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer</button>
      <div style="margin-top:10px;font-size:12px;color:var(--slate-600);background:var(--slate-50);border:1px solid var(--slate-200);border-radius:8px;padding:8px 12px;max-width:600px;">Le PDF est généré directement au format A4 portrait, page remplie : aucun réglage à faire, il vous suffit de cliquer.</div>
    </div>
    <div class="quittance-page print-area">
      <div class="quittance-slot">
        ${receiptCopyHTML(p, s, soldeApres, "Exemplaire — Élève")}
      </div>
      <div class="quittance-cut">✂️ Même quittance N° ${esc(p.receiptNo||p.id)} — à découper</div>
      <div class="quittance-slot">
        ${receiptCopyHTML(p, s, soldeApres, "Exemplaire — Administration")}
      </div>
    </div>`;
}

/* ===================== IMPRESSION : bulletin ===================== */
function bulletinWatermarkHTML(){
  const logo = db.settings.logo || "logo.png";
  return `<div class="bulletin-watermark" style="background-image:url('${logo}');"></div>`;
}
function bulletinStats(s, b){
  const groupe = activeStudents().filter(st=> st.filiereId===s.filiereId).map(st=>{
    const bb = (st.bulletins||[]).find(x=> (x.trimestre||x.periode)===(b.trimestre||b.periode) && (x.typeEvaluation||"")===(b.typeEvaluation||"") && x.moyenne!=null);
    return bb ? {studentId:st.id, moyenne:Number(bb.moyenne)} : null;
  }).filter(Boolean);
  if(!groupe.length) return {rang:null, effectif:0, moyenneMin:null, moyenneMax:null};
  const sorted = groupe.slice().sort((a,c)=>c.moyenne-a.moyenne);
  const rangIdx = sorted.findIndex(p=>p.studentId===s.id);
  const moyennes = groupe.map(p=>p.moyenne);
  return {
    rang: rangIdx>=0? rangIdx+1 : null,
    effectif: groupe.length,
    moyenneMin: Math.min(...moyennes),
    moyenneMax: Math.max(...moyennes)
  };
}
function bulletinPrintHTML(studentId, bulletinId){
  const s = studentById(studentId);
  const b = bulletinById(studentId, bulletinId);
  if(!s || !b) return `<div class="wrap" style="padding:24px;">Bulletin introuvable. <button class="btn btn-ghost no-print" data-action="back-to-eleves">Retour</button></div>`;
  const isNewFormat = Array.isArray(b.notes) && b.notes.length>0;
  const n = isNewFormat ? b.notes.length : 0;
  const compact = n>11;
  const tdPad = compact? "5px 7px" : "7px 9px";
  const fs = compact? "11.5px" : "12.5px";
  const trimestreLabel = b.trimestre || b.periode || "-";
  const stats = isNewFormat ? bulletinStats(s, b) : {rang:null, effectif:0, moyenneMin:null, moyenneMax:null};
  const nbEvaluees = isNewFormat ? b.notes.filter(nt=>nt.note!=null).length : 0;
  const seuilAtteint = b.moyenne!=null ? (b.moyenne>=10? "Oui":"Non") : "-";

  const headerHTML = `
    <div class="bh2">
      <div class="bh2-left">
        <div class="bh2-ministere-logo"><img src="${MINISTERE_LOGO}" alt="Ministère des Enseignements Secondaire, Technique et de la Formation Professionnelle"></div>
      </div>
      <div class="bh2-center">${db.settings.logo? `<img src="${esc(db.settings.logo)}">` : logoBadgeHTML()}</div>
      <div class="bh2-right">
        <div class="bh2-flag">🇧🇯</div>
        <div class="bh2-info">
          ANNÉE SCOLAIRE : ${esc(s.anneeScolaire)}<br>
          N° MATRICULE : ${esc(s.matricule)}<br>
          ÉVALUATION : ${esc(b.typeEvaluation||"-")}
        </div>
      </div>
    </div>
    <div class="bulletin-centerinfo">${esc(db.settings.centerName)}${db.settings.centerSubtitle? " — "+esc(db.settings.centerSubtitle):""}${db.settings.site? " · "+esc(db.settings.site):""}${db.settings.phone? " · "+esc(db.settings.phone):""}</div>
    <div class="bulletin-title">BULLETIN DE NOTES — ${esc((trimestreLabel||"").toUpperCase())}</div>`;

  const bulletinPhoto = s.photo ? `<img src="${s.photo}" alt="Photo de l'élève">` : `<div class="ph-placeholder">👤</div>`;
  const studentInfoHTML = `
    <div class="bulletin-studentinfo">
      <div class="bulletin-studentinfo-col">
        <div><b>Nom de l'élève :</b> ${esc(s.nom)}</div>
        <div><b>Prénoms :</b> ${esc(s.prenom)}</div>
        <div><b>Sexe :</b> ${esc(s.sexe||"-")}</div>
        <div><b>Date de naissance :</b> ${s.dateNaissance? formatDate(s.dateNaissance) : "-"}</div>
        <div><b>Lieu de naissance :</b> ${esc(s.lieuNaissance||"-")}</div>
        <div><b>Redoublant :</b> ${esc(s.redoublant||"Non")}</div>
      </div>
      <div class="bulletin-studentinfo-photo"><div class="bulletin-photo-box">${bulletinPhoto}</div></div>
      <div class="bulletin-studentinfo-col bulletin-studentinfo-col-right">
        <div><b>Filière :</b> ${esc(filiereName(s.filiereId))}</div>
        <div><b>Année scolaire :</b> ${esc(s.anneeScolaire)}</div>
        <div><b>Effectif :</b> ${stats.effectif||"-"}</div>
      </div>
    </div>`;

  let tableHTML;
  if(isNewFormat){
    let sumCoef=0, sumPond=0;
    tableHTML = `
    <div class="bulletin-section-bar">I — MATIÈRES ET COMPÉTENCES</div>
    <table class="bulletin-table" style="font-size:${fs};">
      <thead><tr><th>Matières</th><th style="text-align:center;">Coef</th><th style="text-align:center;">Obtenu /20</th><th style="text-align:center;">Note Coef.</th><th>Appréciations de l'enseignant</th></tr></thead>
      <tbody>
        ${b.notes.map(nt=>{
          const m = matiereOf(s.filiereId, nt.matiereId);
          const noteStr = nt.note!=null ? Number(nt.note).toFixed(2).replace(/\.?0+$/,"") : "-";
          const pond = nt.note!=null ? Number(nt.note)*Number(nt.coef) : null;
          if(pond!=null){ sumCoef += Number(nt.coef); sumPond += pond; }
          const pondStr = pond!=null ? pond.toFixed(2).replace(/\.?0+$/,"") : "-";
          return `<tr><td style="padding:${tdPad};font-weight:600;">${esc(m?m.nom:"Matière supprimée")}</td><td style="padding:${tdPad};text-align:center;">${esc(nt.coef)}</td><td style="padding:${tdPad};text-align:center;">${noteStr}</td><td style="padding:${tdPad};text-align:center;">${pondStr}</td><td style="padding:${tdPad};">${esc(nt.appreciation||"-")}</td></tr>`;
        }).join("")}
      </tbody>
      <tfoot><tr class="bulletin-total-row"><td>TOTAL</td><td style="text-align:center;">${sumCoef||"-"}</td><td></td><td style="text-align:center;">${sumCoef? sumPond.toFixed(2).replace(/\.?0+$/,"") : "-"}</td><td></td></tr></tfoot>
    </table>`;
  } else {
    tableHTML = `<div class="bulletin-section-bar">I — MATIÈRES ET COMPÉTENCES</div>
    <div style="font-size:13px;margin-bottom:14px;padding:8px 0;"><b>Moyenne :</b> ${esc(b.moyenne||"-")}/20</div>`;
  }

  const recapHTML = `
    <div class="bulletin-section-bar">II — RÉCAPITULATIF</div>
    <div class="bulletin-recap-grid">
      <div>Nombre de matières évaluées : <b>${nbEvaluees}</b></div>
      <div>A atteint le seuil de réussite : <b>${seuilAtteint}</b></div>
      <div>Moyenne obtenue : <b>${b.moyenne!=null? esc(b.moyenne)+" / 20" : "-"}</b></div>
      <div>Rang : <b>${stats.rang? esc(stats.rang)+(stats.effectif?"e / "+esc(stats.effectif):"") : "-"}</b></div>
      <div>Plus faible moyenne de la filière : <b>${stats.moyenneMin!=null? esc(stats.moyenneMin.toFixed(2)) : "-"}</b></div>
      <div>Plus forte moyenne de la filière : <b>${stats.moyenneMax!=null? esc(stats.moyenneMax.toFixed(2)) : "-"}</b></div>
    </div>`;

  const conduiteHTML = `
    <div class="bulletin-section-bar">III — CONDUITE ET ATTITUDES</div>
    <div class="bulletin-recap-grid">
      <div>Assiduité : <b>${esc(b.assiduite||"-")}</b></div>
      <div>Discipline : <b>${esc(b.discipline||"-")}</b></div>
    </div>
    <div style="font-size:11.5px;color:var(--slate-700);margin-top:4px;">Défauts majeurs identifiés chez l'élève : ${esc(b.defautsMajeurs||"-")}</div>
    <div style="font-size:11.5px;color:var(--slate-700);margin-top:3px;">Qualités remarquables : ${esc(b.qualitesRemarquables||"-")}</div>`;

  const decisionsArr = Array.isArray(b.decisions) ? b.decisions : (b.decisionConseil ? [b.decisionConseil] : []);
  const decisionListHTML = BULLETIN_DECISIONS.map(d=>{
    const checked = decisionsArr.includes(d);
    return `<div class="bulletin-decision-item"><span class="bulletin-decision-box">${checked? "☑" : "☐"}</span>${esc(d)}</div>`;
  }).join("");
  const directeurNom = (db.settings.directeur||"").trim();

  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="back-to-student" data-id="${s.id}" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="download-bulletin-pdf" data-id="${s.id}" data-bulletin-id="${b.id}" style="margin-left:10px;">⬇️ Télécharger le bulletin en PDF</button>
      <button class="btn btn-ghost" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer</button>
      <div style="margin-top:10px;font-size:12px;color:var(--slate-600);background:var(--slate-50);border:1px solid var(--slate-200);border-radius:8px;padding:8px 12px;max-width:600px;">Le bouton PDF génère un fichier au format A4 exact, page toujours bien remplie. L'impression classique peut varier selon l'appareil.</div>
    </div>
    <div class="print-area bulletin-page" style="padding:8mm 10mm 10mm;">
      ${bulletinWatermarkHTML()}
      <div class="bulletin-content">
        ${headerHTML}
        ${studentInfoHTML}
        ${tableHTML}
        ${recapHTML}
        ${conduiteHTML}
        <div class="bulletin-spacer"></div>
        <div class="bulletin-box bulletin-box-orange">
          <div class="bulletin-box-title">DÉCISION DU CONSEIL</div>
          <div class="bulletin-box-body"><div class="bulletin-decision-list">${decisionListHTML}</div></div>
        </div>
        <div class="bulletin-spacer" style="min-height:10mm;"></div>
        <div class="bulletin-sign-block">
          <div class="bulletin-sign-label">Le Directeur</div>
          <div class="bulletin-sign-line"></div>
          <div class="bulletin-sign-name">${directeurNom? esc(directeurNom) : ""}</div>
        </div>
      </div>
    </div>`;
}

/* ===================== IMPRESSION : bon de dépense / recette ===================== */
function expenseReceiptHTML(id){
  const e = expenseById(id);
  if(!e) return `<div class="wrap" style="padding:24px;">Dépense introuvable. <button class="btn btn-ghost no-print" data-action="back-to-tab" data-tab="depenses">Retour</button></div>`;
  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="back-to-tab" data-tab="depenses" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer / Enregistrer en PDF</button>
    </div>
    <div class="wrap print-area" style="max-width:600px;padding:20px 16px 60px;">
      <div class="doc-header">${logoBadgeHTML()}<div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div></div>
      <h2 style="font-family:var(--font-head);font-size:17px;color:var(--navy-950);margin:0 0 4px;">Bon de dépense</h2>
      <div style="font-size:12px;color:var(--slate-500);margin-bottom:16px;">N° ${esc(e.id)} · Édité le ${formatDate(todayISO())}</div>
      <table style="margin-bottom:14px;"><tbody>
        <tr><td>Date</td><td>${formatDate(e.date)}</td></tr>
        <tr><td>Motif</td><td>${esc(e.motif)}</td></tr>
        <tr><td>Mode</td><td>${esc(e.mode||"-")}</td></tr>
        <tr><td style="font-weight:800;">Montant</td><td style="font-weight:800;">${formatFCFA(e.montant)}</td></tr>
      </tbody></table>
      <div class="sig-row"><div>Signature du bénéficiaire</div><div>Signature du responsable</div></div>
    </div>`;
}
function revenueReceiptHTML(id){
  const r = revenueById(id);
  if(!r) return `<div class="wrap" style="padding:24px;">Recette introuvable. <button class="btn btn-ghost no-print" data-action="back-to-tab" data-tab="recettes">Retour</button></div>`;
  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="back-to-tab" data-tab="recettes" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer / Enregistrer en PDF</button>
    </div>
    <div class="wrap print-area" style="max-width:600px;padding:20px 16px 60px;">
      <div class="doc-header">${logoBadgeHTML()}<div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div></div>
      <h2 style="font-family:var(--font-head);font-size:17px;color:var(--navy-950);margin:0 0 4px;">Reçu de recette</h2>
      <div style="font-size:12px;color:var(--slate-500);margin-bottom:16px;">N° ${esc(r.id)} · Édité le ${formatDate(todayISO())}</div>
      <table style="margin-bottom:14px;"><tbody>
        <tr><td>Date</td><td>${formatDate(r.date)}</td></tr>
        <tr><td>Motif</td><td>${esc(r.motif)}</td></tr>
        <tr><td>Mode</td><td>${esc(r.mode||"-")}</td></tr>
        <tr><td style="font-weight:800;">Montant</td><td style="font-weight:800;">${formatFCFA(r.montant)}</td></tr>
      </tbody></table>
      <div class="sig-row"><div>Signature du versant</div><div>Signature du responsable</div></div>
    </div>`;
}

/* ===================== FILIÈRES & FRAIS ===================== */
function filieresTabHTML(sp){
  return `
  <div class="card">
    <div class="row"><div class="section-title" style="margin:0;">🗂️ Filières de formation</div>
      ${sp==="admin"? `<button class="btn btn-orange btn-sm" data-action="new-filiere">➕ Ajouter</button>`:""}
    </div>
    ${db.filieres.map(f=>{
      const n = activeStudents().filter(s=>s.filiereId===f.id).length;
      const nm = (f.matieres||[]).length;
      return `<div class="row" style="padding:9px 0;border-bottom:1px solid var(--slate-100);">
        <span style="font-size:13px;font-weight:600;">${esc(f.nom)}</span>
        <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="pill pill-blue">${n} élève${n>1?'s':''}</span>
          <button class="btn btn-ghost btn-sm" data-action="manage-matieres" data-id="${f.id}">📚 Matières (${nm})</button>
          ${sp==="admin"? `<button class="btn btn-ghost btn-sm" data-action="edit-filiere" data-id="${f.id}">✏️</button>
          <button class="btn btn-danger btn-sm" data-action="delete-filiere" data-id="${f.id}">🗑️</button>`:""}
        </span>
      </div>`;
    }).join("")}
  </div>
  <div class="card">
    <div class="row"><div class="section-title" style="margin:0;">💳 Frais de formation</div>
      ${sp==="admin"? `<button class="btn btn-orange btn-sm" data-action="new-frais">➕ Ajouter</button>`:""}
    </div>
    ${db.fraisTypes.map(f=>`<div class="row" style="padding:9px 0;border-bottom:1px solid var(--slate-100);">
        <span style="font-size:13px;font-weight:600;">${esc(f.nom)} ${f.filiereId? `<span class="pill pill-amber" style="margin-left:6px;">${esc(filiereName(f.filiereId))}</span>`:`<span class="pill pill-green" style="margin-left:6px;">Toutes filières</span>`}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;font-size:13px;color:var(--navy-900);">${formatFCFA(f.montant)}</span>
          ${sp==="admin"? `<button class="btn btn-ghost btn-sm" data-action="edit-frais" data-id="${f.id}">✏️</button>
          <button class="btn btn-danger btn-sm" data-action="delete-frais" data-id="${f.id}">🗑️</button>`:""}
        </span>
      </div>`).join("")}
  </div>`;
}

/* ===================== GESTION ÉLÈVE (statuts) ===================== */
function gestionEleveTabHTML(sp){
  const actifs = db.students.filter(s=>s.statut==="actif"||!s.statut);
  const stage = db.students.filter(s=>s.statut==="stage");
  const termine = db.students.filter(s=>s.statut==="termine");
  const rowHTML = (s, actions)=>`<div class="row" style="padding:9px 0;border-bottom:1px solid var(--slate-100);">
      <span style="font-size:13px;font-weight:600;">${esc(s.nom)} ${esc(s.prenom)} <span style="color:var(--slate-400);font-weight:500;">· ${esc(filiereName(s.filiereId))}</span></span>
      <span style="display:flex;gap:6px;flex-wrap:wrap;">${actions}</span>
    </div>`;
  return `
  <div class="card">
    <div class="section-title">🎓 En formation (${actifs.length})</div>
    ${actifs.length? actifs.map(s=>rowHTML(s, `
      <button class="btn btn-ghost btn-sm" data-action="student-set-statut" data-id="${s.id}" data-statut="stage">🏭 Envoyer en stage</button>
      <button class="btn btn-ghost btn-sm" data-action="student-set-statut" data-id="${s.id}" data-statut="termine">🏁 Terminer</button>
    `)).join("") : `<div class="empty">Aucun élève en formation.</div>`}
  </div>
  <div class="card">
    <div class="section-title">🏭 En stage (${stage.length})</div>
    ${stage.length? stage.map(s=>rowHTML(s, `
      <button class="btn btn-ghost btn-sm" data-action="student-set-statut" data-id="${s.id}" data-statut="actif">↩️ Terminer le stage</button>
      <button class="btn btn-ghost btn-sm" data-action="student-set-statut" data-id="${s.id}" data-statut="termine">🏁 Terminer la formation</button>
    `)).join("") : `<div class="empty">Aucun élève en stage.</div>`}
  </div>
  <div class="card">
    <div class="section-title">🏁 Formation terminée (${termine.length})</div>
    ${termine.length? termine.map(s=>rowHTML(s, `
      <button class="btn btn-ghost btn-sm" data-action="student-set-statut" data-id="${s.id}" data-statut="actif">↩️ Réactiver</button>
      ${sp==="admin"? `<button class="btn btn-danger btn-sm" data-action="archive-student" data-id="${s.id}">🗄️ Archiver</button>`:""}
    `)).join("") : `<div class="empty">Aucune formation terminée pour le moment.</div>`}
  </div>`;
}

/* ===================== PAIEMENTS (onglet général) ===================== */
function paiementsTabHTML(sp){
  const recents = db.payments.slice().sort((a,b)=> b.date.localeCompare(a.date)).slice(0,25);

  return `
  <div class="card">
    <div class="row">
      <div class="section-title" style="margin:0;">💳 Encaisser un paiement</div>
      <button class="btn btn-orange" data-action="add-payment">➕ Encaisser</button>
    </div>
    <div style="font-size:12.5px;color:var(--slate-500);margin-top:4px;">Cliquez sur "Encaisser", choisissez l'élève dans la liste, puis le motif (frais) qu'il souhaite payer.</div>
  </div>
  <div class="card">
    <div class="section-title">🧾 Paiements récents</div>
    ${recents.length? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Élève</th><th>Montant</th><th>Mode</th><th></th></tr></thead><tbody>
      ${recents.map(p=>{ const s=studentById(p.studentId); return `<tr>
        <td>${formatDate(p.date)}</td>
        <td>${s? esc(s.nom)+" "+esc(s.prenom) : "Élève supprimé"}</td>
        <td style="font-weight:700;">${formatFCFA(p.montant)}</td>
        <td>${esc(p.mode||"-")}</td>
        <td><button class="btn btn-ghost btn-sm" data-action="print-receipt" data-id="${p.id}">🖨️ Quittance</button></td>
      </tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty">Aucun paiement enregistré.</div>`}
  </div>`;
}

/* ===================== DÉPENSES ===================== */
function depensesTabHTML(sp){
  const list = (db.expenses||[]).slice().sort((a,b)=> b.date.localeCompare(a.date));
  return `
  <div class="row" style="margin-bottom:14px;">
    <div class="section-title" style="margin:0;">💸 Dépenses (${list.length})</div>
    ${sp==="secretariat"? `<button class="btn btn-orange" data-action="new-expense">➕ Enregistrer une dépense</button>` : `<span style="font-size:11.5px;color:var(--slate-400);">Enregistrement réservé au secrétariat</span>`}
  </div>
  <div class="card">
    <div class="row"><span style="font-size:13px;color:var(--slate-600);">Total des dépenses</span><span style="font-weight:800;color:var(--red-600);">${formatFCFA(totalExpenses())}</span></div>
  </div>
  <div class="card">
    ${list.length? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Motif</th><th>Montant</th><th>Mode</th><th></th></tr></thead><tbody>
      ${list.map(e=>`<tr>
        <td>${formatDate(e.date)}</td><td>${esc(e.motif)}</td>
        <td style="font-weight:700;color:var(--red-600);">${formatFCFA(e.montant)}</td>
        <td>${esc(e.mode||"-")}</td>
        <td><span style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" data-action="print-expense" data-id="${e.id}">🖨️</button>
          ${sp==="admin"? `<button class="btn btn-danger btn-sm" data-action="delete-expense" data-id="${e.id}">🗑️</button>`:""}
        </span></td>
      </tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Aucune dépense enregistrée.</div>`}
  </div>`;
}

/* ===================== RECETTES ===================== */
function recettesTabHTML(sp){
  const list = (db.revenues||[]).slice().sort((a,b)=> b.date.localeCompare(a.date));
  return `
  <div class="row" style="margin-bottom:14px;">
    <div class="section-title" style="margin:0;">💰 Recettes (${list.length})</div>
    ${sp==="secretariat"? `<button class="btn btn-orange" data-action="new-revenue">➕ Enregistrer une recette</button>` : `<span style="font-size:11.5px;color:var(--slate-400);">Enregistrement réservé au secrétariat</span>`}
  </div>
  <div class="card">
    <div class="row"><span style="font-size:13px;color:var(--slate-600);">Total des recettes</span><span style="font-weight:800;color:var(--emerald-600);">${formatFCFA(totalRevenues())}</span></div>
  </div>
  <div class="card">
    ${list.length? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Motif</th><th>Montant</th><th>Mode</th><th></th></tr></thead><tbody>
      ${list.map(r=>`<tr>
        <td>${formatDate(r.date)}</td><td>${esc(r.motif)}</td>
        <td style="font-weight:700;color:var(--emerald-600);">${formatFCFA(r.montant)}</td>
        <td>${esc(r.mode||"-")}</td>
        <td><span style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" data-action="print-revenue" data-id="${r.id}">🖨️</button>
          ${sp==="admin"? `<button class="btn btn-danger btn-sm" data-action="delete-revenue" data-id="${r.id}">🗑️</button>`:""}
        </span></td>
      </tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Aucune recette enregistrée.</div>`}
  </div>`;
}

/* ===================== DOCUMENTS (bulletins, diplômes, attestations) ===================== */
let documentSearch = "";
function documentsTabHTML(sp){
  const q = documentSearch.trim().toLowerCase();
  let list = activeStudents();
  if(q) list = list.filter(s=> (s.nom+" "+s.prenom+" "+s.matricule).toLowerCase().includes(q));
  list = list.slice().sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));
  return `
  <div class="row" style="margin-bottom:14px;">
    <input class="search-input" placeholder="🔎 Rechercher un élève..." value="${esc(documentSearch)}" oninput="documentSearch=this.value;render();">
  </div>
  <div class="card">
    <div class="section-title">📄 Documents par élève</div>
    <div style="font-size:12.5px;color:var(--slate-500);margin-bottom:10px;">Ouvrez la fiche d'un élève pour enregistrer son bulletin, imprimer son bulletin, son attestation, son diplôme ou son état de paiement.</div>
    ${list.length? `<div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom & prénom</th><th>Filière</th><th></th></tr></thead><tbody>
      ${list.map(s=>`<tr>
        <td>${esc(s.matricule)}</td><td>${esc(s.nom)} ${esc(s.prenom)}</td><td>${esc(filiereName(s.filiereId))}</td>
        <td><button class="btn btn-ghost btn-sm" data-action="open-student" data-id="${s.id}">Ouvrir →</button></td>
      </tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Aucun élève trouvé.</div>`}
  </div>`;
}

/* ===================== CAISSE (fonds réels) ===================== */
function caisseTabHTML(sp){
  const mvts = (db.caisseMovements||[]).slice().sort((a,b)=> b.date.localeCompare(a.date));
  return `
  <div class="balance-box">
    <div><div class="lbl">Fond initial</div><div class="val">${formatFCFA(db.settings.caisseFondInitial)}</div></div>
    <div><div class="lbl">Solde actuel de la caisse</div><div class="val">${formatFCFA(caisseSolde())}</div></div>
  </div>
  <div class="card">
    <div class="section-title">📊 Détail (espèces uniquement)</div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Encaissements élèves (espèces)</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseEspecesEleves())}</span></div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Recettes (espèces)</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseEspecesRecettes())}</span></div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Autres entrées manuelles</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseMouvementsEntrees())}</span></div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Dépenses (espèces)</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseEspecesDepenses())}</span></div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Salaires versés (espèces)</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseEspecesSalaires())}</span></div>
    <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Autres sorties manuelles</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseMouvementsSorties())}</span></div>
  </div>
  <div class="card">
    <div class="row"><div class="section-title" style="margin:0;">🗃️ Mouvements manuels de caisse</div>
      ${sp==="secretariat"? `<span style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" data-action="new-caisse-mvt" data-type="entree">➕ Entrée</button>
        <button class="btn btn-ghost btn-sm" data-action="new-caisse-mvt" data-type="sortie">➖ Sortie</button>
      </span>` : `<span style="font-size:11.5px;color:var(--slate-400);">Gestion de la caisse réservée au secrétariat</span>`}
    </div>
    ${mvts.length? `<div class="table-wrap" style="margin-top:8px;"><table><thead><tr><th>Date</th><th>Motif</th><th>Type</th><th>Montant</th></tr></thead><tbody>
      ${mvts.map(m=>`<tr><td>${formatDate(m.date)}</td><td>${esc(m.motif||"-")}</td>
        <td>${m.type==="entree"? `<span class="pill pill-green">Entrée</span>` : `<span class="pill pill-red">Sortie</span>`}</td>
        <td style="font-weight:700;">${formatFCFA(m.montant)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Aucun mouvement manuel enregistré.</div>`}
  </div>
  ${sp==="admin"? `<div class="card">
    <div class="section-title">⚙️ Fond initial de caisse</div>
    <div class="field"><span>Montant (FCFA)</span><input id="caisse-fond-input" type="number" min="0" value="${db.settings.caisseFondInitial||0}"></div>
    <button class="btn btn-primary btn-full" data-action="save-caisse-fond">💾 Enregistrer</button>
  </div>` : ""}`;
}

/* ===================== RAPPORTS ===================== */
const RAPPORTS_LIST = [
  {id:"effectifs", icon:"🎓", title:"Effectifs des élèves", desc:"Répartition des élèves par filière, sexe et statut.", color:"var(--navy-900)"},
  {id:"impayes", icon:"⚠️", title:"Élèves impayés", desc:"Élèves ayant un solde restant à payer, avec le détail.", color:"var(--red-600)"},
  {id:"salaires", icon:"🧑‍🏫", title:"Salaires payés", desc:"Historique des salaires versés aux enseignants.", color:"var(--orange-500)"},
  {id:"depenses", icon:"💸", title:"Dépenses", desc:"Liste et total des dépenses enregistrées.", color:"var(--red-600)"},
  {id:"recettes", icon:"💰", title:"Recettes", desc:"Liste et total des recettes enregistrées.", color:"var(--emerald-600)"},
  {id:"caisse", icon:"🗃️", title:"Caisse", desc:"Situation de la caisse et mouvements manuels.", color:"var(--navy-700)"},
  {id:"stageTermine", icon:"🏭", title:"Stages terminés", desc:"Élèves ayant terminé leur stage en entreprise.", color:"var(--emerald-600)"},
  {id:"global", icon:"🗒️", title:"Rapport global", desc:"Synthèse complète du centre — tout en un document.", color:"var(--navy-950)"}
];
function rapportsHTML(){
  return `
  <div class="section-title" style="margin-bottom:14px;">📑 Rapports — consultez, imprimez ou téléchargez</div>
  <div class="rapport-grid">
    ${RAPPORTS_LIST.map(r=>`<div class="rapport-card">
      <div class="rapport-ic" style="background:${r.color};">${r.icon}</div>
      <div class="rapport-title">${esc(r.title)}</div>
      <div class="rapport-desc">${esc(r.desc)}</div>
      <button class="btn btn-primary btn-sm btn-full" data-action="open-rapport" data-kind="${r.id}">Ouvrir →</button>
    </div>`).join("")}
  </div>`;
}
let rapportDu = "", rapportAu = "";
function inRapportPeriod(dateStr){
  if(!dateStr) return true;
  if(rapportDu && dateStr < rapportDu) return false;
  if(rapportAu && dateStr > rapportAu) return false;
  return true;
}
function rapportFilterBarHTML(){
  return `<div class="filter-bar no-print">
    <div class="field"><span>Du</span><input type="date" value="${esc(rapportDu)}" onchange="rapportDu=this.value;render();"></div>
    <div class="field"><span>Au</span><input type="date" value="${esc(rapportAu)}" onchange="rapportAu=this.value;render();"></div>
    ${(rapportDu||rapportAu)? `<button class="btn btn-ghost btn-sm" onclick="rapportDu='';rapportAu='';render();">✖️ Effacer la période</button>` : ""}
  </div>`;
}
function rapportMeta(kind){ return RAPPORTS_LIST.find(r=>r.id===kind) || {title:"Rapport", icon:"📑"}; }

function rapportHTML(kind){
  const meta = rapportMeta(kind);
  const spaceTitle = "Espace Admin / Directeur";
  let body = "";
  let csvBtn = `<button class="btn btn-ghost no-print" data-action="export-rapport-csv" data-kind="${kind}">⬇️ Exporter en CSV</button>`;

  if(kind==="effectifs"){
    const students = activeStudents();
    const parSexe = {M: students.filter(s=>s.sexe==='M').length, F: students.filter(s=>s.sexe==='F').length};
    const parStatut = {actif: students.filter(s=>s.statut==='actif').length, stage: students.filter(s=>s.statut==='stage').length, termine: students.filter(s=>s.statut==='termine').length};
    const parFiliere = db.filieres.map(f=>({f, n: students.filter(s=>s.filiereId===f.id).length, m: students.filter(s=>s.filiereId===f.id&&s.sexe==='M').length, fem: students.filter(s=>s.filiereId===f.id&&s.sexe==='F').length}));
    const nonAffectes = students.filter(s=>!s.filiereId).length;
    body = `
    <div class="summary-strip">
      <div class="summary-chip"><div class="lbl">Total élèves actifs</div><div class="val">${students.length}</div></div>
      <div class="summary-chip"><div class="lbl">Garçons / Filles</div><div class="val">${parSexe.M} / ${parSexe.F}</div></div>
      <div class="summary-chip"><div class="lbl">En stage</div><div class="val">${parStatut.stage}</div></div>
      <div class="summary-chip"><div class="lbl">Formation terminée</div><div class="val">${parStatut.termine}</div></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Filière</th><th>Effectif</th><th>Garçons</th><th>Filles</th></tr></thead><tbody>
      ${parFiliere.map(x=>`<tr><td>${esc(x.f.nom)}</td><td style="font-weight:700;">${x.n}</td><td>${x.m}</td><td>${x.fem}</td></tr>`).join("")}
      ${nonAffectes? `<tr><td>Non affectés</td><td style="font-weight:700;">${nonAffectes}</td><td colspan="2">—</td></tr>` : ""}
      <tr><td style="font-weight:800;">Total</td><td style="font-weight:800;">${students.length}</td><td style="font-weight:800;">${parSexe.M}</td><td style="font-weight:800;">${parSexe.F}</td></tr>
    </tbody></table></div>`;
  }
  else if(kind==="impayes"){
    const list = activeStudents().filter(s=>studentBalance(s)>0 && inRapportPeriod(s.dateInscription)).sort((a,b)=>studentBalance(b)-studentBalance(a));
    const totalDu = list.reduce((s,st)=>s+studentTotal(st),0);
    const totalPaye = list.reduce((s,st)=>s+studentPaid(st.id),0);
    const totalReste = totalDu - totalPaye;
    body = rapportFilterBarHTML() + `
    <div class="summary-strip">
      <div class="summary-chip"><div class="lbl">Élèves impayés</div><div class="val">${list.length}</div></div>
      <div class="summary-chip"><div class="lbl">Total dû</div><div class="val">${formatFCFA(totalDu)}</div></div>
      <div class="summary-chip"><div class="lbl">Total payé</div><div class="val">${formatFCFA(totalPaye)}</div></div>
      <div class="summary-chip"><div class="lbl">Reste à payer</div><div class="val" style="color:var(--red-600);">${formatFCFA(totalReste)}</div></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom & prénom</th><th>Filière</th><th>Dû</th><th>Payé</th><th>Solde</th></tr></thead><tbody>
      ${list.length? list.map(s=>`<tr><td>${esc(s.matricule)}</td><td>${esc(s.nom)} ${esc(s.prenom)}</td><td>${esc(filiereName(s.filiereId))}</td><td>${formatFCFA(studentTotal(s))}</td><td>${formatFCFA(studentPaid(s.id))}</td><td style="font-weight:700;color:var(--red-600);">${formatFCFA(studentBalance(s))}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--slate-400);">Aucun élève impayé sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="salaires"){
    const list = db.salaryPayments.filter(p=>inRapportPeriod(p.date)).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const total = list.reduce((s,p)=>s+Number(p.montant||0),0);
    body = rapportFilterBarHTML() + `
    <div class="card" style="margin-bottom:14px;"><div class="row"><span style="font-size:13px;color:var(--slate-600);">Total versé sur la période</span><span style="font-weight:800;color:var(--orange-600);">${formatFCFA(total)}</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Enseignant</th><th>Mois</th><th>Montant</th><th>Mode</th></tr></thead><tbody>
      ${list.length? list.map(p=>{ const t=teacherById(p.teacherId); return `<tr><td>${formatDate(p.date)}</td><td>${t? esc(t.nom)+" "+esc(t.prenom) : "—"}</td><td>${monthLabel(p.mois)}</td><td style="font-weight:700;">${formatFCFA(p.montant)}</td><td>${esc(p.mode||"-")}</td></tr>`; }).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--slate-400);">Aucun salaire versé sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="depenses"){
    const list = (db.expenses||[]).filter(e=>inRapportPeriod(e.date)).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const total = list.reduce((s,e)=>s+Number(e.montant||0),0);
    body = rapportFilterBarHTML() + `
    <div class="card" style="margin-bottom:14px;"><div class="row"><span style="font-size:13px;color:var(--slate-600);">Total des dépenses sur la période</span><span style="font-weight:800;color:var(--red-600);">${formatFCFA(total)}</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Motif</th><th>Montant</th><th>Mode</th></tr></thead><tbody>
      ${list.length? list.map(e=>`<tr><td>${formatDate(e.date)}</td><td>${esc(e.motif)}</td><td style="font-weight:700;color:var(--red-600);">${formatFCFA(e.montant)}</td><td>${esc(e.mode||"-")}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--slate-400);">Aucune dépense sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="recettes"){
    const list = (db.revenues||[]).filter(r=>inRapportPeriod(r.date)).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const total = list.reduce((s,r)=>s+Number(r.montant||0),0);
    body = rapportFilterBarHTML() + `
    <div class="card" style="margin-bottom:14px;"><div class="row"><span style="font-size:13px;color:var(--slate-600);">Total des recettes sur la période</span><span style="font-weight:800;color:var(--emerald-600);">${formatFCFA(total)}</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Motif</th><th>Montant</th><th>Mode</th></tr></thead><tbody>
      ${list.length? list.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${esc(r.motif)}</td><td style="font-weight:700;color:var(--emerald-600);">${formatFCFA(r.montant)}</td><td>${esc(r.mode||"-")}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--slate-400);">Aucune recette sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="caisse"){
    const mvts = (db.caisseMovements||[]).filter(m=>inRapportPeriod(m.date)).slice().sort((a,b)=>b.date.localeCompare(a.date));
    body = `
    <div class="balance-box">
      <div><div class="lbl">Fond initial</div><div class="val">${formatFCFA(db.settings.caisseFondInitial)}</div></div>
      <div><div class="lbl">Solde actuel de la caisse</div><div class="val">${formatFCFA(caisseSolde())}</div></div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="section-title">📊 Détail (espèces uniquement, toutes périodes)</div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Encaissements élèves</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseEspecesEleves())}</span></div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Recettes</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseEspecesRecettes())}</span></div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Autres entrées manuelles</span><span style="font-weight:700;color:var(--emerald-600);">+ ${formatFCFA(caisseMouvementsEntrees())}</span></div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Dépenses</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseEspecesDepenses())}</span></div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Salaires versés</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseEspecesSalaires())}</span></div>
      <div class="row" style="padding:6px 0;"><span style="font-size:12.5px;">Autres sorties manuelles</span><span style="font-weight:700;color:var(--red-600);">- ${formatFCFA(caisseMouvementsSorties())}</span></div>
    </div>
    ${rapportFilterBarHTML()}
    <div class="section-title">🗃️ Mouvements manuels ${(rapportDu||rapportAu)?"(période sélectionnée)":""}</div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Motif</th><th>Type</th><th>Montant</th></tr></thead><tbody>
      ${mvts.length? mvts.map(m=>`<tr><td>${formatDate(m.date)}</td><td>${esc(m.motif||"-")}</td><td>${m.type==="entree"?"Entrée":"Sortie"}</td><td style="font-weight:700;">${formatFCFA(m.montant)}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--slate-400);">Aucun mouvement sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="stageTermine"){
    const list = db.students.filter(s=>s.stageFinDate && inRapportPeriod(s.stageFinDate)).slice().sort((a,b)=>(b.stageFinDate||"").localeCompare(a.stageFinDate||""));
    body = rapportFilterBarHTML() + `
    <div class="card" style="margin-bottom:14px;"><div class="row"><span style="font-size:13px;color:var(--slate-600);">Élèves ayant terminé leur stage</span><span style="font-weight:800;color:var(--navy-950);">${list.length}</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom & prénom</th><th>Filière</th><th>Début du stage</th><th>Fin du stage</th></tr></thead><tbody>
      ${list.length? list.map(s=>`<tr><td>${esc(s.matricule)}</td><td>${esc(s.nom)} ${esc(s.prenom)}</td><td>${esc(filiereName(s.filiereId))}</td><td>${s.stageDebutDate?formatDate(s.stageDebutDate):"-"}</td><td>${formatDate(s.stageFinDate)}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--slate-400);">Aucun élève n'a terminé de stage sur cette période.</td></tr>`}
    </tbody></table></div>`;
  }
  else if(kind==="global"){
    const students = activeStudents();
    const totalDu = students.reduce((s,st)=>s+studentTotal(st),0);
    const totalEncaisse = db.payments.reduce((s,p)=>s+Number(p.montant||0),0);
    const impayesTotal = totalDu - totalEncaisse;
    const salairesVerses = db.salaryPayments.reduce((s,p)=>s+Number(p.montant||0),0);
    csvBtn = "";
    body = `
    <div class="summary-strip">
      <div class="summary-chip"><div class="lbl">Élèves actifs</div><div class="val">${students.length}</div></div>
      <div class="summary-chip"><div class="lbl">Enseignants</div><div class="val">${db.teachers.length}</div></div>
      <div class="summary-chip"><div class="lbl">Total encaissé (élèves)</div><div class="val">${formatFCFA(totalEncaisse)}</div></div>
      <div class="summary-chip"><div class="lbl">Reste à payer (élèves)</div><div class="val" style="color:var(--red-600);">${formatFCFA(impayesTotal)}</div></div>
      <div class="summary-chip"><div class="lbl">Total dépenses</div><div class="val" style="color:var(--red-600);">${formatFCFA(totalExpenses())}</div></div>
      <div class="summary-chip"><div class="lbl">Total recettes</div><div class="val" style="color:var(--emerald-600);">${formatFCFA(totalRevenues())}</div></div>
      <div class="summary-chip"><div class="lbl">Salaires versés</div><div class="val">${formatFCFA(salairesVerses)}</div></div>
      <div class="summary-chip"><div class="lbl">Solde caisse</div><div class="val">${formatFCFA(caisseSolde())}</div></div>
    </div>
    <div class="section-title">🗂️ Effectifs par filière</div>
    <div class="table-wrap"><table><thead><tr><th>Filière</th><th>Effectif</th></tr></thead><tbody>
      ${db.filieres.map(f=>`<tr><td>${esc(f.nom)}</td><td style="font-weight:700;">${students.filter(s=>s.filiereId===f.id).length}</td></tr>`).join("")}
    </tbody></table></div>`;
  }

  return `<div class="wrap no-print" style="padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="link-back" data-action="back-to-tab" data-tab="rapports" style="cursor:pointer;">← Retour aux rapports</span>
      <span style="flex:1;"></span>
      ${csvBtn}
      <button class="btn btn-primary" data-action="do-print">🖨️ Imprimer / Enregistrer en PDF</button>
    </div>
    <div class="wrap print-area" style="max-width:900px;padding:0 16px 60px;">
      <div class="doc-header">${logoBadgeHTML()}<div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div></div>
      <h2 style="font-family:var(--font-head);font-size:18px;color:var(--navy-950);margin:0 0 4px;">${meta.icon} ${esc(meta.title)}</h2>
      <div style="font-size:12px;color:var(--slate-500);margin-bottom:16px;">Édité le ${formatDate(todayISO())}${(rapportDu||rapportAu)? " · Période : "+(rapportDu?formatDate(rapportDu):"…")+" au "+(rapportAu?formatDate(rapportAu):"…") : ""} · Année scolaire ${esc(db.settings.anneeScolaire)}</div>
      ${body}
    </div>`;
}

function exportRapportCSV(kind){
  const meta = rapportMeta(kind);
  let headers = [], rows = [];
  if(kind==="effectifs"){
    headers = ["Filière","Effectif","Garçons","Filles"];
    const students = activeStudents();
    rows = db.filieres.map(f=>[f.nom, students.filter(s=>s.filiereId===f.id).length, students.filter(s=>s.filiereId===f.id&&s.sexe==='M').length, students.filter(s=>s.filiereId===f.id&&s.sexe==='F').length]);
  } else if(kind==="impayes"){
    headers = ["Matricule","Nom","Prénom","Filière","Dû","Payé","Solde"];
    rows = activeStudents().filter(s=>studentBalance(s)>0 && inRapportPeriod(s.dateInscription)).map(s=>[s.matricule,s.nom,s.prenom,filiereName(s.filiereId),studentTotal(s),studentPaid(s.id),studentBalance(s)]);
  } else if(kind==="salaires"){
    headers = ["Date","Enseignant","Mois","Montant","Mode"];
    rows = db.salaryPayments.filter(p=>inRapportPeriod(p.date)).map(p=>{ const t=teacherById(p.teacherId); return [p.date, t?(t.nom+" "+t.prenom):"", monthLabel(p.mois), p.montant, p.mode||""]; });
  } else if(kind==="depenses"){
    headers = ["Date","Motif","Montant","Mode"];
    rows = (db.expenses||[]).filter(e=>inRapportPeriod(e.date)).map(e=>[e.date,e.motif,e.montant,e.mode||""]);
  } else if(kind==="recettes"){
    headers = ["Date","Motif","Montant","Mode"];
    rows = (db.revenues||[]).filter(r=>inRapportPeriod(r.date)).map(r=>[r.date,r.motif,r.montant,r.mode||""]);
  } else if(kind==="caisse"){
    headers = ["Date","Motif","Type","Montant"];
    rows = (db.caisseMovements||[]).filter(m=>inRapportPeriod(m.date)).map(m=>[m.date,m.motif||"",m.type==="entree"?"Entrée":"Sortie",m.montant]);
  } else if(kind==="stageTermine"){
    headers = ["Matricule","Nom","Prénom","Filière","Début du stage","Fin du stage"];
    rows = db.students.filter(s=>s.stageFinDate && inRapportPeriod(s.stageFinDate)).map(s=>[s.matricule,s.nom,s.prenom,filiereName(s.filiereId),s.stageDebutDate||"",s.stageFinDate]);
  }
  if(!rows.length && !headers.length){ showToast("Ce rapport ne propose pas d'export CSV.","err"); return; }
  const csvLines = [headers.join(";")].concat(rows.map(r=>r.map(v=>{
    const s = String(v===undefined||v===null?"":v).replace(/"/g,'""');
    return /[;"\n]/.test(s) ? `"${s}"` : s;
  }).join(";")));
  const blob = new Blob(["\uFEFF"+csvLines.join("\n")], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "easyskill-"+kind+"-"+todayISO()+".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Export CSV téléchargé.");
}

/* ===================== ENSEIGNANTS ===================== */
function teachersTabHTML(sp){
  const list = db.teachers.slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  return `
  <div class="row" style="margin-bottom:14px;">
    <div class="section-title" style="margin:0;">🧑‍🏫 Enseignants (${list.length})</div>
    ${sp==="admin"? `<button class="btn btn-orange" data-action="new-teacher">➕ Nouvel enseignant</button>` : ""}
  </div>
  ${list.length? list.map(t=>{
    const m = monthKeyNow();
    const paidThisMonth = teacherPaidForMonth(t.id, m);
    const isPaid = paidThisMonth >= Number(t.salaireMensuel||0) && Number(t.salaireMensuel||0)>0;
    return `<div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--navy-950);">${esc(t.nom)} ${esc(t.prenom)}</div>
          <div style="font-size:12px;color:var(--slate-500);">${esc(t.matiere||"-")} · ${esc(t.telephone||"-")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;font-size:13px;">${formatFCFA(t.salaireMensuel)}/mois</div>
          ${isPaid? `<span class="pill pill-green">Payé (${monthLabel(m)})</span>` : `<span class="pill pill-red">Non payé (${monthLabel(m)})</span>`}
        </div>
      </div>
      <div class="fab-bottom">
        <button class="btn btn-ghost btn-sm" data-action="open-teacher" data-id="${t.id}">📄 Détail & historique</button>
        <button class="btn btn-orange btn-sm" data-action="pay-salary" data-id="${t.id}">➕ Verser salaire</button>
        ${sp==="admin"? `<button class="btn btn-danger btn-sm" data-action="delete-teacher" data-id="${t.id}">🗑️ Supprimer</button>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="card"><div class="empty">Aucun enseignant enregistré.</div></div>`}
  `;
}

function teacherDetailHTML(id){
  const t = teacherById(id);
  const spaceTitle = role==="admin" ? "Espace Admin / Directeur" : "Espace Secrétariat";
  if(!t) return topBarHTML(spaceTitle) + `<div class="wrap" style="padding:24px;"><div class="empty">Enseignant introuvable.</div></div>`;
  const hist = db.salaryPayments.filter(p=>p.teacherId===id).slice().sort((a,b)=>b.date.localeCompare(a.date));
  const totalVerse = hist.reduce((s,p)=>s+Number(p.montant||0),0);
  const resteAPayer = Number(t.salaireMensuel||0) - teacherPaidForMonth(t.id, monthKeyNow());
  return topBarHTML(spaceTitle) + `<div class="wrap" style="padding:16px 16px 60px;max-width:700px;">
    <span class="link-back no-print" data-action="set-tab" data-tab="enseignants" style="cursor:pointer;">← Retour aux enseignants</span>
    <div class="card">
      <div class="section-title">${esc(t.nom)} ${esc(t.prenom)}</div>
      <div class="grid2">
        <div style="font-size:12.5px;"><b>Matière / filière :</b> ${esc(t.matiere||"-")}</div>
        <div style="font-size:12.5px;"><b>Téléphone :</b> ${esc(t.telephone||"-")}</div>
        <div style="font-size:12.5px;"><b>Salaire mensuel :</b> ${formatFCFA(t.salaireMensuel)}</div>
        <div style="font-size:12.5px;"><b>Date d'embauche :</b> ${formatDate(t.dateEmbauche)}</div>
      </div>
    </div>
    <div class="balance-box">
      <div><div class="lbl">Salaire du mois</div><div class="val">${formatFCFA(t.salaireMensuel)}</div></div>
      <div><div class="lbl">Total versé (tout historique)</div><div class="val">${formatFCFA(totalVerse)}</div></div>
      <div><div class="lbl">Reste ce mois-ci</div><div class="val">${formatFCFA(resteAPayer>0?resteAPayer:0)}</div></div>
    </div>
    <div class="card no-print">
      <div class="row"><div class="section-title" style="margin:0;">💵 Historique des salaires versés</div>
        <span style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" data-action="print-teacher-history" data-id="${t.id}">🖨️ Imprimer l'historique</button>
          <button class="btn btn-orange btn-sm" data-action="pay-salary" data-id="${t.id}">➕ Verser</button>
        </span></div>
      ${hist.length? `<div class="table-wrap"><table><thead><tr><th>Mois</th><th>Date</th><th>Montant</th><th>Note</th></tr></thead><tbody>
        ${hist.map(p=>`<tr><td>${monthLabel(p.mois)}</td><td>${formatDate(p.date)}</td><td style="font-weight:700;">${formatFCFA(p.montant)}</td><td>${esc(p.note||"-")}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Aucun versement enregistré.</div>`}
    </div>
  </div>`;
}

function teacherHistoryPrintHTML(id){
  const t = teacherById(id);
  const spaceTitle = role==="admin" ? "Espace Admin / Directeur" : "Espace Secrétariat";
  if(!t) return topBarHTML(spaceTitle) + `<div class="wrap" style="padding:24px;"><div class="empty">Enseignant introuvable.</div></div>`;
  const hist = db.salaryPayments.filter(p=>p.teacherId===id).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const totalVerse = hist.reduce((s,p)=>s+Number(p.montant||0),0);
  return `<div class="wrap no-print" style="padding:14px 16px;">
      <span class="link-back" data-action="open-teacher" data-id="${t.id}" style="cursor:pointer;">← Retour</span>
      <button class="btn btn-primary" data-action="do-print" style="margin-left:10px;">🖨️ Imprimer / Enregistrer en PDF</button>
    </div>
    <div class="wrap print-area" style="max-width:680px;padding:20px 16px 60px;">
      <div class="doc-header">${logoBadgeHTML()}<div><div class="t1">${esc(db.settings.centerName)}</div><div class="t2">${esc(db.settings.centerSubtitle)} · ${esc(db.settings.site)} · ${esc(db.settings.phone)}</div></div></div>
      <h2 style="font-family:var(--font-head);font-size:17px;color:var(--navy-950);margin:0 0 4px;">Historique des salaires versés</h2>
      <div style="font-size:12px;color:var(--slate-500);margin-bottom:16px;">Édité le ${formatDate(todayISO())}</div>
      <div style="font-size:13px;margin-bottom:14px;"><b>Enseignant :</b> ${esc(t.nom)} ${esc(t.prenom)} · ${esc(t.matiere||"-")}</div>
      <table><thead><tr><th>Mois</th><th>Date</th><th>Montant</th><th>Note</th></tr></thead><tbody>
        ${hist.length? hist.map(p=>`<tr><td>${monthLabel(p.mois)}</td><td>${formatDate(p.date)}</td><td>${formatFCFA(p.montant)}</td><td>${esc(p.note||"-")}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--slate-400);">Aucun versement</td></tr>`}
        <tr><td colspan="2" style="font-weight:800;">Total versé</td><td colspan="2" style="font-weight:800;">${formatFCFA(totalVerse)}</td></tr>
      </tbody></table>
      <div class="sig-row"><div>Signature du secrétariat</div><div>Cachet du centre</div></div>
    </div>`;
}

/* ===================== PARAMÈTRES ===================== */
function settingsHTML(){
  const s = db.settings;
  return `<div class="card">
    <div class="section-title">⚙️ Paramètres du centre</div>
    <div class="field"><span>Nom du centre</span><input id="set-name" value="${esc(s.centerName)}"></div>
    <div class="field"><span>Sous-titre</span><input id="set-subtitle" value="${esc(s.centerSubtitle)}"></div>
    <div class="field"><span>Site / adresse</span><input id="set-site" value="${esc(s.site)}"></div>
    <div class="field"><span>Téléphone</span><input id="set-phone" value="${esc(s.phone)}"></div>
    <div class="field"><span>Nom du Directeur</span><input id="set-directeur" placeholder="Ex : M. Adépoiou ADETAYO" value="${esc(s.directeur)}"></div>
    <div style="font-size:11px;color:var(--slate-500);margin:-6px 0 12px;">Ce nom apparaît automatiquement sur les diplômes, à la signature « Le Directeur ».</div>
    <div class="field"><span>Année scolaire</span><input id="set-annee" value="${esc(s.anneeScolaire)}"></div>
    <div class="field">
      <span>Logo du centre (image)</span>
      <div style="display:flex;align-items:center;gap:12px;">
        ${s.logo? `<img src="${esc(s.logo)}" style="width:52px;height:52px;border-radius:12px;object-fit:cover;border:1.5px solid var(--slate-200);flex-shrink:0;">` : ""}
        <input type="file" id="set-logo" accept="image/*" style="flex:1;">
      </div>
      <div style="font-size:11px;color:var(--slate-500);margin-top:4px;">Ce logo apparaît sur les bulletins et les diplômes des élèves (pas sur l'écran de démarrage, qui garde le logo EasySkill).</div>
    </div>
    <button class="btn btn-primary btn-full" data-action="save-settings">💾 Enregistrer</button>
  </div>
  <div class="card">
    <div class="section-title">🔐 Codes d'accès des espaces</div>
    <div class="field"><span>Code Espace Admin / Directeur</span><input id="set-pin-admin" value="${esc(s.pinAdmin)}"></div>
    <div class="field"><span>Code Espace Secrétariat</span><input id="set-pin-sec" value="${esc(s.pinSecretariat)}"></div>
    <button class="btn btn-primary btn-full" data-action="save-pins">💾 Mettre à jour les codes</button>
  </div>
  <div class="card">
    <div class="section-title">📦 Données</div>
    <div style="font-size:12.5px;color:var(--slate-500);margin-bottom:10px;">Exportez une sauvegarde de toutes les données (élèves, paiements, enseignants) au format JSON.</div>
    <button class="btn btn-ghost btn-full" data-action="export-data">⬇️ Exporter les données</button>
  </div>
  ${licenseEnforced() ? licenseSettingsCardHTML() : ""}`;
}
function licenseSettingsCardHTML(){
  const valid = licenseIsValid();
  const days = licenseDaysLeft();
  let statusLine;
  if(!licenseCache || licenseCache.status==="inactive") statusLine = `<span style="color:var(--red-600);font-weight:700;">Non activée</span>`;
  else if(!valid) statusLine = `<span style="color:var(--red-600);font-weight:700;">Expirée</span>`;
  else if(licenseCache.expiresAt===null) statusLine = `<span style="color:#15803d;font-weight:700;">Active — illimitée</span>`;
  else statusLine = `<span style="color:#15803d;font-weight:700;">Active</span> — expire le ${formatDate(licenseCache.expiresAt)}${days!==null?` (${days} j restants)`:""}`;
  return `<div class="card">
    <div class="section-title">🔑 Licence</div>
    <div style="font-size:13px;color:var(--slate-700);margin-bottom:10px;">${statusLine}</div>
    ${licenseCache&&licenseCache.key? `<div style="font-size:11.5px;color:var(--slate-500);margin-bottom:10px;">Code actuel : ${esc(licenseCache.key)}</div>` : ""}
    ${licenseError? `<p style="color:var(--red-600);font-size:12.5px;font-weight:700;">${esc(licenseError)}</p>`:""}
    <div class="field"><span>Nouveau code d'activation (renouvellement)</span>
      <input id="license-renew-input" inputmode="numeric" maxlength="8" placeholder="12345678"></div>
    <button class="btn btn-primary btn-full" data-action="submit-license-settings" ${licenseActivating?"disabled":""}>${licenseActivating?"Vérification…":"✅ Activer ce code"}</button>
    <button class="btn btn-ghost btn-full" style="margin-top:8px;" data-action="license-refresh">🔄 Revérifier maintenant</button>
  </div>`;
}

/* ===================== MODALS ===================== */
function modalHTML(){
  if(!modalState) return "";
  const t = modalState.type;
  let inner = "";
  if(t==="pin") inner = pinModalHTML();
  else if(t==="installHelp") inner = installHelpModalHTML();
  else if(t==="newStudent") inner = studentFormModalHTML();
  else if(t==="editStudent") inner = studentFormModalHTML(true);
  else if(t==="addPayment") inner = paymentFormModalHTML();
  else if(t==="newTeacher") inner = teacherFormModalHTML();
  else if(t==="paySalary") inner = salaryFormModalHTML();
  else if(t==="newFiliere" || t==="editFiliere") inner = filiereFormModalHTML();
  else if(t==="newFrais" || t==="editFrais") inner = fraisFormModalHTML();
  else if(t==="newBulletin") inner = bulletinFormModalHTML();
  else if(t==="manageMatieres") inner = matieresModalHTML();
  else if(t==="newExpense") inner = expenseFormModalHTML();
  else if(t==="newRevenue") inner = revenueFormModalHTML();
  else if(t==="newCaisseMvt") inner = caisseMvtFormModalHTML();
  else if(t==="confirm") inner = confirmModalHTML();
  else if(t==="importReview") inner = importReviewModalHTML();
  return `<div class="modal-overlay no-print" data-action="modal-overlay">
    <div class="modal-box${t==="importReview"?" modal-box-wide":""}">${inner}</div>
  </div>`;
}

function pinModalHTML(){
  const label = modalState.mode==="admin" ? "Espace Admin / Directeur" : "Espace Secrétariat";
  return `<div class="modal-title">🔐 ${label}</div>
    <p style="font-size:13px;color:var(--slate-500);text-align:center;">Entrez le code d'accès à 4 chiffres.</p>
    ${modalState.error? `<p style="color:var(--red-600);font-size:12.5px;text-align:center;font-weight:700;">${esc(modalState.error)}</p>`:""}
    <div class="pin-dots">
      ${[0,1,2,3].map(i=>`<input id="pin-input-${i}" type="password" inputmode="numeric" maxlength="1" value="${esc((modalState.value||"")[i]||"")}" oninput="onPinDigit(${i},this)">`).join("")}
    </div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-pin">Valider</button>
    </div>`;
}
function installHelpModalHTML(){
  return `<div class="modal-title">⬇️ Installer EasySkill</div>
    <p style="font-size:13px;color:var(--slate-600);line-height:1.7;">
      <b>Sur PC (Chrome / Edge)</b> : cliquez sur l'icône d'installation ⊕ dans la barre d'adresse, ou menu ⋮ → « Installer EasySkill ».<br><br>
      <b>Sur Android (Chrome)</b> : menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».<br><br>
      <b>Sur iPhone/iPad (Safari)</b> : bouton Partager 
      → « Sur l'écran d'accueil ».
    </p>
    <div class="fab-bottom">
      <button class="btn btn-primary btn-full" data-action="close-modal">J'ai compris</button>
    </div>`;
}
function onPinDigit(i, el){
  let v = (modalState.value||"").split("");
  v[i] = el.value.replace(/[^0-9]/g,"");
  modalState.value = v.join("").slice(0,4);
  if(el.value && i<3){ const next=document.getElementById("pin-input-"+(i+1)); if(next) next.focus(); }
  if(modalState.value.length===4) submitPin();
}
function submitPin(){
  const code = modalState.value||"";
  const expected = modalState.mode==="admin" ? db.settings.pinAdmin : db.settings.pinSecretariat;
  if(code===expected){
    role = modalState.mode; secTab = role==="admin" ? "dashboard" : "eleves"; screen=null; modalState=null; secDrawerOpen=false; render();
    cloudPull(); // récupère les données saisies depuis un autre PC avant d'afficher l'espace
  } else {
    modalState.error = "Code incorrect. Réessayez."; modalState.value=""; render();
    setTimeout(()=>{ const el=document.getElementById("pin-input-0"); if(el) el.focus(); },30);
  }
}

function studentFormModalHTML(isEdit){
  const s = isEdit ? studentById(modalState.id) : null;
  const filiereId = (s&&s.filiereId) || modalState.filiereId || (db.filieres[0] && db.filieres[0].id) || "";
  const chosenIds = s ? (s.fraisChoisis||[]).map(fc=>fc.fraisId) : (modalState.fraisIds || fraisApplicables(filiereId).filter(f=>!f.filiereId).map(f=>f.id));
  const applicable = fraisApplicables(filiereId);
  return `<div class="modal-title">${isEdit? "✏️ Modifier l'élève" : "🎓 Nouvelle inscription"}</div>
    <div class="grid2">
      <div class="field"><span>Nom</span><input id="st-nom" value="${esc(s?s.nom:'')}"></div>
      <div class="field"><span>Prénom</span><input id="st-prenom" value="${esc(s?s.prenom:'')}"></div>
      <div class="field"><span>Sexe</span><select id="st-sexe">
        <option ${s&&s.sexe==='M'?'selected':''} value="M">Masculin</option>
        <option ${s&&s.sexe==='F'?'selected':''} value="F">Féminin</option>
      </select></div>
      <div class="field"><span>Téléphone</span><input id="st-tel" value="${esc(s?s.telephone:'')}"></div>
      <div class="field"><span>Date de naissance</span><input id="st-naissance" type="date" value="${s&&s.dateNaissance?s.dateNaissance:''}"></div>
      <div class="field"><span>Lieu de naissance</span><input id="st-lieunaissance" value="${esc(s?s.lieuNaissance:'')}"></div>
      <div class="field"><span>Date d'inscription</span><input id="st-inscription" type="date" value="${s&&s.dateInscription?s.dateInscription:todayISO()}"></div>
      <div class="field"><span>Redoublant</span><select id="st-redoublant">
        <option ${!(s&&s.redoublant==='Oui')?'selected':''} value="Non">Non</option>
        <option ${s&&s.redoublant==='Oui'?'selected':''} value="Oui">Oui</option>
      </select></div>
    </div>
    <div class="field"><span>Filière</span><select id="st-filiere" onchange="onStudentFiliereChange(this.value)">
      ${db.filieres.map(f=>`<option value="${f.id}" ${filiereId===f.id?'selected':''}>${esc(f.nom)}</option>`).join("")}
    </select></div>
    <div class="field"><span>Frais applicables à sélectionner</span>
      <div id="st-frais-list">${applicable.map(f=>`<div class="checkbox-row">
          <input type="checkbox" id="fr-${f.id}" ${chosenIds.includes(f.id)?'checked':''}>
          <span class="cr-label">${esc(f.nom)}</span><span class="cr-amt">${formatFCFA(f.montant)}</span>
        </div>`).join("")}</div>
    </div>
    <div class="section-title" style="margin-top:6px;">🎖️ Informations pour le diplôme</div>
    <div class="grid2">
      <div class="field"><span>Session</span><input id="st-session" placeholder="Ex : Juin 2025" value="${esc(s?s.session:'')}"></div>
      <div class="field"><span>Mention</span><select id="st-mention">
        ${["","Passable","Assez Bien","Bien","Très Bien","Excellent"].map(m=>`<option value="${m}" ${s&&s.mention===m?'selected':''}>${m||"—"}</option>`).join("")}
      </select></div>
      <div class="field"><span>Date de délivrance du diplôme</span><input id="st-diplomedate" type="date" value="${s&&s.diplomeDate?s.diplomeDate:''}"></div>
      <div class="field">
        <span>Photo de l'élève</span>
        <div style="display:flex;align-items:center;gap:10px;">
          <img id="st-photo-preview" src="${s&&s.photo?s.photo:''}" style="width:48px;height:48px;border-radius:9px;object-fit:cover;border:1.5px solid var(--slate-200);background:var(--slate-100);${s&&s.photo?'':'display:none;'}">
          <input type="file" id="st-photo" accept="image/*" style="flex:1;" onchange="onStudentPhotoChange(this)">
        </div>
      </div>
    </div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="${isEdit?'submit-edit-student':'submit-new-student'}">💾 Enregistrer</button>
    </div>`;
}
function onStudentPhotoChange(input){
  const prev = document.getElementById("st-photo-preview");
  if(!prev || !input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(ev){ prev.src = ev.target.result; prev.style.display = ""; };
  reader.readAsDataURL(input.files[0]);
}
function onStudentFiliereChange(filiereId){
  const applicable = fraisApplicables(filiereId);
  const listEl = document.getElementById("st-frais-list");
  listEl.innerHTML = applicable.map(f=>`<div class="checkbox-row">
      <input type="checkbox" id="fr-${f.id}" ${!f.filiereId?'checked':''}>
      <span class="cr-label">${esc(f.nom)}</span><span class="cr-amt">${formatFCFA(f.montant)}</span>
    </div>`).join("");
}

/* ===================== IMPORT ÉLÈVES DEPUIS PDF ===================== */
function triggerPdfImport(){
  if(!window.pdfjsLib){ showToast("Lecteur PDF indisponible. Vérifiez votre connexion internet.", "err"); return; }
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/pdf";
  inp.onchange = async ()=>{
    const file = inp.files[0];
    if(!file) return;
    showToast("Lecture du PDF en cours...");
    try{
      const rows = await extractStudentsFromPdf(file);
      modalState = {type:"importReview", rows: rows.length? rows : [{nom:"",prenom:"",sexe:"M"}]};
      if(!rows.length) showToast("Aucun élève détecté automatiquement. Complétez ou ajoutez des lignes manuellement.", "err");
      render();
    }catch(err){
      console.error(err);
      showToast("Impossible de lire ce fichier PDF.", "err");
    }
  };
  inp.click();
}

async function extractStudentsFromPdf(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  const lines = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = {};
    content.items.forEach(it=>{
      const y = Math.round(it.transform[5]/3)*3; // regroupe les items proches en une même ligne
      if(!byY[y]) byY[y] = [];
      byY[y].push(it);
    });
    Object.keys(byY).map(Number).sort((a,b)=>b-a).forEach(y=>{
      const rowText = byY[y].sort((a,b)=>a.transform[4]-b.transform[4]).map(it=>it.str).join(" ").replace(/\s+/g," ").trim();
      if(rowText) lines.push(rowText);
    });
  }
  return parseStudentLines(lines);
}

function parseStudentLines(lines){
  const skipRe = /^(n[°o]|num[ée]ro|liste|classe|filière|filiere|centre|effectif|date|matricule|nom\b|pr[ée]nom|sexe\b|tableau|page|total|ann[ée]e)/i;
  const rows = [];
  lines.forEach(raw=>{
    let line = (raw||"").trim();
    if(!line || skipRe.test(line)) return;
    // retire une numérotation en tête ("1.", "01)", "N°3 -")
    line = line.replace(/^(n[°o]\s*)?\d{1,3}[\.\)\-\:]?\s+/i, "").trim();
    if(!line) return;
    // détecte un marqueur de sexe en début ou fin de ligne
    let sexe = null;
    let m = line.match(/^(M|F|H|MASCULIN|F[ÉE]MININ|GAR[ÇC]ON|FILLE)\.?\s+/i) || line.match(/\s+(M|F|H|MASCULIN|F[ÉE]MININ|GAR[ÇC]ON|FILLE)\.?$/i);
    if(m){
      const tok = m[1].toUpperCase();
      sexe = /^(M|MASCULIN|GAR[ÇC]ON)$/.test(tok) ? "M" : "F";
      line = line.replace(m[0], " ").trim();
    }
    // retire dates, téléphones et longues suites de chiffres qui ne font pas partie du nom
    line = line.replace(/\d[\d\/\.\-\s]{4,}/g, " ").replace(/\s+/g," ").trim();
    const words = line.split(/\s+/).filter(w=> w.length>1 || /^[A-ZÀ-Ýa-zà-ý]$/.test(w));
    if(words.length < 2) return;
    const isCaps = w=> w===w.toUpperCase() && /[A-ZÀ-Ý]/.test(w);
    const capsWords = words.filter(isCaps);
    let nom, prenom;
    if(capsWords.length && capsWords.length < words.length){
      nom = words.filter(isCaps).join(" ");
      prenom = words.filter(w=>!isCaps(w)).join(" ");
    } else {
      nom = words[0];
      prenom = words.slice(1).join(" ");
    }
    if(!nom || !prenom) return;
    rows.push({nom: titleCaseSafe(nom), prenom: titleCaseSafe(prenom), sexe: sexe || "M"});
  });
  return rows;
}
function titleCaseSafe(s){
  return s.split(" ").filter(Boolean).map(w=> w[0].toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}

function importReviewModalHTML(){
  const rows = modalState.rows;
  return `<div class="modal-title">📄 Élèves détectés (${rows.length})</div>
    <p style="font-size:12.5px;color:var(--slate-500);margin:-8px 0 14px;">Vérifiez et corrigez si besoin. La filière et les frais de chaque élève seront à renseigner ensuite (bouton "Modifier" sur sa fiche).</p>
    <div id="import-rows-list">
      ${rows.map((r,i)=>importRowHTML(r,i)).join("")}
    </div>
    <button class="btn btn-ghost btn-sm" data-action="import-add-row" style="margin-bottom:10px;">➕ Ajouter une ligne</button>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-import-students">💾 Importer ${rows.length} élève${rows.length>1?'s':''}</button>
    </div>`;
}
function importRowHTML(r,i){
  return `<div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:8px;">
    <div class="field" style="flex:1.3;margin-bottom:0;"><span>Nom</span><input value="${esc(r.nom)}" oninput="onImportRowChange(${i},'nom',this.value)"></div>
    <div class="field" style="flex:1.3;margin-bottom:0;"><span>Prénom</span><input value="${esc(r.prenom)}" oninput="onImportRowChange(${i},'prenom',this.value)"></div>
    <div class="field" style="width:78px;margin-bottom:0;"><span>Sexe</span><select onchange="onImportRowChange(${i},'sexe',this.value)">
      <option value="M" ${r.sexe==='M'?'selected':''}>M</option>
      <option value="F" ${r.sexe==='F'?'selected':''}>F</option>
    </select></div>
    <button class="btn btn-ghost btn-sm" data-action="import-remove-row" data-id="${i}" title="Supprimer cette ligne" style="padding:9px 10px;">🗑️</button>
  </div>`;
}
function onImportRowChange(i, key, val){
  if(modalState && modalState.rows && modalState.rows[i]) modalState.rows[i][key] = val;
}
function submitImportStudents(){
  const rows = (modalState.rows||[]).filter(r=> (r.nom||"").trim() && (r.prenom||"").trim());
  if(!rows.length){ showToast("Renseignez au moins un nom et un prénom.","err"); return; }
  rows.forEach(r=>{
    db.students.push({
      id: uid(), matricule: genMatricule(), nom: r.nom.trim(), prenom: r.prenom.trim(),
      sexe: r.sexe==="F"?"F":"M", telephone:"", dateNaissance:"",
      dateInscription: todayISO(), redoublant:"Non",
      filiereId: null, anneeScolaire: db.settings.anneeScolaire,
      fraisChoisis: [], statut:"actif"
    });
  });
  saveDB();
  modalState = null; eleveFiliereId = "unassigned"; studentSearch = "";
  showToast(rows.length+" élève"+(rows.length>1?"s":"")+" importé"+(rows.length>1?"s":"")+". Complétez leur filière et leurs frais.");
  render();
}

function paymentFormModalHTML(){
  const presetId = modalState.id || null;
  const students = activeStudents().slice().sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));
  const initialId = presetId || (students[0] && students[0].id) || "";
  const s = studentById(initialId);
  const studentPicker = presetId
    ? `<div class="field"><span>Élève</span><input value="${esc(s?s.nom+' '+s.prenom:'')}" disabled></div>`
    : `<div class="field"><span>Élève</span><select id="pay-student" onchange="onPaymentStudentChange(this.value)">
        ${students.length? students.map(st=>`<option value="${st.id}" ${initialId===st.id?'selected':''}>${esc(st.nom)} ${esc(st.prenom)} — ${esc(filiereName(st.filiereId))}</option>`).join("") : `<option value="">Aucun élève inscrit</option>`}
      </select></div>`;
  return `<div class="modal-title">💳 Encaisser un paiement</div>
    ${studentPicker}
    <div id="pay-context">${paymentContextHTML(initialId)}</div>
    <div class="field"><span>Date</span><input id="pay-date" type="date" value="${todayISO()}"></div>
    <div class="field"><span>Mode de paiement</span><select id="pay-mode">
      <option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option>
    </select></div>
    <div class="field"><span>Note (optionnel)</span><input id="pay-note" placeholder="Ex: 1er versement"></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-payment">💾 Enregistrer le paiement</button>
    </div>`;
}
function paymentContextHTML(studentId){
  const s = studentById(studentId);
  if(!s) return `<p style="font-size:12.5px;color:var(--slate-500);">Aucun élève sélectionné.</p>`;
  const bal = studentBalance(s);
  const fraisList = (s.fraisChoisis||[]).map(fc=>fraisById(fc.fraisId)).filter(Boolean);
  return `
    <p style="font-size:12.5px;color:var(--slate-500);">Solde actuel : <b>${formatFCFA(bal)}</b></p>
    <div class="field"><span>Motif (frais à payer)</span><select id="pay-frais" onchange="onPaymentFraisChange(this.value)">
      <option value="">— Choisir un frais —</option>
      ${fraisList.map(f=>`<option value="${f.id}">${esc(f.nom)} (${formatFCFA(f.montant)})</option>`).join("")}
      <option value="autre">Autre / versement libre</option>
    </select></div>
    <div class="field"><span>Montant versé (FCFA)</span><input id="pay-montant" type="number" min="0"></div>`;
}
function onPaymentStudentChange(id){
  const ctx = document.getElementById("pay-context");
  if(ctx) ctx.innerHTML = paymentContextHTML(id);
}
function onPaymentFraisChange(fraisId){
  const f = fraisById(fraisId);
  const montantEl = document.getElementById("pay-montant");
  const noteEl = document.getElementById("pay-note");
  if(montantEl) montantEl.value = f ? f.montant : "";
  if(noteEl) noteEl.value = f ? f.nom : "";
}

function teacherFormModalHTML(){
  return `<div class="modal-title">🧑‍🏫 Nouvel enseignant</div>
    <div class="grid2">
      <div class="field"><span>Nom</span><input id="tc-nom"></div>
      <div class="field"><span>Prénom</span><input id="tc-prenom"></div>
    </div>
    <div class="field"><span>Matière / filière enseignée</span><input id="tc-matiere"></div>
    <div class="field"><span>Téléphone</span><input id="tc-tel"></div>
    <div class="grid2">
      <div class="field"><span>Salaire mensuel (FCFA)</span><input id="tc-salaire" type="number" min="0"></div>
      <div class="field"><span>Date d'embauche</span><input id="tc-embauche" type="date" value="${todayISO()}"></div>
    </div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-new-teacher">💾 Enregistrer</button>
    </div>`;
}

function salaryFormModalHTML(){
  const t = teacherById(modalState.id);
  return `<div class="modal-title">💵 Verser salaire — ${esc(t?t.nom:'')} ${esc(t?t.prenom:'')}</div>
    <div class="field"><span>Mois concerné</span><input id="sal-mois" type="month" value="${monthKeyNow()}"></div>
    <div class="field"><span>Montant (FCFA)</span><input id="sal-montant" type="number" min="0" value="${t?t.salaireMensuel:''}"></div>
    <div class="field"><span>Date de versement</span><input id="sal-date" type="date" value="${todayISO()}"></div>
    <div class="field"><span>Mode de paiement</span><select id="sal-mode">
      <option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option>
    </select></div>
    <div class="field"><span>Note (optionnel)</span><input id="sal-note"></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-salary">💾 Enregistrer</button>
    </div>`;
}

function bulletinFormModalHTML(){
  const s = studentById(modalState.id);
  const matieres = s ? matieresOf(s.filiereId) : [];
  return `<div class="modal-title">📘 Nouveau bulletin — ${esc(s?s.nom:'')} ${esc(s?s.prenom:'')}</div>
    <div class="grid2">
      <div class="field"><span>Trimestre</span><select id="bl-trimestre">
        <option>Trimestre 1</option><option>Trimestre 2</option><option>Trimestre 3</option>
      </select></div>
      <div class="field"><span>Date</span><input id="bl-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><span>Type d'évaluation</span><input id="bl-type-eval" placeholder="Ex: Composition du 1er trimestre"></div>
    ${matieres.length? `
    <div class="section-title" style="font-size:13px;margin:16px 0 8px;">📝 Notes par matière</div>
    <div class="table-wrap" style="margin-bottom:6px;"><table><thead><tr><th>Matière</th><th>Coef</th><th>Note/20</th><th>Appréciation</th></tr></thead><tbody>
      ${matieres.map(m=>`<tr>
        <td style="font-weight:600;">${esc(m.nom)}</td>
        <td>${esc(m.coefficient)}</td>
        <td style="min-width:70px;"><input id="bl-note-${m.id}" type="number" min="0" max="20" step="0.25" style="width:64px;padding:6px 8px;border:1px solid var(--slate-300);border-radius:8px;"></td>
        <td style="min-width:140px;"><input id="bl-appr-${m.id}" placeholder="Optionnel" style="width:100%;padding:6px 8px;border:1px solid var(--slate-300);border-radius:8px;"></td>
      </tr>`).join("")}
    </tbody></table></div>` : `<div class="empty" style="padding:16px 0;">Aucune matière paramétrée pour la filière ${esc(s?filiereName(s.filiereId):"")}. Configurez-les d'abord dans <b>Filières &amp; Frais</b>.</div>`}
    <div class="section-title" style="font-size:13px;margin:16px 0 8px;">🧭 Conduite et attitudes</div>
    <div class="grid2">
      <div class="field"><span>Assiduité</span><input id="bl-assiduite" placeholder="Ex: Régulière"></div>
      <div class="field"><span>Discipline (conduite)</span><input id="bl-discipline" placeholder="Ex: Bonne"></div>
    </div>
    <div class="field"><span>Défauts majeurs identifiés chez l'élève (optionnel)</span><textarea id="bl-defauts" rows="2"></textarea></div>
    <div class="field"><span>Qualités remarquables (optionnel)</span><textarea id="bl-qualites" rows="2"></textarea></div>
    <div class="field"><span>Appréciation du maître/maîtresse (optionnel)</span><textarea id="bl-appreciation-pp" rows="3"></textarea></div>
    <div class="field"><span>Décision du conseil</span>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:2px;">
        ${BULLETIN_DECISIONS.map(d=>`<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:500;color:var(--slate-700);cursor:pointer;">
          <input type="checkbox" id="bl-decision-${esc(d)}" value="${esc(d)}" style="width:16px;height:16px;">${esc(d)}
        </label>`).join("")}
      </div>
    </div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      ${matieres.length? `<button class="btn btn-primary btn-full" data-action="submit-bulletin">💾 Enregistrer</button>`:""}
    </div>`;
}

function expenseFormModalHTML(){
  return `<div class="modal-title">💸 Nouvelle dépense</div>
    <div class="field"><span>Motif</span><input id="ex-motif" placeholder="Ex: Achat fournitures"></div>
    <div class="grid2">
      <div class="field"><span>Montant (FCFA)</span><input id="ex-montant" type="number" min="0"></div>
      <div class="field"><span>Date</span><input id="ex-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><span>Mode</span><select id="ex-mode">
      <option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option>
    </select></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-expense">💾 Enregistrer</button>
    </div>`;
}

function revenueFormModalHTML(){
  return `<div class="modal-title">💰 Nouvelle recette</div>
    <div class="field"><span>Motif</span><input id="rv-motif" placeholder="Ex: Subvention, don..."></div>
    <div class="grid2">
      <div class="field"><span>Montant (FCFA)</span><input id="rv-montant" type="number" min="0"></div>
      <div class="field"><span>Date</span><input id="rv-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><span>Mode</span><select id="rv-mode">
      <option>Espèces</option><option>Mobile Money</option><option>Virement</option><option>Chèque</option>
    </select></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-revenue">💾 Enregistrer</button>
    </div>`;
}

function caisseMvtFormModalHTML(){
  const isEntree = modalState.mvtType==="entree";
  return `<div class="modal-title">${isEntree?"➕ Entrée":"➖ Sortie"} de caisse</div>
    <div class="field"><span>Motif</span><input id="cm-motif" placeholder="${isEntree? "Ex: Alimentation caisse depuis banque" : "Ex: Dépôt bancaire, retrait..."}"></div>
    <div class="grid2">
      <div class="field"><span>Montant (FCFA)</span><input id="cm-montant" type="number" min="0"></div>
      <div class="field"><span>Date</span><input id="cm-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="submit-caisse-mvt">💾 Enregistrer</button>
    </div>`;
}

function filiereFormModalHTML(){
  const isEdit = modalState.type==="editFiliere";
  const f = isEdit ? getFiliere(modalState.id) : null;
  return `<div class="modal-title">${isEdit?"✏️ Modifier":"➕ Nouvelle"} filière</div>
    <div class="field"><span>Nom de la filière</span><input id="fl-nom" value="${esc(f?f.nom:'')}"></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="${isEdit?'submit-edit-filiere':'submit-new-filiere'}">💾 Enregistrer</button>
    </div>`;
}

function matieresModalHTML(){
  const f = getFiliere(modalState.filiereId);
  if(!f) return `<div class="modal-title">Filière introuvable</div><div class="fab-bottom"><button class="btn btn-ghost btn-full" data-action="close-modal">Fermer</button></div>`;
  const matieres = f.matieres||[];
  const isAdmin = role==="admin";
  return `<div class="modal-title">📚 Matières — ${esc(f.nom)}</div>
    ${matieres.length? `<div style="margin-bottom:14px;">
      ${matieres.map(m=>`<div class="row" style="padding:8px 0;border-bottom:1px solid var(--slate-100);">
        <span style="font-size:13px;font-weight:600;">${esc(m.nom)}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span class="pill pill-amber">Coef ${esc(m.coefficient)}</span>
          ${isAdmin? `<button class="btn btn-danger btn-sm" data-action="delete-matiere" data-filiere-id="${f.id}" data-matiere-id="${m.id}">🗑️</button>`:""}
        </span>
      </div>`).join("")}
    </div>` : `<div class="empty" style="padding:16px 0;">Aucune matière paramétrée pour cette filière.</div>`}
    ${isAdmin? `<div class="grid2" style="align-items:end;">
      <div class="field"><span>Nom de la matière</span><input id="mt-nom" placeholder="Ex: Anatomie"></div>
      <div class="field"><span>Coefficient</span><input id="mt-coef" type="number" min="1" step="1" value="1"></div>
    </div>
    <button class="btn btn-orange btn-full" style="margin-bottom:14px;" data-action="add-matiere" data-filiere-id="${f.id}">➕ Ajouter la matière</button>`:""}
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Fermer</button>
    </div>`;
}

function fraisFormModalHTML(){
  const isEdit = modalState.type==="editFrais";
  const f = isEdit ? fraisById(modalState.id) : null;
  return `<div class="modal-title">${isEdit?"✏️ Modifier":"➕ Nouveau"} frais</div>
    <div class="field"><span>Nom du frais</span><input id="fr-nom" value="${esc(f?f.nom:'')}"></div>
    <div class="field"><span>Montant (FCFA)</span><input id="fr-montant" type="number" min="0" value="${f?f.montant:''}"></div>
    <div class="field"><span>Filière concernée</span><select id="fr-filiere">
      <option value="">Toutes les filières</option>
      ${db.filieres.map(fl=>`<option value="${fl.id}" ${f&&f.filiereId===fl.id?'selected':''}>${esc(fl.nom)}</option>`).join("")}
    </select></div>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary btn-full" data-action="${isEdit?'submit-edit-frais':'submit-new-frais'}">💾 Enregistrer</button>
    </div>`;
}

function confirmModalHTML(){
  return `<div class="modal-title">⚠️ ${esc(modalState.title||"Confirmer")}</div>
    <p style="font-size:13px;color:var(--slate-600);">${esc(modalState.msg||"")}</p>
    <div class="fab-bottom">
      <button class="btn btn-ghost btn-full" data-action="close-modal">Annuler</button>
      <button class="btn btn-danger btn-full" data-action="confirm-yes">Confirmer</button>
    </div>`;
}

/* ===================== EVENT HANDLING ===================== */
document.addEventListener("click", onAppClick);
function onAppClick(e){
  const overlay = e.target.closest('[data-action="modal-overlay"]');
  if(overlay && e.target===overlay){ modalState=null; render(); return; }
  const btn = e.target.closest("[data-action]");
  if(!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  switch(action){
    case "splash-continue": appState=null; render(); break;
    case "install-app": triggerInstall(); break;
    case "select-role": requestRoleAuth(btn.dataset.role); break;
    case "close-modal": modalState=null; render(); break;
    case "exit-role": role=null; screen=null; modalState=null; secTab="eleves"; eleveFiliereId=null; secDrawerOpen=false; render(); break;
    case "cloud-refresh": cloudPull(); break;
    case "submit-license": submitLicenseFromGate(); break;
    case "license-refresh": licenseVerify(); break;
    case "submit-license-settings": {
      const el = document.getElementById("license-renew-input");
      const code = el ? el.value.replace(/[^0-9]/g,"") : "";
      if(code.length<6){ licenseError = "Entrez le code complet."; render(); break; }
      submitLicenseActivation(code);
      break;
    }
    case "set-tab": secTab = btn.dataset.tab; screen=null; secDrawerOpen=false; render(); break;
    case "toggle-sec-drawer": secDrawerOpen = !secDrawerOpen; render(); break;
    case "close-sec-drawer": secDrawerOpen = false; render(); break;
    case "submit-pin": submitPin(); break;

    case "select-eleve-filiere": eleveFiliereId = id; studentSearch=""; render(); break;
    case "back-to-filiere-list": eleveFiliereId = null; studentSearch=""; render(); break;

    case "new-student": modalState={type:"newStudent", filiereId: btn.dataset.filiereId||null}; render(); break;
    case "edit-student": modalState={type:"editStudent", id}; render(); break;
    case "open-student": screen={type:"studentDetail", id}; render(); syncStudentPhoto(id); break;
    case "back-to-eleves": screen=null; secTab="eleves"; render(); break;
    case "back-to-student": screen={type:"studentDetail", id}; render(); syncStudentPhoto(id); break;
    case "archive-student": {
      const s = studentById(id); if(s){ s.statut="archive"; saveDB(); showToast("Élève archivé."); screen=null; render(); }
      break;
    }
    case "submit-new-student": submitNewStudent(); break;
    case "submit-edit-student": submitEditStudent(id); break;

    case "import-pdf-students": triggerPdfImport(); break;
    case "import-add-row": modalState.rows.push({nom:"",prenom:"",sexe:"M"}); render(); break;
    case "import-remove-row": modalState.rows.splice(Number(btn.dataset.id),1); render(); break;
    case "submit-import-students": submitImportStudents(); break;

    case "add-payment": modalState={type:"addPayment", id}; render(); break;
    case "submit-payment": submitPayment(); break;
    case "print-payment-state": screen={type:"paymentPrint", id}; render(); break;
    case "print-receipt": screen={type:"receipt", id}; render(); break;
    case "gen-certificate":
      if(role!=="admin"){ showToast("Seul l'administrateur peut générer les attestations et diplômes.", "err"); break; }
      screen={type:"certificate", id, kind:btn.dataset.kind}; render(); syncStudentPhoto(id); break;
    case "do-print": setupPrintPage(); window.print(); break;
    case "download-diplome-pdf": {
      const s = studentById(id);
      if(s) downloadDiplomePDF(s, btn);
      break;
    }
    case "download-bulletin-pdf": {
      const s = studentById(id);
      const b = s ? bulletinById(id, btn.dataset.bulletinId) : null;
      if(s && b) downloadBulletinPDF(s, b, btn);
      break;
    }
    case "download-receipt-pdf": {
      const p = paymentById(id);
      const s = p ? studentById(p.studentId) : null;
      if(p) downloadReceiptPDF(p, s, btn);
      break;
    }
    case "back-to-tab": secTab = btn.dataset.tab; screen=null; render(); break;

    case "student-set-statut": {
      const s = studentById(id);
      if(s){
        const nouveauStatut = btn.dataset.statut;
        if(nouveauStatut==="stage" && s.statut!=="stage") s.stageDebutDate = todayISO();
        if(s.statut==="stage" && nouveauStatut==="actif") s.stageFinDate = todayISO();
        s.statut = nouveauStatut; saveDB(); showToast("Statut de l'élève mis à jour.");
      }
      render(); break;
    }

    case "new-bulletin": modalState={type:"newBulletin", id}; render(); break;
    case "submit-bulletin": submitBulletin(); break;
    case "print-bulletin":
      if(role!=="admin"){ showToast("Seul l'administrateur peut générer les bulletins.", "err"); break; }
      screen={type:"bulletinPrint", studentId: btn.dataset.studentId, id}; render(); syncStudentPhoto(btn.dataset.studentId); break;

    case "new-teacher": modalState={type:"newTeacher"}; render(); break;
    case "submit-new-teacher": submitNewTeacher(); break;
    case "open-teacher": screen={type:"teacherDetail", id}; render(); break;
    case "pay-salary": modalState={type:"paySalary", id}; render(); break;
    case "submit-salary": submitSalary(); break;
    case "print-teacher-history": screen={type:"teacherHistory", id}; render(); break;
    case "delete-teacher": modalState={type:"confirm", title:"Supprimer l'enseignant", msg:"Cette action est irréversible. Continuer ?", onYes:()=>{ db.teachers = db.teachers.filter(t=>t.id!==id); db.salaryPayments = db.salaryPayments.filter(p=>p.teacherId!==id); saveDB(); showToast("Enseignant supprimé."); }}; render(); break;

    case "new-expense": modalState={type:"newExpense"}; render(); break;
    case "submit-expense": submitExpense(); break;
    case "print-expense": screen={type:"expenseReceipt", id}; render(); break;
    case "delete-expense": modalState={type:"confirm", title:"Supprimer la dépense", msg:"Continuer ?", onYes:()=>{ db.expenses = (db.expenses||[]).filter(e=>e.id!==id); saveDB(); showToast("Dépense supprimée."); }}; render(); break;

    case "new-revenue": modalState={type:"newRevenue"}; render(); break;
    case "submit-revenue": submitRevenue(); break;
    case "print-revenue": screen={type:"revenueReceipt", id}; render(); break;
    case "delete-revenue": modalState={type:"confirm", title:"Supprimer la recette", msg:"Continuer ?", onYes:()=>{ db.revenues = (db.revenues||[]).filter(r=>r.id!==id); saveDB(); showToast("Recette supprimée."); }}; render(); break;

    case "new-caisse-mvt": modalState={type:"newCaisseMvt", mvtType: btn.dataset.type}; render(); break;
    case "submit-caisse-mvt": submitCaisseMvt(); break;
    case "save-caisse-fond": {
      const el = document.getElementById("caisse-fond-input");
      db.settings.caisseFondInitial = el? Number(el.value)||0 : db.settings.caisseFondInitial;
      saveDB(); showToast("Fond de caisse mis à jour."); render(); break;
    }

    case "new-filiere": modalState={type:"newFiliere"}; render(); break;
    case "edit-filiere": modalState={type:"editFiliere", id}; render(); break;
    case "submit-new-filiere": submitNewFiliere(); break;
    case "submit-edit-filiere": submitEditFiliere(id); break;
    case "delete-filiere": modalState={type:"confirm", title:"Supprimer la filière", msg:"Les frais liés à cette filière resteront mais ne seront plus rattachés. Continuer ?", onYes:()=>{ db.filieres = db.filieres.filter(f=>f.id!==id); saveDB(); showToast("Filière supprimée."); }}; render(); break;

    case "manage-matieres": modalState={type:"manageMatieres", filiereId:id}; render(); break;
    case "add-matiere": submitAddMatiere(btn.dataset.filiereId); break;
    case "delete-matiere": {
      const f = getFiliere(btn.dataset.filiereId);
      if(f){ f.matieres = (f.matieres||[]).filter(m=>m.id!==btn.dataset.matiereId); saveDB(); showToast("Matière supprimée."); }
      render(); break;
    }

    case "new-frais": modalState={type:"newFrais"}; render(); break;
    case "edit-frais": modalState={type:"editFrais", id}; render(); break;
    case "submit-new-frais": submitNewFrais(); break;
    case "submit-edit-frais": submitEditFrais(id); break;
    case "delete-frais": modalState={type:"confirm", title:"Supprimer le frais", msg:"Continuer ?", onYes:()=>{ db.fraisTypes = db.fraisTypes.filter(f=>f.id!==id); saveDB(); showToast("Frais supprimé."); }}; render(); break;

    case "confirm-yes": { const cb = modalState && modalState.onYes; modalState=null; if(cb) cb(); render(); break; }

    case "save-settings": submitSettings(); break;
    case "save-pins": submitPins(); break;
    case "export-data": exportData(); break;

    case "open-rapport": rapportDu=""; rapportAu=""; screen={type:"rapport", kind:btn.dataset.kind}; render(); break;
    case "export-rapport-csv": exportRapportCSV(btn.dataset.kind); break;
  }
}

/* ===================== SUBMIT HANDLERS ===================== */
function collectFraisChoisis(){
  return db.fraisTypes.filter(f=>{ const el = document.getElementById("fr-"+f.id); return el && el.checked; })
    .map(f=>({fraisId:f.id, montant:f.montant}));
}
/* Lit un fichier image, le redimensionne et le compresse avant de le convertir en base64.
   Corrige le bug d'enregistrement : les photos issues d'un téléphone (plusieurs Mo) faisaient
   dépasser le quota de stockage du navigateur (localStorage), ce qui faisait échouer
   l'enregistrement silencieusement. */
function readAndResizeImage(fileInput, maxDim, mimeType, quality, cb){
  if(!(fileInput && fileInput.files && fileInput.files[0])){ cb(null); return; }
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(ev){
    const img = new Image();
    img.onload = function(){
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if(w>maxDim || h>maxDim){
        if(w>=h){ h = Math.round(h*maxDim/w); w = maxDim; } else { w = Math.round(w*maxDim/h); h = maxDim; }
      }
      try{
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL(mimeType||"image/jpeg", quality||0.85));
      }catch(err){ console.error(err); cb(ev.target.result); }
    };
    img.onerror = function(){ cb(ev.target.result); };
    img.src = ev.target.result;
  };
  reader.onerror = function(){ showToast("Impossible de lire le fichier image.","err"); cb(null); };
  reader.readAsDataURL(file);
}
function readPhotoFile(cb){
  const fileInput = document.getElementById("st-photo");
  readAndResizeImage(fileInput, 480, "image/jpeg", 0.75, cb);
}
/* Réduit encore une image déjà compressée (dataURL) pour une nouvelle tentative d'enregistrement. */
function shrinkDataUrl(dataUrl, maxDim, quality, cb){
  if(!dataUrl){ cb(null); return; }
  const img = new Image();
  img.onload = function(){
    let w = img.naturalWidth||img.width, h = img.naturalHeight||img.height;
    if(w>maxDim || h>maxDim){
      if(w>=h){ h = Math.round(h*maxDim/w); w = maxDim; } else { w = Math.round(w*maxDim/h); h = maxDim; }
    }
    try{
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL("image/jpeg", quality));
    }catch(err){ console.error(err); cb(null); }
  };
  img.onerror = function(){ cb(null); };
  img.src = dataUrl;
}
/* Enregistre la photo d'un élève avec plusieurs tentatives de compression si le stockage
   du navigateur est presque plein (au lieu d'abandonner dès le premier échec). */
function savePhotoWithFallback(studentId, dataUrl, cb){
  if(!dataUrl){ cb(""); return; }
  if(savePhoto(studentId, dataUrl)){ cb(dataUrl); return; }
  shrinkDataUrl(dataUrl, 300, 0.6, function(smaller){
    if(smaller && savePhoto(studentId, smaller)){ cb(smaller); return; }
    shrinkDataUrl(dataUrl, 160, 0.45, function(evenSmaller){
      if(evenSmaller && savePhoto(studentId, evenSmaller)){ cb(evenSmaller); return; }
      cb("");
    });
  });
}
function submitNewStudent(){
  const nom = document.getElementById("st-nom").value.trim();
  const prenom = document.getElementById("st-prenom").value.trim();
  if(!nom || !prenom){ showToast("Le nom et le prénom sont obligatoires.","err"); return; }
  readPhotoFile(function(photoData){
    const s = {
      id: uid(), matricule: genMatricule(), nom, prenom,
      sexe: document.getElementById("st-sexe").value,
      telephone: document.getElementById("st-tel").value.trim(),
      dateNaissance: document.getElementById("st-naissance").value,
      lieuNaissance: document.getElementById("st-lieunaissance").value.trim(),
      dateInscription: document.getElementById("st-inscription").value || todayISO(),
      redoublant: document.getElementById("st-redoublant").value,
      filiereId: document.getElementById("st-filiere").value,
      anneeScolaire: db.settings.anneeScolaire,
      fraisChoisis: collectFraisChoisis(),
      session: document.getElementById("st-session").value.trim(),
      mention: document.getElementById("st-mention").value,
      diplomeDate: document.getElementById("st-diplomedate").value,
      photo: "",
      statut: "actif"
    };
    function finishSubmitNewStudent(){
      db.students.push(s);
      const ok = saveDB();
      modalState=null;
      if(ok) showToast("Élève inscrit avec succès.");
      screen = {type:"studentDetail", id:s.id}; render();
    }
    if(photoData){
      savePhotoWithFallback(s.id, photoData, function(saved){
        s.photo = saved;
        if(!saved) showToast("La photo n'a pas pu être enregistrée (mémoire du navigateur pleine) ; l'élève a été inscrit sans photo. Essayez une photo plus légère ou libérez de l'espace.", "err");
        finishSubmitNewStudent();
      });
    } else {
      finishSubmitNewStudent();
    }
  });
}
function submitEditStudent(id){
  const s = studentById(id); if(!s) return;
  readPhotoFile(function(photoData){
    s.nom = document.getElementById("st-nom").value.trim();
    s.prenom = document.getElementById("st-prenom").value.trim();
    s.sexe = document.getElementById("st-sexe").value;
    s.telephone = document.getElementById("st-tel").value.trim();
    s.dateNaissance = document.getElementById("st-naissance").value;
    s.lieuNaissance = document.getElementById("st-lieunaissance").value.trim();
    s.dateInscription = document.getElementById("st-inscription").value;
    s.redoublant = document.getElementById("st-redoublant").value;
    s.filiereId = document.getElementById("st-filiere").value;
    s.fraisChoisis = collectFraisChoisis();
    s.session = document.getElementById("st-session").value.trim();
    s.mention = document.getElementById("st-mention").value;
    s.diplomeDate = document.getElementById("st-diplomedate").value;
    function finishSubmitEditStudent(){
      const ok = saveDB();
      modalState=null;
      if(ok) showToast("Élève mis à jour.");
      render();
    }
    if(photoData){
      savePhotoWithFallback(s.id, photoData, function(saved){
        if(saved) s.photo = saved;
        else showToast("La photo n'a pas pu être enregistrée (mémoire du navigateur pleine) ; les autres informations ont été mises à jour. Essayez une photo plus légère ou libérez de l'espace.", "err");
        finishSubmitEditStudent();
      });
    } else {
      finishSubmitEditStudent();
    }
  });
}
function submitPayment(){
  const studentEl = document.getElementById("pay-student");
  const studentId = modalState.id || (studentEl ? studentEl.value : null);
  const s = studentById(studentId);
  if(!s){ showToast("Veuillez choisir un élève.","err"); return; }
  const montant = Number(document.getElementById("pay-montant").value);
  if(!montant || montant<=0){ showToast("Montant invalide.","err"); return; }
  db.payments.push({id:uid(), receiptNo:genReceiptNo(), studentId:s.id, montant, date:document.getElementById("pay-date").value||todayISO(), mode:document.getElementById("pay-mode").value, note:document.getElementById("pay-note").value.trim()});
  saveDB(); modalState=null; showToast("Paiement enregistré."); render();
}
function submitNewTeacher(){
  const nom = document.getElementById("tc-nom").value.trim();
  const prenom = document.getElementById("tc-prenom").value.trim();
  if(!nom || !prenom){ showToast("Le nom et le prénom sont obligatoires.","err"); return; }
  db.teachers.push({id:uid(), nom, prenom, matiere:document.getElementById("tc-matiere").value.trim(), telephone:document.getElementById("tc-tel").value.trim(), salaireMensuel:Number(document.getElementById("tc-salaire").value)||0, dateEmbauche:document.getElementById("tc-embauche").value||todayISO()});
  saveDB(); modalState=null; showToast("Enseignant ajouté."); render();
}
function submitSalary(){
  const t = teacherById(modalState.id); if(!t) return;
  const montant = Number(document.getElementById("sal-montant").value);
  if(!montant || montant<=0){ showToast("Montant invalide.","err"); return; }
  db.salaryPayments.push({id:uid(), teacherId:t.id, mois:document.getElementById("sal-mois").value||monthKeyNow(), montant, date:document.getElementById("sal-date").value||todayISO(), mode:document.getElementById("sal-mode").value, note:document.getElementById("sal-note").value.trim()});
  saveDB(); modalState=null; showToast("Salaire enregistré."); render();
}
function submitBulletin(){
  const s = studentById(modalState.id); if(!s) return;
  const matieres = matieresOf(s.filiereId);
  if(!matieres.length){ showToast("Aucune matière paramétrée pour cette filière.","err"); return; }
  const trimestre = document.getElementById("bl-trimestre").value;
  const typeEvaluation = document.getElementById("bl-type-eval").value.trim();
  const notes = matieres.map(m=>{
    const noteEl = document.getElementById("bl-note-"+m.id);
    const apprEl = document.getElementById("bl-appr-"+m.id);
    const noteVal = noteEl && noteEl.value!=="" ? Number(noteEl.value) : null;
    return {matiereId:m.id, coef:m.coefficient, note:noteVal, appreciation: apprEl? apprEl.value.trim() : ""};
  });
  let sumPond=0, sumCoef=0;
  notes.forEach(n=>{ if(n.note!==null && !isNaN(n.note)){ sumPond += n.note*n.coef; sumCoef += n.coef; } });
  const moyenne = sumCoef>0 ? (sumPond/sumCoef) : null;
  if(!s.bulletins) s.bulletins = [];
  s.bulletins.push({
    id:uid(), trimestre, typeEvaluation, date:document.getElementById("bl-date").value||todayISO(),
    notes, moyenne: moyenne!==null? Math.round(moyenne*100)/100 : null,
    assiduite: document.getElementById("bl-assiduite").value.trim(),
    discipline: document.getElementById("bl-discipline").value.trim(),
    defautsMajeurs: document.getElementById("bl-defauts").value.trim(),
    qualitesRemarquables: document.getElementById("bl-qualites").value.trim(),
    appreciationProfPrincipal: document.getElementById("bl-appreciation-pp").value.trim(),
    decisions: BULLETIN_DECISIONS.filter(d=>{ const el=document.getElementById("bl-decision-"+d); return el && el.checked; })
  });
  saveDB(); modalState=null; showToast("Bulletin enregistré."); render();
}
function submitExpense(){
  const motif = document.getElementById("ex-motif").value.trim();
  const montant = Number(document.getElementById("ex-montant").value);
  if(!motif || !montant || montant<=0){ showToast("Motif et montant valides sont obligatoires.","err"); return; }
  db.expenses.push({id:uid(), motif, montant, date:document.getElementById("ex-date").value||todayISO(), mode:document.getElementById("ex-mode").value});
  saveDB(); modalState=null; showToast("Dépense enregistrée."); render();
}
function submitRevenue(){
  const motif = document.getElementById("rv-motif").value.trim();
  const montant = Number(document.getElementById("rv-montant").value);
  if(!motif || !montant || montant<=0){ showToast("Motif et montant valides sont obligatoires.","err"); return; }
  db.revenues.push({id:uid(), motif, montant, date:document.getElementById("rv-date").value||todayISO(), mode:document.getElementById("rv-mode").value});
  saveDB(); modalState=null; showToast("Recette enregistrée."); render();
}
function submitCaisseMvt(){
  const motif = document.getElementById("cm-motif").value.trim();
  const montant = Number(document.getElementById("cm-montant").value);
  if(!montant || montant<=0){ showToast("Montant invalide.","err"); return; }
  db.caisseMovements.push({id:uid(), type:modalState.mvtType, motif, montant, date:document.getElementById("cm-date").value||todayISO()});
  saveDB(); modalState=null; showToast("Mouvement de caisse enregistré."); render();
}
function submitNewFiliere(){
  const nom = document.getElementById("fl-nom").value.trim();
  if(!nom){ showToast("Le nom est obligatoire.","err"); return; }
  db.filieres.push({id:"fil_"+uid(), nom}); saveDB(); modalState=null; showToast("Filière ajoutée."); render();
}
function submitEditFiliere(id){
  const f = getFiliere(id); if(!f) return;
  f.nom = document.getElementById("fl-nom").value.trim();
  saveDB(); modalState=null; showToast("Filière modifiée."); render();
}
function submitAddMatiere(filiereId){
  const f = getFiliere(filiereId); if(!f) return;
  const nom = document.getElementById("mt-nom").value.trim();
  const coefficient = Number(document.getElementById("mt-coef").value)||1;
  if(!nom){ showToast("Le nom de la matière est obligatoire.","err"); return; }
  if(!f.matieres) f.matieres=[];
  f.matieres.push({id:"mat_"+uid(), nom, coefficient});
  saveDB(); showToast("Matière ajoutée."); render();
}
function submitNewFrais(){
  const nom = document.getElementById("fr-nom").value.trim();
  const montant = Number(document.getElementById("fr-montant").value);
  if(!nom || !montant){ showToast("Nom et montant obligatoires.","err"); return; }
  db.fraisTypes.push({id:"frais_"+uid(), nom, montant, filiereId:document.getElementById("fr-filiere").value||null});
  saveDB(); modalState=null; showToast("Frais ajouté."); render();
}
function submitEditFrais(id){
  const f = fraisById(id); if(!f) return;
  f.nom = document.getElementById("fr-nom").value.trim();
  f.montant = Number(document.getElementById("fr-montant").value)||0;
  f.filiereId = document.getElementById("fr-filiere").value||null;
  saveDB(); modalState=null; showToast("Frais modifié."); render();
}
function submitSettings(){
  const s = db.settings;
  s.centerName = document.getElementById("set-name").value.trim();
  s.centerSubtitle = document.getElementById("set-subtitle").value.trim();
  s.site = document.getElementById("set-site").value.trim();
  s.phone = document.getElementById("set-phone").value.trim();
  s.directeur = document.getElementById("set-directeur").value.trim();
  s.anneeScolaire = document.getElementById("set-annee").value.trim();
  const fileInput = document.getElementById("set-logo");
  readAndResizeImage(fileInput, 500, "image/png", 0.92, function(logoData){
    if(logoData) s.logo = logoData;
    saveDB(); showToast("Paramètres enregistrés."); render();
  });
}
function submitPins(){
  db.settings.pinAdmin = document.getElementById("set-pin-admin").value.trim() || db.settings.pinAdmin;
  db.settings.pinSecretariat = document.getElementById("set-pin-sec").value.trim() || db.settings.pinSecretariat;
  saveDB(); showToast("Codes mis à jour."); render();
}
function exportData(){
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "easyskill-sauvegarde-"+todayISO()+".json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ===================== INIT ===================== */
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}
render();
if(licenseEnforced()){
  licenseVerify(true); // vérification silencieuse au démarrage
  setInterval(()=>{ licenseVerify(true); }, 6*60*60*1000); // revérification toutes les 6h
}
