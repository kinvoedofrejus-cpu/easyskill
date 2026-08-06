/* ===================== Configuration de la synchronisation en ligne (Cloudflare) =====================

   Ce fichier connecte EasySkill à un petit "Worker" Cloudflare (gratuit) que tu déploies
   à côté de ton site, afin que l'espace Admin et l'espace Secrétariat partagent les mêmes
   données, même utilisés sur deux ordinateurs différents, à deux endroits différents.

   Le code du Worker à déployer se trouve dans le dossier worker/worker.js de ce zip.

   ------------------------------------------------------------------
   COMMENT DÉPLOYER LE WORKER (5-10 minutes, une seule fois) :
   ------------------------------------------------------------------
   1. Connecte-toi sur https://dash.cloudflare.com (le même compte que pour ton site Pages).
   2. Dans le menu de gauche : "Workers & Pages" > "Créer" > onglet "Créer un Worker".
      Donne-lui un nom (ex: "easyskill-sync"), clique "Déployer" (le code par défaut sera
      remplacé juste après).
   3. Une fois créé, clique "Modifier le code" (Edit code). Supprime tout le code présent et
      colle à la place tout le contenu du fichier worker/worker.js fourni dans ce zip.
      Clique "Déployer" (Deploy) en haut à droite.
   4. Toujours sur la page du Worker, va dans l'onglet "Paramètres" (Settings) :
        - Crée un espace de stockage KV : "Workers & Pages" > "KV" (menu de gauche), clique
          "Créer un espace de noms" (Create namespace), nomme-le "easyskill_kv", crée-le.
        - Retourne dans ton Worker > Paramètres > "Liaisons" (Bindings) > "Ajouter" >
          "Espace de noms KV" (KV Namespace). Nom de la variable : EASYSKILL_KV.
          Espace de noms : easyskill_kv (celui créé juste avant). Enregistre.
        - (Optionnel mais recommandé) Ajoute une variable secrète nommée SYNC_SECRET avec un
          mot de passe de ton choix (ex: une phrase longue). Cela empêche quiconque connaît
          juste l'adresse du Worker d'écrire dans tes données. Si tu ajoutes ce secret, reporte
          la MÊME valeur ci-dessous dans syncSecret.
   5. En haut de la page du Worker, copie son adresse (ex :
      https://easyskill-sync.tonpseudo.workers.dev). Colle-la ci-dessous dans workerUrl.
   6. Enregistre ce fichier (cloud-config.js), remets-le sur GitHub/Cloudflare Pages avec le
      reste du site. C'est tout : la synchronisation est active pour tout le monde qui utilise
      le site avec une connexion internet.

   Tant que ce fichier garde sa valeur par défaut ("COLLE_ICI..."), l'application continue de
   fonctionner normalement en mode 100% hors-ligne (comme avant), sans synchronisation.
   ------------------------------------------------------------------ */

const CLOUD_CONFIG = {
  workerUrl: "https://easyskill-sync.ficheprobot.workers.dev",   // ex: https://easyskill-sync.tonpseudo.workers.dev
  syncSecret: ""                               // laisse vide si tu n'as pas défini SYNC_SECRET côté Worker
};

/* Identifiant du centre dans la base partagée. Ne change rien ici : cela permet, si un jour tu
   gères plusieurs centres avec le même Worker, de garder leurs données séparées. Pour un seul
   centre, laisse "principal". */
const CLOUD_CENTER_ID = "principal";
