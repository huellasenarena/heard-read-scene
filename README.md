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
