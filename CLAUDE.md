# heard-read-scene — contexte du projet

App personnelle pour suivre ce que j'ai vu, lu, entendu (l'archive) et ce qui
me reste à découvrir (la liste). **L'utilisateur parle français.** Un seul
utilisateur, sur iPad et Mac. Le but : **simple, minimaliste, direct.**

- Dépôt : `~/Desktop/heard-read-scene/`, remote `huellasenarena/heard-read-scene`, **public**
  (compte GitHub `huellasenarena`, pas `JNS99`)
- App : https://huellasenarena.github.io/heard-read-scene/ — Pages sert `main` depuis la racine
- Worker : https://heard-read-scene.georg-dreym.workers.dev — base D1 `heard-read-scene`
- **Sans dépendances ni compilation.** HTML/CSS/JS simples, choisis exprès. Pas de
  framework, pas de npm, pas d'étape de build sans en parler.

## Décisions déjà prises (ne pas les refaire sans demander)

- **Écrans** : accueil à quatre options (Ajouter à la liste, Créer une entrée,
  Liste, Archive) et une page par œuvre. Routage par hash (`#/liste`, `#/oeuvre/<id>`…).
- **Données** : deux tables (`worker/migrations/`). `oeuvres` : titre, format
  (`vidéo` / `texte` / `musique`), auteur, langue, lien, statut (`liste` / `archive`).
  `notes` : le fil de notes datées d'une œuvre.
- **Entrée** : créer une note sur une œuvre de la liste la fait passer dans l'archive.
  Si l'œuvre a déjà une entrée, la note s'ajoute à son fil. Une œuvre est identifiée
  par titre + format ; les homonymes se distinguent dans l'autocomplétion (auteur,
  langue, lien).
- **Langue** : langue originale pour les films (`muet`, `sans dialogue` existent aussi),
  langue de l'édition pour les livres. Filtre par langue dans Liste et Archive,
  affiché seulement s'il y a au moins deux langues à choisir.
- **Italique** : `*comme ça*`, avec le bouton *I* ou ⌘I. C'est le seul enrichissement.
- **Modifier** passe toujours par un bouton (« modifier »), jamais par un tap sur
  le texte, pour qu'on puisse le sélectionner. Toute suppression demande deux clics.
- **Style papier** : fond crème `#F4EEE1`, encre `#2B2620`, un seul accent rouge
  `#8A2E1C`, EB Garamond. Pas d'ombres ni de coins arrondis, **pas de mode sombre**.
- **Accès** : une phrase secrète (secret `PHRASE` du Worker, en-tête `X-Phrase`),
  saisie une fois par appareil. Toutes les routes l'exigent, y compris la lecture.
  **C'est l'utilisateur qui tape la phrase** (`wrangler secret put PHRASE`), jamais Claude.
- **Pas de mode hors ligne** : l'app garde un cache pour s'afficher vite, mais
  l'écriture exige le réseau. Après chaque écriture, elle recharge tout (`/tout`).

## Confidentialité

Le dépôt est public, la liste est privée. **`data/` n'est jamais versionné** (liste
de départ, `semis.sql`) : les données ne vivent que dans D1. Vérifier `git status`
avant chaque commit.

## Travailler

- Local : voir README (`wrangler dev` avec `PHRASE=essai-local` dans `worker/.dev.vars`,
  `python3 -m http.server 8000`). Si la base locale est vide : appliquer les migrations
  avec `--local`, puis `node outils/semer.mjs` et `wrangler d1 execute … --local --file ../data/semis.sql`.
- Tester : `node outils/essai-navigateur.mjs` (Chrome headless, tout le parcours ;
  `LARGEUR=390` pour le téléphone, `CAPTURES=dossier` pour des captures). Le faire passer
  avant de pousser.
- Déployer : `cd worker && wrangler deploy` pour le Worker, `git push` pour l'app.
- Le wrangler installé n'accepte pas de `compatibility_date` récente : garder `2026-04-07`.
