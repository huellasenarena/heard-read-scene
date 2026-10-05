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
    env.DB.prepare('select id, oeuvre, texte, cree, modifie from notes order by cree')
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
