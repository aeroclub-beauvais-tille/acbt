// État de la copie des actus Facebook (/membre/facebook/, admin) : lue sur GitHub, où tourne la copie
// (.github/workflows/facebook.yml, à 9h, 13h, 16h, 19h et 23h heure de Paris).
//   GET                      → { actif, derniere, enCours, total, derniereActu, recuperations, peutForcer }
// Consultation seule (pas de lancement à la main depuis l'appli, demande d'Hugo du 26/11).
// Clé GitHub conseillée dans Cloudflare : secret GITHUB_JETON (clé « fine-grained » limitée au dépôt acbt,
// droits Actions et Contents en lecture seule). Sans elle, l'état n'est lisible que tant que le dépôt est public,
// et GitHub limite fortement ces lectures.
import { json } from '../../_alertes.js';

const DEPOT = 'aeroclub-beauvais-tille/acbt';
const TACHE = 'facebook.yml';

const gh = (env, chemin, init = {}) => fetch(`https://api.github.com/repos/${DEPOT}/${chemin}`, {
  ...init,
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'acbt60-espace-membre',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(env.GITHUB_JETON ? { Authorization: `Bearer ${env.GITHUB_JETON}` } : {}),
    ...(init.headers || {}),
  },
});

const lireJson = async (r) => (r && r.ok ? r.json().catch(() => null) : null);

// Réponse gardée 60 s : GitHub limite fortement les lectures sans clé (adresses partagées de Cloudflare).
const CLE_CACHE = 'https://cache.acbt60.fr/membre/api/facebook';
const cache = () => (typeof caches !== 'undefined' && caches.default) || null;

export async function onRequestGet({ env }) {
  const c = cache();
  if (c) {
    const deja = await c.match(CLE_CACHE).catch(() => null);
    if (deja) return new Response(deja.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const rep = await lireEtat(env);
  if (c && rep.status === 200) await c.put(CLE_CACHE, new Response(rep.clone().body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } })).catch(() => {});
  return rep;
}

async function lireEtat(env) {
  const [rRuns, rReg, rCom] = await Promise.all([
    gh(env, `actions/workflows/${TACHE}/runs?per_page=30`).catch(() => null),
    gh(env, 'contents/src/data/facebook-copiees.json?ref=main', { headers: { Accept: 'application/vnd.github.raw+json' } }).catch(() => null),
    gh(env, 'commits?path=src/data/facebook-copiees.json&sha=main&per_page=30').catch(() => null),
  ]);
  const runs = (await lireJson(rRuns))?.workflow_runs;
  if (!runs) {
    const limite = rRuns && (rRuns.status === 403 || rRuns.status === 429);
    return json({ ok: false, erreur: limite ? 'GitHub limite les lectures pour le moment : réessayez dans quelques minutes.' : 'Impossible de lire l’état sur GitHub.' }, 502);
  }
  // Les passages annulés sont ceux hors saison (heure d'été / d'hiver) : on les ignore.
  const utiles = runs.filter((r) => r.conclusion !== 'cancelled');
  const enCours = utiles.find((r) => r.status !== 'completed');
  const fini = utiles.find((r) => r.status === 'completed');
  const derniereReussie = utiles.find((r) => r.conclusion === 'success');
  const passage = (r) => r && { date: r.run_started_at || r.created_at, ok: r.conclusion === 'success', manuel: r.event === 'workflow_dispatch', lien: r.html_url };

  const registre = (await lireJson(rReg)) || {};
  const actus = Object.values(registre).filter((v) => typeof v === 'string').sort();
  const commits = (await lireJson(rCom)) || [];
  const recuperations = commits
    .map((c) => ({ date: c.commit?.committer?.date, m: /^Actus : (\d+) publication/.exec(c.commit?.message || '') }))
    .filter((c) => c.m)
    .slice(0, 8)
    .map((c) => ({ date: c.date, nombre: Number(c.m[1]) }));

  return json({
    ok: true,
    actif: fini ? fini.conclusion === 'success' : null,
    derniere: passage(fini),
    derniereReussie: passage(derniereReussie),
    enCours: passage(enCours) || null,
    total: actus.length,
    derniereActu: actus.at(-1) || null,
    recuperations,
  });
}
