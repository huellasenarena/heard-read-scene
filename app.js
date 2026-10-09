// heard-read-scene : ce que j'ai vu, lu, entendu, et ce qui me reste à découvrir.
//
// Vanilla, sans compilation. Les données vivent dans D1, derrière un Worker
// (worker/src/worker.js) ; l'app les charge d'un coup au démarrage, les garde en
// cache pour s'afficher tout de suite, et recharge tout après chaque écriture.

const SERVEUR = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787'
  : 'https://heard-read-scene.georg-dreym.workers.dev';

const CLE_PHRASE = 'hrs-phrase';
const CLE_CACHE = 'hrs-donnees';
const FORMATS = ['vidéo', 'texte', 'musique'];

// ---------------------------------------------------------------- stockage

function lire(cle) {
  try { return localStorage.getItem(cle); } catch { return null; }
}
function ecrire(cle, valeur) {
  try {
    if (valeur == null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch { /* navigation privée : tant pis pour le cache */ }
}

let donnees = { oeuvres: [], notes: [] };
try { donnees = JSON.parse(lire(CLE_CACHE)) || donnees; } catch { /* cache illisible */ }

// ---------------------------------------------------------------- serveur

async function api(chemin, { methode = 'GET', corps } = {}) {
  let reponse;
  try {
    reponse = await fetch(SERVEUR + chemin, {
      method: methode,
      headers: { 'X-Phrase': lire(CLE_PHRASE) || '', ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined
    });
  } catch {
    throw new Error("Pas de connexion : rien n'a été enregistré.");
  }
  const resultat = await reponse.json().catch(() => ({}));
  if (reponse.status === 401) {
    ecrire(CLE_PHRASE, null);
    throw new Error('Phrase incorrecte.');
  }
  if (!reponse.ok) throw new Error(resultat.erreur || `Erreur ${reponse.status}.`);
  return resultat;
}

async function charger() {
  donnees = await api('/tout');
  ecrire(CLE_CACHE, JSON.stringify(donnees));
}

// Écrire, puis tout recharger : quelques centaines de lignes, et l'app ne peut
// pas diverger de la base.
async function envoyer(chemin, options) {
  const resultat = await api(chemin, options);
  await charger();
  return resultat;
}

// Après un échec : si la phrase a été refusée, retour à l'écran de connexion.
function echec(erreur, message) {
  if (!lire(CLE_PHRASE)) return afficher();
  message.textContent = erreur.message;
  message.classList.add('erreur');
}

// ---------------------------------------------------------------- outils

function h(balise, attributs, ...enfants) {
  const el = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs || {})) {
    if (valeur == null || valeur === false) continue;
    if (nom.startsWith('on')) el.addEventListener(nom.slice(2), valeur);
    else if (nom === 'html') el.innerHTML = valeur;
    else if (nom === 'value') el.value = valeur;
    else el.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat()) {
    if (enfant != null && enfant !== false) el.append(enfant);
  }
  return el;
}

const normaliser = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Deux titres qui se ressemblent : les mêmes mots dans le désordre, ou à une
// faute de frappe près (80 % des lettres en commun). L'article du début ne compte
// pas ; des numéros différents (n° 1, n° 2, Dune 2…) en font deux œuvres distinctes.
const sansArticle = (s) => normaliser(s).replace(/^(le|la|les|l|un|une|des|the|a|an|el|los|las|il|lo|gli|der|die|das) /, '');
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

const jourFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateFr = (ms) => jourFr.format(new Date(ms));
const jourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
// Une note prolongée par import (« Type: Addition ») : « 3 octobre – 8 octobre 2026 ».
function datesNote(n) {
  if (!n.ajout || dateFr(n.ajout) === dateFr(n.cree)) return dateFr(n.cree);
  const memeAnnee = new Date(n.ajout).getFullYear() === new Date(n.cree).getFullYear();
  return `${memeAnnee ? jourMois.format(new Date(n.cree)) : dateFr(n.cree)} – ${dateFr(n.ajout)}`;
}
const pluriel = (n, mot, mots = mot + 's') => `${n} ${n === 1 ? mot : mots}`;

const echapper = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Le seul enrichissement : *italique*, comme en Markdown.
const enrichir = (texte) => echapper(texte).replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

const estUnLien = (lien) => /^https?:\/\//i.test(lien || '');
function domaine(lien) {
  try { return new URL(lien).hostname.replace(/^www\./, ''); } catch { return lien; }
}
const completerLien = (lien) => (lien && !/^[a-z]+:\/\//i.test(lien) ? 'https://' + lien : lien);

function notesParOeuvre() {
  const index = new Map();
  for (const n of donnees.notes) {
    if (!index.has(n.oeuvre)) index.set(n.oeuvre, []);
    index.get(n.oeuvre).push(n);
  }
  return index;
}

const trouver = (id) => donnees.oeuvres.find((o) => o.id === id);
const descriptif = (o) => [o.auteur, o.format, o.langue].filter(Boolean).join(' · ');

function languesConnues() {
  const compte = new Map();
  for (const o of donnees.oeuvres) if (o.langue) compte.set(o.langue, (compte.get(o.langue) || 0) + 1);
  return [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

// Des boutons dont un seul est enfoncé, comme pour le format.
function choix(options, courant, surChoix, classe = '') {
  const boutons = options.map(([valeur, libelle]) => {
    const bouton = h('button', { type: 'button', 'aria-pressed': String(valeur === courant) }, libelle);
    bouton.addEventListener('click', () => {
      for (const b of boutons) b.setAttribute('aria-pressed', String(b === bouton));
      surChoix(valeur);
    });
    return bouton;
  });
  return h('div', { class: `choix ${classe}`, role: 'group' }, boutons);
}

let numero = 0;
function champ(libelle, attributs, facultatif) {
  const id = `champ-${++numero}`;
  const input = h('input', { id, autocomplete: 'off', ...attributs });
  const bloc = h('div', { class: 'champ' },
    h('label', { for: id, class: 'etiquette' }, libelle, facultatif && h('i', {}, ' — facultatif')),
    input);
  bloc.input = input;
  return bloc;
}

// Deux temps pour tout ce qui supprime : le premier clic arme, le second agit.
function boutonSupprimer(libelle, confirmation, action) {
  const bouton = h('button', { type: 'button', class: 'discret danger' }, libelle);
  let arme = false;
  bouton.addEventListener('click', () => {
    if (arme) return action();
    arme = true;
    bouton.textContent = confirmation;
    setTimeout(() => { arme = false; bouton.textContent = libelle; }, 4000);
  });
  return bouton;
}

// *italique* autour de la sélection, ou retiré s'il y est déjà.
function basculerItalique(zone) {
  const { selectionStart: debut, selectionEnd: fin, value } = zone;
  const selection = value.slice(debut, fin);
  if (debut !== fin && value[debut - 1] === '*' && value[fin] === '*') {
    zone.setRangeText(selection, debut - 1, fin + 1);
    zone.setSelectionRange(debut - 1, fin - 1);
  } else {
    zone.setRangeText(`*${selection}*`, debut, fin);
    zone.setSelectionRange(debut + 1, fin + 1);
  }
  zone.focus();
}

function editeurNote(libelle, valeur = '') {
  const id = `note-${++numero}`;
  const zone = h('textarea', { id, value: valeur });
  zone.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      basculerItalique(zone);
    }
  });
  const bloc = h('div', { class: 'champ' },
    h('div', { class: 'tete-note' },
      h('label', { for: id, class: 'etiquette' }, libelle),
      h('button', {
        type: 'button', class: 'italique', 'aria-label': 'Italique (⌘I)', title: 'Italique (⌘I)',
        onmousedown: (e) => e.preventDefault(), onclick: () => basculerItalique(zone)
      }, 'I')),
    zone);
  bloc.zone = zone;
  return bloc;
}

const retour = (cible = '#/', libelle = 'accueil') => h('a', { href: cible, class: 'retour' }, `← ${libelle}`);

// ---------------------------------------------------------------- écrans

function connexion() {
  const phrase = champ('Phrase secrète', { type: 'password', autocomplete: 'current-password' });
  const message = h('p', { class: 'message' });
  const formulaire = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!phrase.input.value) return;
      ecrire(CLE_PHRASE, phrase.input.value);
      message.textContent = '…';
      message.classList.remove('erreur');
      try {
        await charger();
        afficher();
      } catch (erreur) {
        ecrire(CLE_PHRASE, null);
        message.textContent = erreur.message;
        message.classList.add('erreur');
      }
    }
  }, phrase, h('button', { class: 'principal' }, 'Entrer'), message);
  return h('div', { class: 'connexion' },
    h('div', { class: 'etiquette' }, 'heard · read · scene'), formulaire);
}

function accueil() {
  const enListe = donnees.oeuvres.filter((o) => o.statut === 'liste').length;
  const enArchive = donnees.oeuvres.length - enListe;
  const lien = (cible, libelle, note) => h('a', { href: cible }, libelle, note && h('span', {}, note));
  const aujourdhui = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date());
  return h('div', { class: 'accueil' },
    h('div', { class: 'marque' }, 'heard · read · scene'),
    h('nav', {},
      lien('#/ajouter', 'Ajouter à la liste'),
      lien('#/entree', 'Créer une entrée'),
      lien('#/liste', 'Liste', `${enListe} à découvrir`),
      lien('#/archive', 'Archive', pluriel(enArchive, 'entrée'))),
    h('div', { class: 'date' }, aujourdhui));
}

// Avant de créer une œuvre : celles du même format dont le titre ressemble. On
// les signale, et un second clic sur le bouton crée quand même (homonymes).
function avertirSiDoublon(titre, format, message, bouton, libelle) {
  const cle = `${normaliser(titre)}|${format}`;
  if (bouton.dataset.confirme === cle) return false;
  const proches = donnees.oeuvres.filter((o) => o.format === format && seRessemblent(o.titre, titre));
  if (proches.length === 0) return false;
  bouton.dataset.confirme = cle;
  bouton.textContent = `${libelle} quand même`;
  message.classList.add('erreur');
  message.replaceChildren(proches.length === 1 ? 'Il y a déjà ' : 'Il y a déjà : ',
    ...proches.flatMap((o, i) => [i ? ', ' : '',
      h('a', { href: `#/oeuvre/${o.id}` }, `« ${o.titre} »`),
      ` (${[o.auteur, o.statut].filter(Boolean).join(', ')})`]),
    '.');
  return true;
}
const rearmer = (bouton, libelle) => { delete bouton.dataset.confirme; bouton.textContent = libelle; };

function datalistLangues() {
  return h('datalist', { id: 'langues' }, languesConnues().map((l) => h('option', { value: l })));
}

function ajouter() {
  let format = '';
  const titre = champ('Titre', {});
  const auteur = champ('Auteur', { class: 'petit' }, true);
  const langue = champ('Langue', { class: 'petit', list: 'langues' }, true);
  const lien = champ('Lien', { class: 'petit', placeholder: 'https://', inputmode: 'url' }, true);
  const message = h('p', { class: 'message', role: 'status' });
  const bouton = h('button', { class: 'principal' }, 'Ajouter');
  const formats = choix(FORMATS.map((f) => [f, f]), format, (f) => { format = f; rearmer(bouton, 'Ajouter'); });
  titre.input.addEventListener('input', () => rearmer(bouton, 'Ajouter'));

  const formulaire = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      message.classList.remove('erreur');
      if (!titre.input.value.trim()) return echec(new Error('Il manque le titre.'), message);
      if (!format) return echec(new Error('Choisis un format.'), message);
      if (avertirSiDoublon(titre.input.value, format, message, bouton, 'Ajouter')) return;
      const corps = {
        titre: titre.input.value, format, auteur: auteur.input.value,
        langue: langue.input.value, lien: completerLien(lien.input.value.trim())
      };
      try {
        const { oeuvre } = await envoyer('/oeuvres', { methode: 'POST', corps });
        message.textContent = `« ${oeuvre.titre} » est dans la liste.`;
        for (const c of [titre, auteur, langue, lien]) c.input.value = '';
        rearmer(bouton, 'Ajouter');
        titre.input.focus();
      } catch (erreur) { echec(erreur, message); }
    }
  },
  titre,
  h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Format'), formats),
  h('div', { class: 'cote' }, auteur, langue),
  lien,
  bouton,
  message,
  datalistLangues());

  return h('div', {}, retour(), h('h1', {}, 'Ajouter à la liste'), formulaire);
}

function entree(params) {
  const index = notesParOeuvre();
  let choisie = trouver(params.get('oeuvre')) || null;
  let format = '';

  const titre = champ('Titre', { value: choisie?.titre, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false' });
  const suggestions = h('ul', { class: 'suggestions', role: 'listbox', hidden: true });
  titre.append(suggestions);
  const resume = h('div', { class: 'choisie' });

  const auteur = champ('Auteur', { class: 'petit' }, true);
  const langue = champ('Langue', { class: 'petit', list: 'langues' }, true);
  const lien = champ('Lien', { class: 'petit', placeholder: 'https://', inputmode: 'url' }, true);
  const nouvelle = h('div', { class: 'champs-nouvelle', style: 'display: flex; flex-direction: column; gap: 32px' },
    h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Format'),
      choix(FORMATS.map((f) => [f, f]), format, (f) => { format = f; rearmer(enregistrer, 'Enregistrer'); })),
    h('div', { class: 'cote' }, auteur, langue),
    lien);

  const enregistrer = h('button', { class: 'principal' }, 'Enregistrer');
  const note = editeurNote(h('span', {}, 'Note ', h('i', {}, `— ${dateFr(Date.now())}`)));
  const message = h('p', { class: 'message', role: 'status' });
  const precision = h('span', { class: 'pale', style: 'font-size: 16px; font-style: italic' });

  const statut = (o) => o.statut === 'liste'
    ? 'liste'
    : `archive, ${pluriel((index.get(o.id) || []).length, 'note')}`;

  function majChoisie() {
    nouvelle.hidden = !!choisie;
    nouvelle.style.display = choisie ? 'none' : 'flex';
    resume.replaceChildren();
    precision.textContent = '';
    if (!choisie) return;
    resume.append(
      h('span', {}, [descriptif(choisie), statut(choisie)].filter(Boolean).join(' · ')),
      h('button', {
        type: 'button', class: 'discret',
        onclick: () => { choisie = null; titre.input.value = ''; majChoisie(); titre.input.focus(); }
      }, 'changer'));
    precision.textContent = choisie.statut === 'liste' ? 'quittera la liste' : "s'ajoutera à son fil";
  }

  // Autocomplétion sur la liste et l'archive : ce qui commence par la saisie
  // d'abord, puis ce qui la contient.
  let proposees = [];
  let actif = -1;
  function proposer() {
    const q = normaliser(titre.input.value);
    proposees = [];
    if (q) {
      const debut = [], dedans = [];
      for (const o of donnees.oeuvres) {
        const t = normaliser(o.titre);
        if (t.startsWith(q)) debut.push(o);
        else if (t.includes(q)) dedans.push(o);
      }
      const ordre = (a, b) => a.titre.localeCompare(b.titre, 'fr');
      proposees = [...debut.sort(ordre), ...dedans.sort(ordre)].slice(0, 8);
    }
    actif = -1;
    dessinerSuggestions();
  }
  function dessinerSuggestions() {
    suggestions.replaceChildren(...proposees.map((o, i) => h('li', { role: 'option' },
      h('button', {
        type: 'button', class: i === actif ? 'actif' : '', tabindex: '-1',
        onmousedown: (e) => e.preventDefault(), onclick: () => prendre(o)
      },
      h('span', { class: 't' }, o.titre),
      h('span', { class: 'm' }, [descriptif(o), estUnLien(o.lien) && domaine(o.lien), statut(o)].filter(Boolean).join(' · '))))));
    suggestions.hidden = proposees.length === 0;
    titre.input.setAttribute('aria-expanded', String(!suggestions.hidden));
  }
  function prendre(o) {
    choisie = o;
    titre.input.value = o.titre;
    proposees = [];
    dessinerSuggestions();
    majChoisie();
    note.zone.focus();
  }

  titre.input.addEventListener('input', () => {
    if (choisie && titre.input.value !== choisie.titre) { choisie = null; majChoisie(); }
    rearmer(enregistrer, 'Enregistrer');
    proposer();
  });
  titre.input.addEventListener('keydown', (e) => {
    if (suggestions.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = proposees.length;
      actif = e.key === 'ArrowDown' ? (actif + 1) % n : (actif - 1 + n) % n;
      dessinerSuggestions();
    } else if (e.key === 'Enter' && actif >= 0) {
      e.preventDefault();
      prendre(proposees[actif]);
    } else if (e.key === 'Escape') {
      proposees = [];
      dessinerSuggestions();
    }
  });
  titre.input.addEventListener('blur', () => { proposees = []; dessinerSuggestions(); });

  const formulaire = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      message.classList.remove('erreur');
      const texte = note.zone.value.trim();
      const saisie = titre.input.value.trim();
      if (!saisie) return echec(new Error('Il manque le titre.'), message);
      if (!texte) return echec(new Error('La note est vide.'), message);

      let corps;
      if (choisie) {
        corps = { oeuvre: choisie.id, texte };
      } else {
        if (!format) return echec(new Error('Choisis un format.'), message);
        // Titre tapé sans passer par les suggestions : s'il désigne une œuvre
        // existante du même format, la note y va.
        const memes = donnees.oeuvres.filter((o) => o.format === format && normaliser(o.titre) === normaliser(saisie));
        if (memes.length > 1) {
          return echec(new Error('Plusieurs œuvres portent ce titre : choisis la bonne dans les suggestions.'), message);
        }
        if (memes.length === 0 && avertirSiDoublon(saisie, format, message, enregistrer, 'Enregistrer')) return;
        corps = memes.length === 1
          ? { oeuvre: memes[0].id, texte }
          : { titre: saisie, format, auteur: auteur.input.value, langue: langue.input.value, lien: completerLien(lien.input.value.trim()), texte };
      }

      enregistrer.disabled = true;
      try {
        const { note: creee } = await envoyer('/notes', { methode: 'POST', corps });
        location.hash = `#/oeuvre/${creee.oeuvre}`;
      } catch (erreur) {
        enregistrer.disabled = false;
        echec(erreur, message);
      }
    }
  },
  h('div', { class: 'champ', style: 'gap: 10px' }, titre, resume),
  nouvelle,
  note,
  h('div', { class: 'actions' }, enregistrer, precision),
  message,
  datalistLangues());

  majChoisie();
  const vue = h('div', {}, retour(), h('h1', {}, 'Créer une entrée'), formulaire);
  requestAnimationFrame(() => (choisie ? note.zone : titre.input).focus());
  return vue;
}

// Les filtres de la liste et de l'archive restent tels quels d'un écran à l'autre.
const filtres = {
  liste: { format: '', langue: '', q: '' },
  archive: { format: '', langue: '', q: '' }
};

function collection(statut) {
  const etat = filtres[statut];
  const index = notesParOeuvre();
  const derniere = (o) => Math.max(o.ajoute, ...(index.get(o.id) || []).map((n) => n.ajout || n.cree));

  const toutes = donnees.oeuvres.filter((o) => o.statut === statut);
  if (statut === 'liste') toutes.sort((a, b) => b.ajoute - a.ajoute);
  else toutes.sort((a, b) => derniere(b) - derniere(a));

  const zoneFiltres = h('div', { class: 'filtres' });
  const tirage = h('div', {});
  const compte = h('p', { class: 'compte', role: 'status' });
  const liste = h('ul', { class: 'oeuvres' });

  const correspond = (o, q) => !q || normaliser(`${o.titre} ${o.auteur}`).includes(q) ||
    (statut === 'archive' && (index.get(o.id) || []).some((n) => normaliser(n.texte).includes(q)));

  function filtrees({ sansLangue } = {}) {
    const q = normaliser(etat.q);
    return toutes.filter((o) =>
      (!etat.format || o.format === etat.format) &&
      (sansLangue || !etat.langue || o.langue === etat.langue) &&
      correspond(o, q));
  }

  // Les langues proposées sont celles qui restent une fois le format choisi.
  function dessinerFiltres() {
    const compteLangues = new Map();
    for (const o of filtrees({ sansLangue: true })) {
      if (o.langue) compteLangues.set(o.langue, (compteLangues.get(o.langue) || 0) + 1);
    }
    if (etat.langue && !compteLangues.has(etat.langue)) etat.langue = '';
    const langues = [...compteLangues.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => [l, l]);
    // Pas de ligne de langues s'il n'y a rien à choisir.
    zoneFiltres.replaceChildren(
      choix([['', 'tout'], ...FORMATS.map((f) => [f, f])], etat.format, (f) => { etat.format = f; majTout(); }),
      ...(langues.length > 1
        ? [choix([['', 'toutes langues'], ...langues], etat.langue, (l) => { etat.langue = l; dessinerResultats(); }, 'petit')]
        : []));
  }

  function meta(o) {
    if (statut === 'liste') return [descriptif(o), estUnLien(o.lien) && '↗'].filter(Boolean).join(' · ');
    const notes = index.get(o.id) || [];
    return [o.format, o.langue, pluriel(notes.length, 'note'), notes.length && dateFr(derniere(o))]
      .filter(Boolean).join(' · ');
  }

  function dessinerResultats() {
    const resultat = filtrees();
    compte.textContent = pluriel(resultat.length, 'œuvre');
    liste.replaceChildren(...resultat.map((o) => h('li', {},
      h('a', { href: `#/oeuvre/${o.id}` }, h('span', { class: 't' }, o.titre), h('span', { class: 'm' }, meta(o))))));
    if (resultat.length === 0) {
      liste.replaceChildren(h('li', { class: 'vide', style: 'border: none' },
        statut === 'liste' ? 'Rien dans la liste avec ces filtres.' : 'Aucune entrée avec ces filtres.'));
    }
  }

  function majTout() { dessinerFiltres(); dessinerResultats(); tirage.replaceChildren(); }

  let tiree = null;
  function tirer() {
    const candidates = filtrees().filter((o) => o !== tiree || filtrees().length === 1);
    if (candidates.length === 0) {
      tirage.replaceChildren(h('p', { class: 'vide' }, 'Rien à tirer avec ces filtres.'));
      return;
    }
    tiree = candidates[Math.floor(Math.random() * candidates.length)];
    tirage.replaceChildren(h('section', { class: 'tirage', 'aria-label': 'Tirage au hasard' },
      h('div', { class: 'etiquette' }, 'au hasard'),
      h('a', { class: 't', href: `#/oeuvre/${tiree.id}` }, tiree.titre),
      h('div', { class: 'meta' }, descriptif(tiree),
        estUnLien(tiree.lien) && [' · ', h('a', { href: tiree.lien, target: '_blank', rel: 'noopener' }, `${domaine(tiree.lien)} ↗`)]),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'discret', style: 'text-decoration: underline; color: var(--encre)', onclick: tirer }, 'autre'),
        h('a', { class: 'lien-rouge', href: `#/entree?oeuvre=${tiree.id}` }, 'écrire une entrée →'))));
  }

  const recherche = h('input', {
    class: 'recherche', type: 'search', placeholder: 'rechercher…', 'aria-label': 'Rechercher', value: etat.q,
    oninput: (e) => { etat.q = e.target.value; dessinerFiltres(); dessinerResultats(); }
  });

  majTout();
  return h('div', {},
    retour(),
    h('div', { class: 'barre' },
      h('h1', {}, statut === 'liste' ? 'Liste' : 'Archive'),
      statut === 'liste' && h('button', { type: 'button', class: 'secondaire', onclick: tirer }, 'au hasard')),
    recherche, zoneFiltres, tirage, compte, liste);
}

function vueOeuvre(id) {
  const o = trouver(id);
  if (!o) return h('div', {}, retour(), h('p', { class: 'vide' }, "Cette œuvre n'existe plus."));

  const notes = notesParOeuvre().get(o.id) || [];
  const message = h('p', { class: 'message', role: 'status' });
  const enListe = o.statut === 'liste';

  const entete = h('header', {},
    h('h1', {}, o.titre),
    h('div', { class: 'meta', style: 'margin-top: 6px' }, descriptif(o),
      estUnLien(o.lien) && [descriptif(o) ? ' · ' : '', h('a', { href: o.lien, target: '_blank', rel: 'noopener' }, `${domaine(o.lien)} ↗`)]));

  function vueNote(n) {
    const article = h('article', { class: 'note' });
    function lecture() {
      article.replaceChildren(
        h('div', { class: 'tete-note' },
          h('span', { class: 'etiquette' }, datesNote(n)),
          h('button', { type: 'button', class: 'discret', onclick: edition }, 'modifier')),
        h('p', { class: 'texte', html: enrichir(n.texte) }));
    }
    function edition() {
      const editeur = editeurNote(datesNote(n), n.texte);
      const erreur = h('p', { class: 'message', role: 'status' });
      article.replaceChildren(h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await envoyer(`/notes/${n.id}`, { methode: 'PATCH', corps: { texte: editeur.zone.value } });
            afficher();
          } catch (err) { echec(err, erreur); }
        }
      },
      editeur,
      h('div', { class: 'actions' },
        h('button', { class: 'principal' }, 'Enregistrer'),
        h('button', { type: 'button', class: 'discret', onclick: lecture }, 'annuler'),
        boutonSupprimer('supprimer la note', 'confirmer la suppression', async () => {
          try { await envoyer(`/notes/${n.id}`, { methode: 'DELETE' }); afficher(); } catch (err) { echec(err, erreur); }
        })),
      erreur));
      editeur.zone.focus();
    }
    lecture();
    return article;
  }

  const corps = h('div', {});
  function lecture() {
    corps.replaceChildren(
      entete,
      enListe
        ? h('p', { class: 'vide' }, 'Dans la liste, pas encore de notes.')
        : h('div', { class: 'notes' }, notes.length ? notes.map(vueNote) : h('p', { class: 'vide' }, 'Plus aucune note.')),
      h('div', { class: 'actions', style: 'justify-content: space-between; margin-top: 20px' },
        h('a', { class: 'lien-rouge', href: `#/entree?oeuvre=${o.id}` }, enListe ? 'écrire une entrée →' : '+ ajouter une note'),
        h('button', { type: 'button', class: 'discret', onclick: edition }, "modifier l'œuvre")),
      message);
  }

  function edition() {
    let format = o.format;
    const titre = champ('Titre', { value: o.titre });
    const auteur = champ('Auteur', { class: 'petit', value: o.auteur });
    const langue = champ('Langue', { class: 'petit', list: 'langues', value: o.langue });
    const lien = champ('Lien', { class: 'petit', value: o.lien, inputmode: 'url' });
    const tout = notes.length ? ` et ses ${pluriel(notes.length, 'note')}` : '';
    corps.replaceChildren(h('div', { class: 'edition' }, h('h1', {}, o.titre), h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        message.classList.remove('erreur');
        const champs = {
          titre: titre.input.value, format, auteur: auteur.input.value,
          langue: langue.input.value, lien: completerLien(lien.input.value.trim())
        };
        try { await envoyer(`/oeuvres/${o.id}`, { methode: 'PATCH', corps: champs }); afficher(); } catch (err) { echec(err, message); }
      }
    },
    titre,
    h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Format'),
      choix(FORMATS.map((f) => [f, f]), format, (f) => { format = f; })),
    h('div', { class: 'cote' }, auteur, langue),
    lien,
    h('div', { class: 'actions' },
      h('button', { class: 'principal' }, 'Enregistrer'),
      h('button', { type: 'button', class: 'discret', onclick: lecture }, 'annuler'),
      boutonSupprimer(`supprimer l'œuvre${tout}`, 'confirmer la suppression', async () => {
        try {
          await envoyer(`/oeuvres/${o.id}`, { methode: 'DELETE' });
          location.hash = enListe ? '#/liste' : '#/archive';
        } catch (err) { echec(err, message); }
      })),
    message,
    datalistLangues())));
    titre.input.focus();
  }

  lecture();
  return h('div', {}, retour(enListe ? '#/liste' : '#/archive', enListe ? 'liste' : 'archive'), corps);
}

// ---------------------------------------------------------------- routes

function afficher() {
  const app = document.getElementById('app');
  if (!lire(CLE_PHRASE)) return app.replaceChildren(connexion());
  const [chemin, requete = ''] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(requete);
  let vue;
  if (chemin?.startsWith('/oeuvre/')) vue = vueOeuvre(decodeURIComponent(chemin.slice('/oeuvre/'.length)));
  else if (chemin === '/ajouter') vue = ajouter();
  else if (chemin === '/entree') vue = entree(params);
  else if (chemin === '/liste') vue = collection('liste');
  else if (chemin === '/archive') vue = collection('archive');
  else vue = accueil();
  app.replaceChildren(vue);
}

// Après un rechargement venu d'ailleurs (l'autre appareil), on redessine,
// sauf si l'on est en train d'écrire.
function rafraichir() {
  const actif = document.activeElement;
  if (actif && ['INPUT', 'TEXTAREA'].includes(actif.tagName)) return;
  afficher();
}

function synchroniser() {
  if (!lire(CLE_PHRASE)) return;
  charger().then(rafraichir).catch(() => { if (!lire(CLE_PHRASE)) afficher(); });
}

window.addEventListener('hashchange', () => { afficher(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchroniser(); });

afficher();
synchroniser();
