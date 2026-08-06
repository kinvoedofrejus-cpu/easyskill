/* ===================== cloud.js — connexion à la base de données partagée (Cloudflare Worker) =====================
   Ce fichier ne connaît rien de la structure d'EasySkill : il fournit seulement des fonctions
   génériques pour lire/écrire les données sur le Worker Cloudflare. La logique métier (quand
   synchroniser, comment fusionner les données, l'indicateur visuel) est dans app.js.

   Si cloud-config.js n'a pas été rempli (workerUrl laissé à "COLLE_ICI..."), l'application
   continue de fonctionner 100% hors-ligne comme avant : aucune fonction ici n'a d'effet. */

const CLOUD_ENABLED = !!(
  window.CLOUD_CONFIG &&
  CLOUD_CONFIG.workerUrl &&
  CLOUD_CONFIG.workerUrl.indexOf("COLLE_ICI") === -1
);
const CLOUD_BASE_URL = CLOUD_ENABLED ? CLOUD_CONFIG.workerUrl.replace(/\/+$/, "") : "";
const CLOUD_CENTER = (window.CLOUD_CENTER_ID || "principal");

function cloudIsEnabled(){
  return CLOUD_ENABLED;
}
function cloudHeaders(withSecret){
  const h = { "Content-Type": "application/json" };
  if(withSecret && CLOUD_CONFIG.syncSecret) h["X-Sync-Secret"] = CLOUD_CONFIG.syncSecret;
  return h;
}

/* Récupère le document principal partagé (tout sauf les photos).
   Retourne {success, data} : success=false = échec réseau (probablement hors-ligne) ;
   success=true, data=null = la base cloud n'a encore jamais été initialisée. */
async function cloudFetchMain(){
  if(!cloudIsEnabled()) return {success:false, data:null};
  try{
    const res = await fetch(CLOUD_BASE_URL+"/data?center="+encodeURIComponent(CLOUD_CENTER), { method:"GET" });
    if(!res.ok) return {success:false, data:null};
    const data = await res.json();
    return {success:true, data: data || null};
  }catch(e){
    console.warn("EasySkill — lecture cloud impossible (hors-ligne ?)", e);
    return {success:false, data:null};
  }
}

/* Envoie le document principal (tout sauf les photos) vers le cloud. */
async function cloudPushMain(payload){
  if(!cloudIsEnabled()) return false;
  try{
    const res = await fetch(CLOUD_BASE_URL+"/data?center="+encodeURIComponent(CLOUD_CENTER), {
      method:"POST", headers: cloudHeaders(true), body: JSON.stringify(payload)
    });
    return res.ok;
  }catch(e){
    console.warn("EasySkill — écriture cloud impossible (hors-ligne ?)", e);
    return false;
  }
}

async function cloudFetchPhoto(studentId){
  if(!cloudIsEnabled()) return "";
  try{
    const res = await fetch(CLOUD_BASE_URL+"/photo/"+encodeURIComponent(studentId)+"?center="+encodeURIComponent(CLOUD_CENTER), { method:"GET" });
    if(!res.ok) return "";
    const text = await res.text();
    return text || "";
  }catch(e){ return ""; }
}

async function cloudPushPhoto(studentId, dataUrl){
  if(!cloudIsEnabled()) return false;
  try{
    const url = CLOUD_BASE_URL+"/photo/"+encodeURIComponent(studentId)+"?center="+encodeURIComponent(CLOUD_CENTER);
    let res;
    if(dataUrl) res = await fetch(url, { method:"POST", headers: cloudHeaders(true), body: dataUrl });
    else res = await fetch(url, { method:"DELETE", headers: cloudHeaders(true) });
    return res.ok;
  }catch(e){
    console.warn("EasySkill — envoi de la photo au cloud impossible (hors-ligne ?)", e);
    return false;
  }
}

/* ---------- Licence d'activation ---------- */
async function cloudLicenseStatus(){
  if(!cloudIsEnabled()) return {success:false, data:null};
  try{
    const res = await fetch(CLOUD_BASE_URL+"/license/status?center="+encodeURIComponent(CLOUD_CENTER), { method:"GET" });
    if(!res.ok) return {success:false, data:null};
    const data = await res.json();
    return {success:true, data};
  }catch(e){
    console.warn("EasySkill — vérification de licence impossible (hors-ligne ?)", e);
    return {success:false, data:null};
  }
}
async function cloudLicenseActivate(key){
  if(!cloudIsEnabled()) return {success:false, data:{valid:false, message:"La synchronisation en ligne n'est pas configurée (cloud-config.js)."}};
  try{
    const res = await fetch(CLOUD_BASE_URL+"/license/activate?center="+encodeURIComponent(CLOUD_CENTER), {
      method:"POST", headers: cloudHeaders(false), body: JSON.stringify({ key })
    });
    const data = await res.json().catch(()=>({valid:false, message:"Réponse invalide du serveur."}));
    return {success:true, data};
  }catch(e){
    return {success:false, data:{valid:false, message:"Connexion impossible. Vérifiez votre connexion internet."}};
  }
}
