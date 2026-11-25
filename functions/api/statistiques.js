// Chiffres de fréquentation pour la page /statistiques/ (mot de passe admin).
//   POST { motDePasse, jours: 7|30|90|365, section: 'vitrine'|'membre'|'perfs' }
import { estAdmin } from '../_alertes.js';
import { json } from '../_maa.js';
import { tableVisites, jourParis } from '../_visites.js';

const SECTIONS = ['vitrine', 'membre', 'perfs'];

export async function onRequestPost({ request, env }) {
  let d = null;
  try { d = await request.json(); } catch { /* illisible */ }
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const db = env.DB;
  await tableVisites(db);

  const jours = [7, 30, 90, 365].includes(Number(d.jours)) ? Number(d.jours) : 30;
  const sec = SECTIONS.includes(d.section) ? d.section : 'vitrine';
  const auj = Date.now();
  const debut = jourParis(new Date(auj - (jours - 1) * 864e5));
  const avant = jourParis(new Date(auj - (2 * jours - 1) * 864e5));
  const parMois = jours > 90;
  const cle = parMois ? 'substr(jour, 1, 7)' : 'jour';
  const W = 'jour >= ?1 AND section = ?2';

  const [totaux, precedent, serie, pages, sources, appareils, villes, direct, premier] = await db.batch([
    db.prepare(`SELECT section, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE jour >= ?1 GROUP BY section`).bind(debut),
    db.prepare(`SELECT section, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE jour >= ?1 AND jour < ?2 GROUP BY section`).bind(avant, debut),
    db.prepare(`SELECT ${cle} AS k, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY k ORDER BY k`).bind(debut, sec),
    db.prepare(`SELECT page, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY page ORDER BY vues DESC LIMIT 15`).bind(debut, sec),
    db.prepare(`SELECT source, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} AND source IS NOT NULL AND source <> 'interne' GROUP BY source ORDER BY visiteurs DESC LIMIT 10`).bind(debut, sec),
    db.prepare(`SELECT appareil, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY appareil ORDER BY visiteurs DESC`).bind(debut, sec),
    db.prepare(`SELECT ville, pays, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} AND ville IS NOT NULL GROUP BY ville, pays ORDER BY visiteurs DESC LIMIT 10`).bind(debut, sec),
    db.prepare(`SELECT COUNT(DISTINCT v) AS n FROM visites WHERE t >= ?1`).bind(new Date(auj - 5 * 60e3).toISOString()),
    db.prepare('SELECT MIN(jour) AS j FROM visites'),
  ]);

  // Toutes les cases de la période, même vides, pour un graphique sans trous
  const cases = [];
  if (parMois) {
    const m = new Date(auj);
    for (let i = 11; i >= 0; i--) {
      const x = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - i, 15));
      cases.push(x.toISOString().slice(0, 7));
    }
  } else for (let i = jours - 1; i >= 0; i--) cases.push(jourParis(new Date(auj - i * 864e5)));
  const vus = new Map((serie.results || []).map((r) => [r.k, r]));

  return json({
    ok: true, jours, section: sec, parMois, depuis: premier.results?.[0]?.j || null,
    enDirect: direct.results?.[0]?.n || 0,
    totaux: totaux.results || [], precedent: precedent.results || [],
    serie: cases.map((k) => ({ k, vues: vus.get(k)?.vues || 0, visiteurs: vus.get(k)?.visiteurs || 0 })),
    pages: pages.results || [], sources: sources.results || [], appareils: appareils.results || [], villes: villes.results || [],
  });
}
