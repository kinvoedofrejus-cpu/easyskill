# EasySkill — Gestion de centre de formation professionnelle

PWA fonctionnant hors-ligne (comme Academia) : les données restent toujours disponibles dans
le navigateur (localStorage) même sans internet. **Optionnellement**, en déployant un petit
Worker Cloudflare gratuit (voir `worker/worker.js`), l'app se synchronise aussi en ligne :
l'Admin et la Secrétariat voient alors les mêmes données depuis n'importe quel ordinateur
connecté à internet (voir "Synchronisation en ligne" ci-dessous).

## Fichiers
- `index.html` — page principale (styles + structure)
- `app.js` — toute la logique de l'application
- `cloud.js` — connexion à la base de données en ligne (Worker Cloudflare)
- `cloud-config.js` — **à remplir avec l'adresse de ton Worker Cloudflare** (instructions dans ce fichier)
- `worker/worker.js` — code à déployer sur Cloudflare pour héberger les données partagées
- `manifest.json` — métadonnées PWA (installation sur Android)
- `sw.js` — service worker pour le fonctionnement hors-ligne
- `icon-192.png`, `icon-512.png` — icônes de l'app (à remplacer par ton logo si tu veux)

## Synchronisation en ligne (Admin ↔ Secrétariat, depuis n'importe quel PC)
Par défaut, `cloud-config.js` n'est pas configuré : l'app reste 100% locale à chaque appareil,
comme avant. Pour activer le partage des données entre l'espace Admin et l'espace Secrétariat,
peu importe l'ordinateur ou l'endroit, en utilisant Cloudflare (le même compte que pour ton
site) :

1. Déploie `worker/worker.js` comme Worker Cloudflare et lie-lui un espace KV — les instructions
   détaillées, étape par étape, sont dans les commentaires en haut de `cloud-config.js`.
2. Colle l'adresse de ton Worker dans `cloud-config.js`, enregistre, redéploie le site (Pages).
3. C'est tout : dès qu'un poste a internet, ce qui est saisi en Secrétariat apparaît côté Admin
   (et inversement) — en ouvrant l'espace ou en cliquant sur le bouton 🔄 en haut de l'écran.

L'app continue de fonctionner sans internet : les saisies restent enregistrées localement et se
synchronisent automatiquement dès que la connexion revient. Le badge en haut de l'écran indique
l'état : ☁️ Synchronisé, 🔄 Synchronisation…, ⚠️ Hors-ligne, ou 💾 Local uniquement (si
`cloud-config.js` n'est pas rempli).

## Licence d'activation (abonnement)
Une fois la synchronisation en ligne configurée (ci-dessus), EasySkill peut exiger un code
d'activation à 8 chiffres pour fonctionner. Tant que l'abonnement du centre est actif, l'Admin
ET la Secrétariat peuvent travailler normalement ; dès qu'il expire, les DEUX espaces sont
bloqués jusqu'à saisie d'un nouveau code — l'écran de blocage propose directement le champ pour
l'entrer.

- **`worker/worker.js`** gère déjà la génération et la vérification des codes (rien à faire de
  plus une fois le Worker déployé), à condition d'ajouter la variable secrète
  **`LICENSE_ADMIN_SECRET`** dans Paramètres > Variables et secrets du Worker (choisis un mot de
  passe long — sans elle, personne ne peut générer de code, y compris toi).
- **`license-generator/index.html`** est ton outil personnel pour créer des codes : ouvre-le
  dans un navigateur (en local, ou hébergé à part — **ne le mets pas sur le site du client**),
  renseigne l'adresse du Worker et `LICENSE_ADMIN_SECRET`, choisis la durée (1 mois, 6 mois,
  1 an, 2 ans, 5 ans, illimité, ou personnalisé en jours/date précise), puis génère le code à
  transmettre à ton client.
- Le client (Admin) colle ce code sur l'écran d'activation d'EasySkill, ou dans
  Paramètres > Licence pour un renouvellement. La durée démarre au moment de l'activation
  (sauf pour "date d'expiration précise", qui est fixe).
- Un même code ne peut être activé que par un seul centre.

## Déployer sur GitHub + Cloudflare
1. Crée un nouveau dépôt GitHub et pousse ces fichiers à la racine.
2. Sur Cloudflare, crée un projet **Pages** (ou **Workers Static Assets**) connecté à ce dépôt.
   - Dossier de build : `/` (racine, aucune commande de build nécessaire)
   - Dossier de sortie : `/`
3. Déploie. L'URL fournie par Cloudflare est ton app.
4. Sur Android (Chrome), ouvre l'URL puis "Ajouter à l'écran d'accueil" pour l'installer comme une app.

## Espaces
- **Espace Secrétariat** (code par défaut : `0000`) : inscriptions, paiements, filières/frais.
- **Espace Admin / Directeur** (code par défaut : `1234`) : tout ce qui précède + tableau de bord,
  enseignants/salaires, paramètres.

⚠️ Change les deux codes dans *Paramètres > Codes d'accès des espaces* dès la première utilisation.

## Fonctionnalités incluses
- Inscription d'élève avec sélection de filière et des frais applicables (frais généraux + frais
  spécifiques à la filière, ex. TP Hôtellerie-Restauration)
- Suivi des paiements par élève, solde automatique, historique
- Impression / export PDF de l'état de paiement (via l'impression du navigateur)
- Génération d'attestations et de diplômes en PDF (même mécanisme d'impression)
- Gestion des enseignants et de leurs salaires mensuels, historique des versements
- Gestion des filières et des frais de formation (montants modifiables, ajout/suppression)
- Tableau de bord (effectifs par filière, total encaissé, impayés, masse salariale)
- Sauvegarde exportable en JSON (Paramètres > Données)

## Personnalisation rapide
- Nom du centre, logo, année scolaire : *Paramètres* (espace Admin)
- Filières et frais : déjà pré-remplis selon l'affiche CFAP Formation, modifiables dans
  *Filières & Frais*
