// Copie les publications de la page Facebook du club en actualités du site.
//
// Chaque publication avec au moins une photo devient un fichier
// src/content/actualites/AAAA-MM-JJ-titre.md, et ses photos sont enregistrées
// dans public/uploads/actualites/AAAA/titre/01.jpg, 02.jpg…
// Une publication déjà copiée n'est jamais recopiée : son identifiant Facebook est noté
// dans src/data/facebook-copiees.json. Si le club modifie ou supprime l'actu dans le
// back-office, le script n'y touche plus.
//
// Lancé par .github/workflows/facebook.yml toutes les 3 heures.
// Réglages (secrets GitHub) :
//   FACEBOOK_PAGE_ID    identifiant de la page ACBT60
//   FACEBOOK_PAGE_TOKEN clé d'accès à la page (sans date d'expiration)
// Facultatif : FACEBOOK_DEPUIS (AAAA-MM-JJ, par défaut 2023-04-01) et
// FACEBOOK_API (adresse de l'API, utilisée seulement pour les essais).

import fs from 'node:fs';
import path from 'node:path';

const PAGE = process.env.FACEBOOK_PAGE_ID;
const CLE = process.env.FACEBOOK_PAGE_TOKEN;
const API = (process.env.FACEBOOK_API || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
const DEPUIS = process.env.FACEBOOK_DEPUIS || '2023-04-01';
const RACINE = process.cwd();
const DOSSIER_ACTUS = path.join(RACINE, 'src/content/actualites');
const DOSSIER_PHOTOS = path.join(RACINE, 'public/uploads/actualites');
const REGISTRE = path.join(RACINE, 'src/data/facebook-copiees.json');

if (!PAGE || !CLE) {
  console.log('FACEBOOK_PAGE_ID ou FACEBOOK_PAGE_TOKEN absent : rien à faire.');
  process.exit(0);
}

async function appel(chemin, params = {}) {
  const u = chemin.startsWith('http') ? new URL(chemin) : new URL(`${API}/${chemin.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', CLE);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    // 190 : clé expirée ou révoquée (mot de passe changé, administrateur retiré…)
    if (e.code === 190) throw new Error(`La clé Facebook ne fonctionne plus (${e.message}). Refaire la clé d'accès à la page et la recoller dans le secret FACEBOOK_PAGE_TOKEN.`);
    throw new Error(`Erreur Facebook ${r.status} : ${e.message || JSON.stringify(j).slice(0, 300)}`);
  }
  return j;
}

// Publications déjà copiées (ou volontairement écartées) : identifiant Facebook → fichier de l'actu.
const registre = fs.existsSync(REGISTRE) ? JSON.parse(fs.readFileSync(REGISTRE, 'utf8')) : {};
const dejaCopiees = new Set(Object.keys(registre));

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = (s) => {
  const x = sansAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (x.length > 50 ? x.slice(0, 50).replace(/-[^-]*$/, '') : x) || 'publication';
};
const yaml = (s) => JSON.stringify(s);

// Titre : la première phrase ou la première ligne, raccourcie proprement.
// Les mots-dièses (#aeroclub…) sont retirés : ils n'ont pas de sens sur le site.
function decouper(message) {
  const texte = message
    .replace(/\r/g, '')
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const [premiere, ...reste] = texte.split(/\n+/);
  let titre = premiere.trim();
  let suite = reste.filter(Boolean).join('\n\n').trim();
  const phrase = titre.match(/^(.{12,90}?[.!?…])(\s|$)/);
  if (phrase && phrase[1].length < titre.length) {
    suite = (titre.slice(phrase[1].length).trim() + (suite ? '\n\n' + suite : '')).trim();
    titre = phrase[1];
  }
  if (titre.length > 90) {
    // Trop long : on coupe à une virgule ou entre deux mots, et l'actu reprend tout le texte.
    const virgule = titre.slice(0, 80).lastIndexOf(', ');
    titre = virgule > 25 ? titre.slice(0, virgule) : titre.slice(0, 75).replace(/\s+\S*$/, '') + '…';
    suite = texte.split(/\n+/).filter(Boolean).join('\n\n');
  }
  titre = titre.replace(/[.!]+$/, '').trim();
  // Une ligne qui commence par # ne doit pas devenir un intertitre dans l'actu.
  const corps = (suite || '').replace(/^(\s*)#/gm, '$1\\#');
  return { titre: titre || 'Nouvelles du club', corps };
}

// Photos de la publication, dans la meilleure taille disponible.
async function photos(post) {
  const liste = [];
  for (const a of post.attachments?.data || []) {
    const elems = a.subattachments?.data?.length ? a.subattachments.data : [a];
    for (const s of elems) {
      if (s.media_type !== 'photo' && s.type !== 'photo') continue;
      let src = s.media?.image?.src;
      if (s.target?.id) {
        try {
          const p = await appel(s.target.id, { fields: 'images' });
          const grande = (p.images || []).sort((x, y) => y.width - x.width)[0];
          if (grande?.source) src = grande.source;
        } catch (e) {
          if (/ne fonctionne plus/.test(e.message)) throw e;
        }
      }
      if (src) liste.push(src);
    }
  }
  return [...new Set(liste)].slice(0, 12);
}

async function telecharger(url, fichier) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`photo ${r.status}`);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, Buffer.from(await r.arrayBuffer()));
}

const champs = 'id,message,created_time,permalink_url,attachments{media_type,type,media,target,subattachments{media_type,type,media,target}}';
let suivante = null;
let premier = true;
let ajoutees = 0;
const depuis = Math.floor(new Date(DEPUIS + 'T00:00:00Z').getTime() / 1000);

while (premier || suivante) {
  const page = premier ? await appel(`${PAGE}/posts`, { fields: champs, since: String(depuis), limit: '25' }) : await appel(suivante);
  premier = false;
  suivante = page.paging?.next || null;
  for (const post of page.data || []) {
    if (dejaCopiees.has(post.id) || !post.message?.trim()) continue;
    const urls = await photos(post);
    if (!urls.length) continue; // seules les publications avec photos deviennent des actus
    const date = post.created_time.slice(0, 10);
    const annee = date.slice(0, 4);
    const { titre, corps } = decouper(post.message);
    let nom = `${date}-${slug(titre)}`;
    let n = 2;
    while (fs.existsSync(path.join(DOSSIER_ACTUS, nom + '.md'))) nom = `${date}-${slug(titre)}-${n++}`;
    const dossier = path.join(DOSSIER_PHOTOS, annee, nom.slice(11));
    const chemins = [];
    for (const [i, u] of urls.entries()) {
      const f = `${String(i + 1).padStart(2, '0')}.jpg`;
      try {
        await telecharger(u, path.join(dossier, f));
        chemins.push(`/uploads/actualites/${annee}/${nom.slice(11)}/${f}`);
      } catch (e) {
        console.warn(`Photo ignorée pour ${post.id} : ${e.message}`);
      }
    }
    if (!chemins.length) continue;
    const entete = [
      '---',
      `titre: ${yaml(titre)}`,
      `date: ${date}`,
      `image: ${chemins[0]}`,
      'galerie:',
      ...chemins.map((c) => `  - ${c}`),
      '---',
    ].join('\n');
    fs.writeFileSync(path.join(DOSSIER_ACTUS, nom + '.md'), `${entete}\n${corps}\n`);
    dejaCopiees.add(post.id);
    registre[post.id] = nom;
    fs.writeFileSync(REGISTRE, JSON.stringify(registre, null, 2) + '\n');
    ajoutees++;
    console.log(`Nouvelle actu : ${nom} (${chemins.length} photo${chemins.length > 1 ? 's' : ''})`);
  }
}

console.log(ajoutees ? `${ajoutees} actu(s) ajoutée(s).` : 'Aucune nouvelle publication avec photos.');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ajoutees=${ajoutees}\n`);
