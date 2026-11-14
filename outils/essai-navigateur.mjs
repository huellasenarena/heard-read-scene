// Essai de bout en bout avec Chrome headless, par le protocole DevTools.
// Rien à installer. Contre la version locale :
//
//   cd worker && wrangler dev          (avec PHRASE=essai-local dans worker/.dev.vars)
//   python3 -m http.server 8000        (à la racine)
//   node outils/essai-navigateur.mjs   (CAPTURES=dossier pour garder des captures)
//
// Attention : écrit dans la base locale (une œuvre « Essai » qu'il supprime à la fin).

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFIL = mkdtempSync(join(tmpdir(), 'hrs-chrome-'));
const PORT = 9334;
const LARGEUR = Number(process.env.LARGEUR || 820);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  `--user-data-dir=${PROFIL}`, `--window-size=${LARGEUR},1100`, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => {
  chrome.kill();
  try { rmSync(PROFIL, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temporaire */ }
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
await attendre(2500);

const pages = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const ws = new WebSocket(pages.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let numero = 0;
const enAttente = new Map();
const erreurs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && enAttente.has(m.id)) { enAttente.get(m.id)(m); enAttente.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') erreurs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const envoyer = (method, params = {}) => new Promise((r) => {
  const i = ++numero; enAttente.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
await envoyer('Runtime.enable');
await envoyer('Page.enable');

const ev = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result.result.value;
};
const capture = async (nom) => {
  if (!process.env.CAPTURES) return;
  const r = await envoyer('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(process.env.CAPTURES, nom), Buffer.from(r.result.data, 'base64'));
};
let echecs = 0;
const verifier = (nom, ok, detail = '') => {
  if (!ok) echecs++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${nom}${ok ? '' : `  ← ${detail}`}`);
};
const aller = async (hash) => { await ev(`location.hash = '${hash}'`); await attendre(300); };
const texte = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
// Remplir un champ comme le ferait un clavier (déclenche « input »).
const taper = (sel, valeur) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
  el.focus(); el.value = ${JSON.stringify(valeur)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const cliquer = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const cliquerTexte = (sel, t) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})]
  .find((el) => el.textContent.trim() === ${JSON.stringify(t)}).click()`);

await envoyer('Page.navigate', { url: 'http://localhost:8000/' });
await attendre(800);

console.log('\nconnexion');
verifier('écran de connexion', (await texte('.principal')) === 'Entrer');
await capture('00-connexion.png');
await taper('input[type=password]', 'mauvaise');
await cliquer('.principal');
await attendre(400);
verifier('phrase refusée', (await texte('.message')) === 'Phrase incorrecte.', await texte('.message'));
await taper('input[type=password]', 'essai-local');
await cliquer('.principal');
await attendre(600);
verifier('accueil après connexion', (await ev("document.querySelectorAll('.accueil nav a').length")) === 4);
const avant = await ev("document.querySelectorAll('.accueil nav a span')[0].textContent");
verifier('compte de la liste', /^\d+ à découvrir$/.test(avant), avant);
await capture('01-accueil.png');

console.log('\najouter à la liste');
await aller('#/ajouter');
await taper('form input', 'Essai de titre');
await cliquer('form .principal');
await attendre(200);
verifier('format exigé', (await texte('.message')) === 'Choisis un format.', await texte('.message'));
await cliquerTexte('.choix button', 'musique');
await taper('input[list=langues]', 'Portugais');
await taper('input[inputmode=url]', 'example.org/disque');
await cliquer('form .principal');
await attendre(800);
verifier('confirmation', (await texte('.message')) === '« Essai de titre » est dans la liste.', await texte('.message'));
verifier('formulaire vidé', (await ev("document.querySelector('form input').value")) === '');
await taper('form input', 'essai de titres');
await cliquer('form .principal');
await attendre(200);
const doublon = await texte('.message');
verifier('titre proche signalé', doublon.startsWith('Il y a déjà « Essai de titre »'), doublon);
verifier('second clic pour ajouter quand même', (await texte('form .principal')) === 'Ajouter quand même', await texte('form .principal'));
await taper('form input', 'essai de titres bis');
verifier('modifier le titre réarme le bouton', (await texte('form .principal')) === 'Ajouter', await texte('form .principal'));
await taper('form input', '');

console.log('\nliste');
await aller('#/liste');
verifier("l'œuvre ajoutée est en tête", (await texte('.oeuvres .t')) === 'Essai de titre', await texte('.oeuvres .t'));
verifier('langue en minuscules, lien complété', (await texte('.oeuvres .m')) === 'musique · portugais · ↗', await texte('.oeuvres .m'));
await cliquerTexte('.choix button', 'texte');
await attendre(100);
const langues = await ev("[...document.querySelectorAll('.choix.petit button')].map((b) => b.textContent)");
verifier('filtre langue pour les textes', langues[0] === 'toutes langues' && langues.includes('espagnol'), langues.join(','));
await cliquerTexte('.choix.petit button', 'espagnol');
await attendre(100);
const formats = await ev("[...document.querySelectorAll('.oeuvres .m')].map((m) => m.textContent)");
verifier('seulement des textes en espagnol', formats.length > 0 && formats.every((m) => m.includes('texte · espagnol')), formats.slice(0, 3).join(' | '));
await cliquer('.barre .secondaire');
await attendre(100);
const tire = await texte('.tirage .t');
verifier('tirage au hasard', !!tire, 'rien');
const meta = await texte('.tirage .meta');
verifier('le tirage respecte les filtres', meta.includes('texte · espagnol'), meta);
await capture('02-liste-tirage.png');
await cliquerTexte('.tirage button', 'autre');
await attendre(100);
verifier('« autre » tire une autre œuvre', (await texte('.tirage .t')) !== tire);
await cliquerTexte('.choix button', 'tout');
await taper('.recherche', 'essai de');
await attendre(100);
verifier('recherche', (await ev("document.querySelectorAll('.oeuvres .t').length")) === 1);

console.log('\ntirage : il reste, et le × supprime');
await fetch('http://localhost:8787/oeuvres', {
  method: 'POST', headers: { 'X-Phrase': 'essai-local', 'Content-Type': 'application/json' },
  body: JSON.stringify({ titre: 'Zzyzx tirage', format: 'texte' })
});
await taper('.recherche', '');
await ev("document.activeElement.blur(); document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
await taper('.recherche', 'zzyzx');
await cliquer('.barre .secondaire');
await attendre(100);
verifier('tirage de la seule œuvre', (await texte('.tirage .t')) === 'Zzyzx tirage', await texte('.tirage .t'));
await cliquer('.tirage .t');
await attendre(300);
await aller('#/liste');
verifier("le tirage est encore là au retour de l'œuvre", (await texte('.tirage .t')) === 'Zzyzx tirage', await texte('.tirage .t'));
await ev("document.activeElement.blur(); document.querySelector('.recherche').value = ''");
await ev("document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
verifier("le tirage est encore là au retour d'un autre onglet", (await texte('.tirage .t')) === 'Zzyzx tirage', await texte('.tirage .t'));
await cliquer('.tirage .croix');
verifier('le × demande confirmation', (await texte('.tirage .croix')) === 'supprimer de la liste', await texte('.tirage .croix'));
await capture('02b-tirage-supprimer.png');
await cliquer('.tirage .croix');
await attendre(800);
verifier('œuvre supprimée, tirage retiré', !(await texte('.tirage')) &&
  !(await ev("[...document.querySelectorAll('.oeuvres .t')].some((t) => t.textContent === 'Zzyzx tirage')")));

console.log('\ntirage : ← →, copier, et ✓ ou × en tire une autre');
for (const titre of ['Qwxq un', 'Qwxq deux']) {
  await fetch('http://localhost:8787/oeuvres', {
    method: 'POST', headers: { 'X-Phrase': 'essai-local', 'Content-Type': 'application/json' },
    body: JSON.stringify({ titre, format: 'texte' })
  });
}
await taper('.recherche', '');
await ev("document.activeElement.blur(); document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
await taper('.recherche', 'qwxq');
await cliquer('.barre .secondaire');
await attendre(100);
const premier = await texte('.tirage .t');
await cliquerTexte('.tirage button', 'autre');
await attendre(100);
const second = await texte('.tirage .t');
verifier('« autre » tire la seconde', premier?.startsWith('Qwxq') && second?.startsWith('Qwxq') && premier !== second, `${premier} / ${second}`);
verifier('→ inactif sur le dernier tirage', await ev(`document.querySelector('.tirage [aria-label="Tirage suivant"]').disabled`));
await cliquer('.tirage [aria-label="Tirage précédent"]');
verifier('← revient au tirage précédent', (await texte('.tirage .t')) === premier, await texte('.tirage .t'));
await cliquer('.tirage [aria-label="Tirage suivant"]');
verifier('→ revient au suivant', (await texte('.tirage .t')) === second, await texte('.tirage .t'));
await capture('02d-tirage-fleches.png');
await ev('location.reload()');
await attendre(1200);
verifier('le tirage survit à la page rechargée', (await texte('.tirage .t')) === second, await texte('.tirage .t'));
await ev('navigator.clipboard.writeText = async (t) => { window.copie = t; }');
await cliquer('.tirage .copier');
await attendre(50);
verifier('copier le titre', (await ev('window.copie')) === second && (await texte('.tirage .copier')) === 'copié', await ev('window.copie'));
await taper('.recherche', 'qwxq');
await cliquer('.tirage .croix');
await cliquer('.tirage .croix');
await attendre(800);
verifier('après ×, une autre œuvre est tirée', (await texte('.tirage .t')) === premier, await texte('.tirage .t'));
await cliquer('.tirage .croix');
await cliquer('.tirage .croix');
await attendre(800);
verifier('plus rien à tirer', !(await texte('.tirage')) && (await texte('.vide')) === 'Rien à tirer avec ces filtres.', await texte('.vide'));
await fetch('http://localhost:8787/oeuvres', {
  method: 'POST', headers: { 'X-Phrase': 'essai-local', 'Content-Type': 'application/json' },
  body: JSON.stringify({ titre: 'Zzyzx ligne', format: 'texte' })
});
await taper('.recherche', '');
await ev("document.activeElement.blur(); document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
await taper('.recherche', 'zzyzx');
verifier('un × sur chaque ligne de la liste', (await ev("document.querySelectorAll('.oeuvres li .croix').length")) === 1);
await cliquer('.oeuvres .croix');
verifier('le × de la ligne demande confirmation', (await texte('.oeuvres .croix')) === 'supprimer de la liste');
await capture('02c-ligne-supprimer.png');
await cliquer('.oeuvres .croix');
await attendre(800);
verifier('la ligne est supprimée', (await ev("document.querySelectorAll('.oeuvres .croix').length")) === 0);
await taper('.recherche', '');

console.log('\ncréer une entrée depuis la liste');
await aller('#/entree');
await taper('input[role=combobox]', 'essai');
await attendre(100);
verifier('suggestion', (await texte('.suggestions .t')) === 'Essai de titre', await texte('.suggestions .t'));
await capture('03-autocompletion.png');
await cliquer('.suggestions button');
await attendre(100);
verifier('œuvre choisie', (await texte('.choisie span'))?.startsWith('musique · portugais · liste'), await texte('.choisie span'));
verifier('les champs de nouvelle œuvre sont cachés', await ev("document.querySelector('.champs-nouvelle').style.display === 'none'"));
await ev(`(() => { const z = document.querySelector('textarea'); z.value = 'Un disque très beau'; z.setSelectionRange(15, 19); })()`);
await cliquer('.italique');
verifier('bouton italique', (await ev("document.querySelector('textarea').value")) === 'Un disque très *beau*');
await capture('04-entree.png');
await cliquer('form .principal');
await attendre(900);
verifier("ouvre la page de l'œuvre", (await ev('location.hash')).startsWith('#/oeuvre/'));
verifier('italique rendu', (await ev("document.querySelector('.texte em')?.textContent")) === 'beau');
verifier("l'œuvre est passée dans l'archive", (await texte('.retour')) === '← archive');
await capture('05-oeuvre.png');

console.log('\najouter une note au fil');
await cliquerTexte('a', '+ ajouter une note');
await attendre(300);
verifier('œuvre préchoisie', (await ev("document.querySelector('input[role=combobox]').value")) === 'Essai de titre');
await ev("document.querySelector('textarea').value = 'Deuxième écoute.'");
await cliquer('form .principal');
await attendre(900);
verifier('deux notes dans le fil', (await ev("document.querySelectorAll('.note').length")) === 2);

console.log('\ntitre tapé sans suggestion → même œuvre');
await aller('#/entree');
await taper('input[role=combobox]', 'ESSAI DE TITRE');
await cliquerTexte('.choix button', 'musique');
await ev("document.querySelector('textarea').value = 'Troisième.'");
await ev("document.activeElement.blur()");
await cliquer('form .principal');
await attendre(900);
verifier('trois notes, pas de doublon', (await ev("document.querySelectorAll('.note').length")) === 3);

console.log('\nmodifier une note');
await cliquerTexte('.note button', 'modifier');
await ev("document.querySelector('.note textarea').value = 'Première note, corrigée.'");
await cliquer('.note .principal');
await attendre(900);
verifier('note modifiée', (await texte('.note .texte')) === 'Première note, corrigée.', await texte('.note .texte'));

console.log('\narchive');
await aller('#/archive');
verifier("l'œuvre est en tête de l'archive", (await texte('.oeuvres .t')) === 'Essai de titre');
await taper('.recherche', 'corrigee');
await attendre(100);
verifier('recherche dans le texte des notes, sans accents', (await ev("document.querySelectorAll('.oeuvres .t').length")) === 1);
await capture('06-archive.png');
verifier('pas de « false » dans les filtres', !(await texte('.filtres')).includes('false'), await texte('.filtres'));

console.log("\nsupprimer l'œuvre");
await cliquer('.oeuvres a');
await attendre(300);
await cliquerTexte('button', "modifier l'œuvre");
await attendre(100);
await cliquerTexte('button', "supprimer l'œuvre et ses 3 notes");
verifier('demande confirmation', !!(await ev("[...document.querySelectorAll('button')].find((b) => b.textContent === 'confirmer la suppression')")));
await cliquerTexte('button', 'confirmer la suppression');
await attendre(900);
verifier("retour à l'archive", (await ev('location.hash')) === '#/archive');
await aller('#/');
verifier('compte revenu à son état initial', (await ev("document.querySelectorAll('.accueil nav a span')[0].textContent")) === avant);

console.log('\narchiver sans note');
const { oeuvre: zz } = await (await fetch('http://localhost:8787/oeuvres', {
  method: 'POST', headers: { 'X-Phrase': 'essai-local', 'Content-Type': 'application/json' },
  body: JSON.stringify({ titre: 'Zzyzx archiver', format: 'texte' })
})).json();
await ev("document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
await aller(`#/oeuvre/${zz.id}`);
await cliquerTexte('button', 'archiver sans note');
await attendre(900);
verifier("l'œuvre est passée dans l'archive", (await texte('.retour')) === '← archive', await texte('.retour'));
verifier('« archivée le …, sans note »', /^Archivée le .+, sans note\.$/.test(await texte('.notes .vide')), await texte('.notes .vide'));
await capture('07-archivee-sans-note.png');
await aller('#/archive');
await taper('.recherche', '');
verifier("en tête de l'archive, « sans note »", (await texte('.oeuvres .t')) === 'Zzyzx archiver' &&
  (await texte('.oeuvres .m')).startsWith('texte · sans note · '), await texte('.oeuvres .m'));
await aller(`#/oeuvre/${zz.id}`);
await cliquerTexte('button', 'remettre dans la liste');
await attendre(900);
verifier('remise dans la liste', (await texte('.retour')) === '← liste', await texte('.retour'));
await aller('#/liste');
await taper('.recherche', 'zzyzx');
await cliquer('.oeuvres .coche');
verifier('le ✓ de la ligne demande confirmation', (await texte('.oeuvres .coche')) === 'archiver', await texte('.oeuvres .coche'));
await capture('02d-ligne-archiver.png');
await cliquer('.oeuvres .coche');
await attendre(800);
verifier('le ✓ archive : la ligne quitte la liste', (await ev("document.querySelectorAll('.oeuvres .coche').length")) === 0);
await taper('.recherche', '');
await aller(`#/oeuvre/${zz.id}`);
verifier('archivée sans note par le ✓', /^Archivée le/.test(await texte('.notes .vide')), await texte('.notes .vide'));
await cliquerTexte('button', 'remettre dans la liste');
await attendre(900);

await aller('#/entree');
await taper('input[role=combobox]', 'zzyzx arch');
await attendre(100);
await cliquer('.suggestions button');
await attendre(100);
verifier('note vide annoncée', (await texte('.actions .pale')) === "sans note : passera dans l'archive", await texte('.actions .pale'));
await cliquer('form .principal');
await attendre(900);
verifier('entrée sans note → archive', (await texte('.retour')) === '← archive' && (await ev("document.querySelectorAll('.note').length")) === 0);
await aller(`#/entree?oeuvre=${zz.id}`);
await cliquer('form .principal');
await attendre(200);
verifier('note vide refusée sur une œuvre déjà archivée', (await texte('.message')) === 'La note est vide.', await texte('.message'));

await aller('#/entree');
await taper('input[role=combobox]', 'Zzyzx jamais listée');
await ev("document.activeElement.blur()");
await cliquerTexte('.choix button', 'vidéo');
await cliquer('form .principal');
await attendre(900);
const nouvelleId = (await ev('location.hash')).slice('#/oeuvre/'.length);
verifier('nouvelle œuvre créée directement dans l\'archive, sans note', (await texte('.retour')) === '← archive' &&
  /^Archivée le/.test(await texte('.notes .vide')), await texte('.notes .vide'));
for (const id of [zz.id, nouvelleId]) {
  await fetch(`http://localhost:8787/oeuvres/${id}`, { method: 'DELETE', headers: { 'X-Phrase': 'essai-local' } });
}
await ev("document.dispatchEvent(new Event('visibilitychange'))");
await attendre(500);
await aller('#/');
verifier('compte de la liste inchangé', (await ev("document.querySelectorAll('.accueil nav a span')[0].textContent")) === avant);

verifier('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est bon');
process.exit(echecs ? 1 : 0);
