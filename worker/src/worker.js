// Worker de heard-read-scene : la liste et l'archive, partagées entre l'iPad
// et le Mac.
//
// Authentification : une phrase secrète dans l'en-tête X-Phrase, comparée au
// secret PHRASE du Worker. Un seul utilisateur ; toutes les routes l'exigent,
// la lecture comme l'écriture, puisque les notes sont privées.

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Phrase',
  'Access-Control-Max-Age': '86400'
};

const FORMATS = ['vidéo', 'texte', 'musique'];

const json = (donnees, statut = 200) =>
  new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...ENTETES }
  });

class Refus extends Error {}

// Comparaison en temps constant, pour ne pas laisser deviner la phrase caractère par caractère.
function egal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const ligne = (s, max = 500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Les champs d'une œuvre envoyés par l'app. `partiel` : seuls les champs présents comptent (PATCH).
function champsOeuvre(corps, partiel) {
  const champs = {};
  if (!partiel || 'titre' in corps) {
    champs.titre = ligne(corps.titre);
    if (!champs.titre) throw new Refus('titre manquant');
  }
  if (!partiel || 'format' in corps) {
    champs.format = corps.format;
    if (!FORMATS.includes(champs.format)) throw new Refus('format inconnu');
  }
  for (const nom of ['auteur', 'langue', 'lien']) {
    if (!partiel || nom in corps) champs[nom] = ligne(corps[nom]);
  }
  if (champs.langue) champs.langue = champs.langue.toLowerCase();
  return champs;
}

function texteNote(corps) {
  const texte = String(corps.texte ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 50000);
  if (!texte) throw new Refus('note vide');
  return texte;
}

export default {
  async fetch(requete, env) {
    const url = new URL(requete.url);
    const morceaux = url.pathname.split('/').filter(Boolean);
    const [ressource, id] = morceaux;
    const methode = requete.method;

    if (methode === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES });
    if (morceaux.length === 0) return json({ ok: true, service: 'heard-read-scene' });

    if (!env.PHRASE) return json({ erreur: "le Worker n'a pas de phrase configurée" }, 500);
    if (!egal(requete.headers.get('X-Phrase') || '', env.PHRASE)) {
      return json({ erreur: 'phrase incorrecte' }, 401);
    }

    try {
      if (ressource === 'importer' && methode === 'POST') return await importer(await requete.text(), url.searchParams.has('continuer'), requete.cf?.timezone, env);
      const corps = methode === 'POST' || methode === 'PATCH' ? await requete.json() : {};
      if (ressource === 'tout' && methode === 'GET') return await tout(env);
      if (ressource === 'oeuvres' && !id && methode === 'POST') return await creerOeuvre(corps, env);
      if (ressource === 'oeuvres' && id && methode === 'PATCH') return await modifierOeuvre(id, corps, env);
      if (ressource === 'oeuvres' && id && methode === 'DELETE') return await supprimerOeuvre(id, env);
      if (ressource === 'notes' && !id && methode === 'POST') return await creerNote(corps, env);
      if (ressource === 'notes' && id && methode === 'PATCH') return await modifierNote(id, corps, env);
      if (ressource === 'notes' && id && methode === 'DELETE') return await supprimerNote(id, env);
      return json({ erreur: 'route inconnue' }, 404);
    } catch (e) {
      if (e instanceof Refus) return json({ erreur: e.message }, 400);
      if (e instanceof SyntaxError) return json({ erreur: 'JSON invalide' }, 400);
      return json({ erreur: String(e?.message || e) }, 500);
    }
  }
};

// Tout d'un coup : quelques centaines de lignes, l'app filtre et cherche elle-même.
async function tout(env) {
  const [oeuvres, notes] = await env.DB.batch([
    env.DB.prepare('select id, titre, format, auteur, langue, lien, statut, ajoute from oeuvres'),
    env.DB.prepare('select id, oeuvre, texte, cree, modifie, ajout from notes order by cree')
  ]);
  return json({ oeuvres: oeuvres.results, notes: notes.results });
}

// Ajouter à la liste.
async function creerOeuvre(corps, env) {
  const o = { id: crypto.randomUUID(), ...champsOeuvre(corps, false), statut: 'liste', ajoute: Date.now() };
  await env.DB.prepare(
    'insert into oeuvres (id, titre, format, auteur, langue, lien, statut, ajoute) values (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(o.id, o.titre, o.format, o.auteur, o.langue, o.lien, o.statut, o.ajoute).run();
  return json({ oeuvre: o }, 201);
}

async function modifierOeuvre(id, corps, env) {
  const champs = champsOeuvre(corps, true);
  const noms = Object.keys(champs);
  if (noms.length === 0) throw new Refus('rien à modifier');
  const { meta } = await env.DB.prepare(
    `update oeuvres set ${noms.map((n) => `${n} = ?`).join(', ')} where id = ?`
  ).bind(...noms.map((n) => champs[n]), id).run();
  if (meta.changes === 0) return json({ erreur: 'œuvre introuvable' }, 404);
  return json({ ok: true });
}

async function supprimerOeuvre(id, env) {
  await env.DB.batch([
    env.DB.prepare('delete from notes where oeuvre = ?').bind(id),
    env.DB.prepare('delete from oeuvres where id = ?').bind(id)
  ]);
  return json({ ok: true });
}

// Créer une entrée : une note sur une œuvre existante (qui quitte la liste si
// elle y était), ou sur une nouvelle œuvre créée directement dans l'archive.
async function creerNote(corps, env) {
  const note = { id: crypto.randomUUID(), texte: texteNote(corps), cree: Date.now() };
  const requetes = [];

  if (corps.oeuvre) {
    const existe = await env.DB.prepare('select id from oeuvres where id = ?').bind(corps.oeuvre).first();
    if (!existe) return json({ erreur: 'œuvre introuvable' }, 404);
    note.oeuvre = corps.oeuvre;
    requetes.push(env.DB.prepare("update oeuvres set statut = 'archive' where id = ?").bind(note.oeuvre));
  } else {
    const o = { id: crypto.randomUUID(), ...champsOeuvre(corps, false) };
    note.oeuvre = o.id;
    requetes.push(env.DB.prepare(
      "insert into oeuvres (id, titre, format, auteur, langue, lien, statut, ajoute) values (?, ?, ?, ?, ?, ?, 'archive', ?)"
    ).bind(o.id, o.titre, o.format, o.auteur, o.langue, o.lien, note.cree));
  }

  requetes.push(env.DB.prepare('insert into notes (id, oeuvre, texte, cree) values (?, ?, ?, ?)')
    .bind(note.id, note.oeuvre, note.texte, note.cree));
  await env.DB.batch(requetes);
  return json({ note }, 201);
}

async function modifierNote(id, corps, env) {
  const { meta } = await env.DB.prepare('update notes set texte = ?, modifie = ? where id = ?')
    .bind(texteNote(corps), Date.now(), id).run();
  if (meta.changes === 0) return json({ erreur: 'note introuvable' }, 404);
  return json({ ok: true });
}

// Une œuvre qui perd sa dernière note reste dans l'archive, sans notes : on ne
// la renvoie pas dans la liste en douce.
async function supprimerNote(id, env) {
  await env.DB.prepare('delete from notes where id = ?').bind(id).run();
  return json({ ok: true });
}

// Importer un fichier texte (depuis un raccourci iA Writer). En tête, des lignes
// « Clé: valeur » (Titre, Format, et au besoin Auteur, Langue, Lien) ; le reste
// devient une note sur cette œuvre, telle quelle. Si une note du fil s'y trouve
// déjà en entier (texte d'une séance précédente pas effacé ?), rien n'est ajouté :
// la réponse commence par « ⚠︎ » et le raccourci demande s'il faut continuer,
// auquel cas il renvoie avec `?continuer`. Réponse en texte simple, pour le raccourci.
const CLES = { titre: 'titre', format: 'format', auteur: 'auteur', langue: 'langue', lien: 'lien', type: 'type' };
const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const texte = (message, statut = 200) =>
  new Response(message, { status: statut, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ENTETES } });
// Pour comparer : fins de ligne unifiées, sans espaces en bout de ligne.
const normaliser = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

// Comparer des titres : comme dans app.js (normaliser, seRessemblent).
const cleTitre = (s) => sansAccents(String(s ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();
const sansArticle = (s) => cleTitre(s).replace(/^(le|la|les|l|un|une|des|the|a|an|el|los|las|il|lo|gli|der|die|das) /, '');
function distance(a, b) {
  let avant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const ligne = [i];
    for (let j = 1; j <= b.length; j++) {
      ligne[j] = Math.min(avant[j] + 1, ligne[j - 1] + 1, avant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    avant = ligne;
  }
  return avant[b.length];
}
function seRessemblent(x, y) {
  const a = sansArticle(x), b = sansArticle(y);
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a.match(/\d+/g) || []).join() !== (b.match(/\d+/g) || []).join()) return false;
  const ma = new Set(a.split(' ')), mb = new Set(b.split(' '));
  const communs = [...ma].filter((m) => mb.has(m)).length;
  if ((2 * communs) / (ma.size + mb.size) >= 0.8) return true;
  return 1 - distance(a, b) / Math.max(a.length, b.length) >= 0.8;
}

// « --- » sépare les séances dans le fichier (aussi « * --- », quand iA Writer
// continue la liste). Dans la note, chaque ajout commence par « — 8 octobre 2026 ».
const SEPARATEUR = /^\s*(?:[*+-]\s*)?-{3,}\s*$/;
const DATE_AJOUT = /^— \d{1,2} \p{L}+ \d{4}$/u;
const puceVide = (l) => /^\s*[*+-]\s*$/.test(l);
// Les puces vides (celle qu'on laisse en bas pour la suite) ne comptent pas.
const nettoyer = (lignes) => lignes.filter((l) => !puceVide(l)).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
// Pour comparer le haut du fichier à la note : sans séparateurs, dates ni blancs.
const empreinte = (s) => normaliser(s).split('\n')
  .filter((l) => !SEPARATEUR.test(l) && !DATE_AJOUT.test(l.trim()) && !puceVide(l))
  .join('').replace(/\s+/g, '');
const jourFr = (ms, fuseau) => new Date(ms).toLocaleDateString('fr-FR',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: fuseau || 'Europe/Paris' });

async function importer(brut, continuer, fuseau, env) {
  const lignes = normaliser(brut).split('\n');
  const champs = {};
  let i = 0;
  for (; i < lignes.length; i++) {
    if (!lignes[i].trim()) continue;
    const m = lignes[i].match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    const cle = m && CLES[sansAccents(m[1])];
    if (!cle) break;
    champs[cle] = m[2];
  }
  if (!champs.titre) return texte('Il manque la ligne « Titre: … » en tête du fichier.', 400);
  const format = FORMATS.find((f) => sansAccents(f) === sansAccents(champs.format || ''));
  if (!format) return texte('Il manque la ligne « Format: » (Vidéo, Texte ou Musique).', 400);
  champs.titre = ligne(champs.titre);
  champs.format = format;
  const type = sansAccents(champs.type || '').trim();
  if (type && type !== 'addition' && type !== 'nouveau') {
    return texte('La ligne « Type: » vaut Addition ou Nouveau.', 400);
  }

  // L'œuvre, par titre + format ; l'auteur départage les homonymes.
  const { results } = await env.DB.prepare('select id, titre, auteur, statut from oeuvres where format = ?')
    .bind(format).all();
  let trouvees = results.filter((o) => cleTitre(o.titre) === cleTitre(champs.titre));
  if (trouvees.length > 1 && champs.auteur) {
    trouvees = trouvees.filter((o) => cleTitre(o.auteur) === cleTitre(champs.auteur));
  }
  if (trouvees.length > 1) {
    return texte(`Plusieurs œuvres « ${champs.titre} » : ajoute une ligne « Auteur: … » pour choisir.`, 400);
  }
  const oeuvre = trouvees[0];

  // Pas trouvée : avant d'en créer une, signaler celles dont le titre ressemble.
  if (!oeuvre && !continuer) {
    const proches = results.filter((o) => seRessemblent(o.titre, champs.titre));
    if (proches.length) {
      const noms = proches.map((o) => `« ${o.titre} »${o.auteur ? ` (${o.auteur})` : ''}`).join(', ');
      return texte(`⚠︎ Aucune œuvre « ${champs.titre} », mais il y a ${noms}. Créer une nouvelle œuvre ?`);
    }
  }

  // « Type: Addition » : le fichier garde toute la note ; seul ce qui suit le
  // dernier « --- » s'ajoute à la dernière note du fil. Sans note, comme Nouveau.
  if (type === 'addition' && oeuvre) {
    const { results: [derniere] } = await env.DB.prepare(
      'select id, texte, cree from notes where oeuvre = ? order by cree desc limit 1').bind(oeuvre.id).all();
    if (derniere) return await ajouter(oeuvre, derniere, lignes.slice(i), continuer, fuseau, env);
  }

  const corps = nettoyer(lignes.slice(i));
  // Rien que des blancs ou de la ponctuation : rien à ajouter.
  if (!/[\p{L}\p{N}]/u.test(corps)) return texte(`${oeuvre?.titre || champs.titre} : rien à ajouter.`);

  if (oeuvre && !continuer) {
    const { results: notes } = await env.DB.prepare('select texte, cree from notes where oeuvre = ? order by cree desc')
      .bind(oeuvre.id).all();
    const deja = notes.find((n) => normaliser(n.texte) && corps.includes(normaliser(n.texte)));
    if (deja) {
      const jour = jourFr(deja.cree, fuseau);
      const debut = ligne(deja.texte, 60);
      return texte(`⚠︎ Il paraît que ce texte contient déjà la note du ${jour} (« ${debut}${debut.length < ligne(deja.texte).length ? '…' : ''} »). Continuer ?`);
    }
  }

  const maintenant = Date.now();
  const requetes = [];
  let id = oeuvre?.id;
  if (oeuvre) {
    requetes.push(env.DB.prepare("update oeuvres set statut = 'archive' where id = ?").bind(id));
  } else {
    const o = { id: crypto.randomUUID(), ...champsOeuvre(champs, false) };
    id = o.id;
    requetes.push(env.DB.prepare(
      "insert into oeuvres (id, titre, format, auteur, langue, lien, statut, ajoute) values (?, ?, ?, ?, ?, ?, 'archive', ?)"
    ).bind(o.id, o.titre, o.format, o.auteur, o.langue, o.lien, maintenant));
  }
  requetes.push(env.DB.prepare('insert into notes (id, oeuvre, texte, cree) values (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, corps, maintenant));
  await env.DB.batch(requetes);

  const ou = !oeuvre ? ' (nouvelle œuvre dans l’archive)' : oeuvre.statut === 'liste' ? ' (passée dans l’archive)' : '';
  return texte(`✓ ${oeuvre?.titre || champs.titre} : note ajoutée${ou}.`, 201);
}

async function ajouter(oeuvre, note, lignes, continuer, fuseau, env) {
  const k = lignes.findLastIndex((l) => SEPARATEUR.test(l));
  if (k < 0) return texte(`${oeuvre.titre} : il manque une ligne « --- » avant les nouvelles lignes.`, 400);
  const nouveau = nettoyer(lignes.slice(k + 1));
  if (!/[\p{L}\p{N}]/u.test(nouveau)) return texte(`${oeuvre.titre} : rien à ajouter après le dernier « --- ».`);

  // Le haut du fichier doit être la note telle qu'elle est déjà enregistrée.
  const jour = jourFr(note.cree, fuseau);
  const avant = lignes.slice(0, k).join('\n');
  if (!continuer && empreinte(avant) !== empreinte(note.texte)) {
    return texte(empreinte(avant + nouveau) === empreinte(note.texte)
      ? `⚠︎ Les lignes après le dernier « --- » sont déjà dans la note du ${jour}. Les ajouter encore ?`
      : `⚠︎ Le texte avant le dernier « --- » ne correspond pas à la note du ${jour} (un « --- » oublié ?). Ajouter quand même ?`);
  }

  const maintenant = Date.now();
  await env.DB.prepare('update notes set texte = ?, ajout = ? where id = ?')
    .bind(`${note.texte}\n\n— ${jourFr(maintenant, fuseau)}\n\n${nouveau}`, maintenant, note.id).run();
  return texte(`✓ ${oeuvre.titre} : ajouté à la note du ${jour}.`, 201);
}
