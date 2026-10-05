// Transforme data/liste-initiale.json en data/semis.sql, à exécuter une seule
// fois sur une base vide :
//
//   node outils/semer.mjs
//   cd worker && wrangler d1 execute heard-read-scene --remote --file ../data/semis.sql
//
// data/ n'est pas versionné : le dépôt est public, la liste ne l'est pas.

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const racine = new URL('../', import.meta.url);
const oeuvres = JSON.parse(readFileSync(new URL('data/liste-initiale.json', racine), 'utf8'));

const sql = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const maintenant = Date.now();

// Une milliseconde d'écart par œuvre, pour garder l'ordre du fichier.
const lignes = oeuvres.map((o, i) =>
  `insert into oeuvres (id, titre, format, auteur, langue, lien, statut, ajoute) values (` +
  [randomUUID(), o.titre, o.format, o.auteur, o.langue, o.lien].map(sql).join(', ') +
  `, 'liste', ${maintenant - oeuvres.length + i});`
);

writeFileSync(new URL('data/semis.sql', racine), lignes.join('\n') + '\n');
console.log(`${lignes.length} œuvres → data/semis.sql`);
