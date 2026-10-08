# heard-read-scene

Ce que j'ai vu, lu, entendu, et ce qui me reste à découvrir.

- **App** : `index.html`, `style.css`, `app.js`, en JS sans framework ni compilation, servie par GitHub Pages.
- **Données** : Cloudflare D1, derrière un Worker (`worker/`). Toutes les routes exigent la phrase secrète (en-tête `X-Phrase`, secret `PHRASE` du Worker).
- `data/` (la liste de départ) n'est pas versionné : le dépôt est public, la liste ne l'est pas.

## Développer en local

```sh
cd worker
echo 'PHRASE=essai-local' > .dev.vars
wrangler d1 migrations apply heard-read-scene --local
wrangler dev                          # http://localhost:8787
# à la racine, dans un autre terminal :
python3 -m http.server 8000           # http://localhost:8000
node outils/essai-navigateur.mjs      # essai de bout en bout (Chrome headless)
```

## Déployer

```sh
cd worker && wrangler deploy          # le Worker
git push                              # l'app (GitHub Pages)
```

## Importer depuis iA Writer

`POST /importer` (avec `X-Phrase`) reçoit un texte brut :

```
Titre: Once Upon a Dream
Format: Musique

* page 3: 6:23; plus vite encore
```

L'œuvre est retrouvée par titre + format (`Auteur:` départage les homonymes),
ou créée dans l'archive ; une œuvre de la liste passe dans l'archive. Les notes
déjà dans son fil qui se retrouvent en entier dans le texte en sont retirées :
renvoyer un fichier pas encore effacé n'ajoute que ce qui est nouveau.

Le raccourci (iPad) : feuille de partage, entrée Texte et Fichiers ;
« Obtenir le contenu de l'URL » (POST, en-tête `X-Phrase`, corps Fichier =
Entrée du raccourci) ; « Afficher la notification » avec le contenu de l'URL.
