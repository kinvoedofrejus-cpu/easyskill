/* ===================== Worker Cloudflare de synchronisation + licences EasySkill =====================
   À déployer tel quel sur Cloudflare (Workers & Pages > Créer un Worker > Modifier le code,
   coller ce fichier en entier, puis Déployer). Voir cloud-config.js pour les instructions
   complètes étape par étape.

   Ce Worker utilise un espace KV nommé EASYSKILL_KV (à lier dans Paramètres > Liaisons) pour
   stocker :
     - "<center>:data"              → le document principal (élèves, paiements, filières, etc.)
     - "<center>:photo:<id>"        → la photo (en base64) d'un élève
     - "license:issued:<code>"      → un code de licence généré (par le générateur de licence)
     - "license:active:<center>"    → la licence actuellement activée pour un centre

   Deux variables secrètes optionnelles (Paramètres > Variables et secrets) :
     - SYNC_SECRET          protège l'écriture des données (élèves, photos)
     - LICENSE_ADMIN_SECRET protège la génération de nouveaux codes de licence — À DÉFINIR
       OBLIGATOIREMENT si tu utilises le système de licence, sinon n'importe qui pourrait
       générer des codes. Cette clé reste uniquement dans le générateur de licence (outil
       interne KINVOS), jamais dans l'app EasySkill du client. */

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Secret, X-License-Admin-Secret"
  };
}
function json(data, status, headers){
  return new Response(JSON.stringify(data), { status: status||200, headers: { ...headers, "Content-Type": "application/json" } });
}
function authorized(request, env){
  if(!env.SYNC_SECRET) return true; // aucun secret configuré = écriture ouverte
  return request.headers.get("X-Sync-Secret") === env.SYNC_SECRET;
}
function licenseAdminAuthorized(request, env){
  if(!env.LICENSE_ADMIN_SECRET) return false; // par sécurité : refusé tant que non configuré
  return request.headers.get("X-License-Admin-Secret") === env.LICENSE_ADMIN_SECRET;
}

/* Génère un code numérique à 8 chiffres non encore utilisé. */
async function generateUniqueCode(kv){
  for(let i=0;i<25;i++){
    const code = String(Math.floor(10000000 + Math.random()*90000000));
    const exists = await kv.get("license:issued:"+code);
    if(!exists) return code;
  }
  throw new Error("Impossible de générer un code unique, réessayez.");
}

/* Calcule la date d'expiration à partir du type de durée. baseDate = point de départ du calcul
   (par défaut maintenant) — utilisé pour "compléter" un abonnement à partir de sa date
   d'expiration actuelle plutôt que de la date du jour. */
function computeExpiresAt(issued, baseDate){
  const now = baseDate || new Date();
  switch(issued.durationType){
    case "illimite": return null;
    case "jours": { const d=new Date(now); d.setDate(d.getDate()+(Number(issued.days)||0)); return d.toISOString(); }
    case "date": return issued.fixedExpiresAt || null;
    case "1mois": { const d=new Date(now); d.setMonth(d.getMonth()+1); return d.toISOString(); }
    case "6mois": { const d=new Date(now); d.setMonth(d.getMonth()+6); return d.toISOString(); }
    case "1an":   { const d=new Date(now); d.setFullYear(d.getFullYear()+1); return d.toISOString(); }
    case "2ans":  { const d=new Date(now); d.setFullYear(d.getFullYear()+2); return d.toISOString(); }
    case "5ans":  { const d=new Date(now); d.setFullYear(d.getFullYear()+5); return d.toISOString(); }
    default: return null;
  }
}

export default {
  async fetch(request, env){
    const headers = corsHeaders();
    const url = new URL(request.url);

    if(request.method === "OPTIONS") return new Response(null, { headers });

    if(!env.EASYSKILL_KV){
      return new Response("Configuration manquante : lie un espace KV nommé EASYSKILL_KV à ce Worker (Paramètres > Liaisons).", { status: 500, headers });
    }
    const kv = env.EASYSKILL_KV;
    const center = url.searchParams.get("center") || "principal";

    // ---- Document principal ----
    if(url.pathname === "/data"){
      const key = center + ":data";
      if(request.method === "GET"){
        const val = await kv.get(key);
        return new Response(val || "null", { headers: { ...headers, "Content-Type": "application/json" } });
      }
      if(request.method === "POST"){
        if(!authorized(request, env)) return new Response("Non autorisé", { status: 401, headers });
        const body = await request.text();
        try{ JSON.parse(body); }catch(e){ return new Response("JSON invalide", { status: 400, headers }); }
        await kv.put(key, body);
        return new Response("ok", { headers });
      }
    }

    // ---- Photos des élèves ----
    if(url.pathname.startsWith("/photo/")){
      const id = decodeURIComponent(url.pathname.slice("/photo/".length));
      const key = center + ":photo:" + id;
      if(request.method === "GET"){
        const val = await kv.get(key);
        return new Response(val || "", { headers: { ...headers, "Content-Type": "text/plain" } });
      }
      if(request.method === "POST"){
        if(!authorized(request, env)) return new Response("Non autorisé", { status: 401, headers });
        const body = await request.text();
        await kv.put(key, body);
        return new Response("ok", { headers });
      }
      if(request.method === "DELETE"){
        if(!authorized(request, env)) return new Response("Non autorisé", { status: 401, headers });
        await kv.delete(key);
        return new Response("ok", { headers });
      }
    }

    // ---- Génération d'un code de licence (outil KINVOS uniquement) ----
    if(url.pathname === "/license/issue" && request.method === "POST"){
      if(!licenseAdminAuthorized(request, env)) return json({message:"Non autorisé."}, 401, headers);
      let body;
      try{ body = await request.json(); }catch(e){ return json({message:"JSON invalide."}, 400, headers); }
      const durationType = body.durationType;
      const valid = ["1mois","6mois","1an","2ans","5ans","illimite","jours","date"];
      if(!valid.includes(durationType)) return json({message:"Type de durée invalide."}, 400, headers);
      if(durationType==="jours" && !(Number(body.days)>0)) return json({message:"Nombre de jours invalide."}, 400, headers);
      if(durationType==="date" && !body.fixedExpiresAt) return json({message:"Date d'expiration manquante."}, 400, headers);
      const code = await generateUniqueCode(kv);
      const issued = {
        durationType, days: durationType==="jours" ? Number(body.days) : null,
        fixedExpiresAt: durationType==="date" ? body.fixedExpiresAt : null,
        createdAt: new Date().toISOString(), note: body.note||"",
        activatedCenter: null, activatedAt: null, expiresAt: null
      };
      await kv.put("license:issued:"+code, JSON.stringify(issued));
      return json({ key: code }, 200, headers);
    }

    // ---- Activation d'un code par le centre (Admin du client) ----
    if(url.pathname === "/license/activate" && request.method === "POST"){
      let body;
      try{ body = await request.json(); }catch(e){ return json({valid:false, message:"JSON invalide."}, 400, headers); }
      const code = String(body.key||"").trim();
      if(!/^\d{6,10}$/.test(code)) return json({valid:false, message:"Code invalide."}, 400, headers);
      const raw = await kv.get("license:issued:"+code);
      if(!raw) return json({valid:false, message:"Code invalide."}, 404, headers);
      const issued = JSON.parse(raw);
      if(issued.activatedCenter && issued.activatedCenter !== center){
        return json({valid:false, message:"Ce code a déjà été utilisé."}, 409, headers);
      }
      let expiresAt = issued.expiresAt;
      if(!issued.activatedAt){
        expiresAt = computeExpiresAt(issued);
        issued.activatedCenter = center;
        issued.activatedAt = new Date().toISOString();
        issued.expiresAt = expiresAt;
        await kv.put("license:issued:"+code, JSON.stringify(issued));
      }
      await kv.put("license:active:"+center, JSON.stringify({ key: code, expiresAt, activatedAt: issued.activatedAt }));
      return json({ valid:true, expiresAt }, 200, headers);
    }

    // ---- Statut de la licence active d'un centre ----
    if(url.pathname === "/license/status" && request.method === "GET"){
      const raw = await kv.get("license:active:"+center);
      if(!raw) return json({ exists:false, active:false }, 200, headers);
      const active = JSON.parse(raw);
      const isActive = active.expiresAt === null || new Date(active.expiresAt).getTime() > Date.now();
      return json({ exists:true, active:isActive, expiresAt: active.expiresAt, key: active.key }, 200, headers);
    }

    // ---- Suppression immédiate de l'abonnement d'un centre (outil KINVOS uniquement) ----
    // Coupe l'accès immédiatement : le client sera bloqué dès sa prochaine vérification
    // automatique (au plus tard 6h), ou tout de suite s'il clique sur "Revérifier maintenant".
    if(url.pathname === "/license/revoke" && request.method === "POST"){
      if(!licenseAdminAuthorized(request, env)) return json({message:"Non autorisé."}, 401, headers);
      let body;
      try{ body = await request.json(); }catch(e){ body = {}; }
      const centerId = String(body.center || "principal").trim() || "principal";
      await kv.delete("license:active:"+centerId);
      return json({ ok:true }, 200, headers);
    }

    // ---- Modifier / compléter l'abonnement actif d'un centre, sans code (outil KINVOS uniquement) ----
    // mode "add" : ajoute la durée choisie à la date d'expiration actuelle (si elle est encore
    // dans le futur) — sinon repart d'aujourd'hui. mode "set" (ou absent) : remplace entièrement
    // la date d'expiration à partir d'aujourd'hui.
    if(url.pathname === "/license/extend" && request.method === "POST"){
      if(!licenseAdminAuthorized(request, env)) return json({message:"Non autorisé."}, 401, headers);
      let body;
      try{ body = await request.json(); }catch(e){ return json({message:"JSON invalide."}, 400, headers); }
      const centerId = String(body.center || "principal").trim() || "principal";
      const durationType = body.durationType;
      const valid = ["1mois","6mois","1an","2ans","5ans","illimite","jours","date"];
      if(!valid.includes(durationType)) return json({message:"Type de durée invalide."}, 400, headers);
      if(durationType==="jours" && !(Number(body.days)>0)) return json({message:"Nombre de jours invalide."}, 400, headers);
      if(durationType==="date" && !body.fixedExpiresAt) return json({message:"Date d'expiration manquante."}, 400, headers);
      const raw = await kv.get("license:active:"+centerId);
      const current = raw ? JSON.parse(raw) : null;
      let baseDate = new Date();
      if(body.mode==="add" && current && current.expiresAt && new Date(current.expiresAt).getTime() > baseDate.getTime()){
        baseDate = new Date(current.expiresAt);
      }
      const expiresAt = computeExpiresAt({ durationType, days: body.days, fixedExpiresAt: body.fixedExpiresAt }, baseDate);
      const key = (current && current.key) || "manuel";
      const activatedAt = (current && current.activatedAt) || new Date().toISOString();
      await kv.put("license:active:"+centerId, JSON.stringify({ key, expiresAt, activatedAt }));
      return json({ ok:true, expiresAt }, 200, headers);
    }

    return new Response("Introuvable", { status: 404, headers });
  }
};
