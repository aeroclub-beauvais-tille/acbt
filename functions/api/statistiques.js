// Chiffres de fréquentation pour la page /statistiques/ (mot de passe admin).
//   POST { motDePasse, jours: 7|30|90|365, section: 'vitrine'|'membre'|'perfs' }
import { estAdmin } from '../_alertes.js';
import { json } from '../_maa.js';
import { tableVisites, jourParis } from '../_visites.js';
import { tablesComptes } from '../_comptes.js';

const SECTIONS = ['vitrine', 'membre', 'perfs'];

export async function onRequestPost({ request, env }) {
  let d = null;
  try { d = await request.json(); } catch { /* illisible */ }
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!(await estAdmin(env, d.motDePasse))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
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

  const E = 'jour >= ?1 AND jour < ?2';
  const fin = '9999-12-31';
  const [totaux, precedent, serie, pages, sources, appareils, villes, direct, premier, heures, semaine, rebond, entrees,
    actions, actionsAvant, details, pagesReserver, serieActions, temps, tempsPages] = await db.batch([
    db.prepare(`SELECT section, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE jour >= ?1 GROUP BY section`).bind(debut),
    db.prepare(`SELECT section, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE jour >= ?1 AND jour < ?2 GROUP BY section`).bind(avant, debut),
    db.prepare(`SELECT ${cle} AS k, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY k ORDER BY k`).bind(debut, sec),
    db.prepare(`SELECT page, COUNT(*) AS vues, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY page ORDER BY vues DESC LIMIT 15`).bind(debut, sec),
    db.prepare(`SELECT source, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} AND source IS NOT NULL AND source <> 'interne' GROUP BY source ORDER BY visiteurs DESC LIMIT 12`).bind(debut, sec),
    db.prepare(`SELECT appareil, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY appareil ORDER BY visiteurs DESC`).bind(debut, sec),
    db.prepare(`SELECT ville, pays, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} AND ville IS NOT NULL GROUP BY ville, pays ORDER BY visiteurs DESC LIMIT 10`).bind(debut, sec),
    db.prepare(`SELECT COUNT(DISTINCT v) AS n FROM visites WHERE t >= ?1`).bind(new Date(auj - 5 * 60e3).toISOString()),
    db.prepare('SELECT MIN(jour) AS j FROM visites'),
    db.prepare(`SELECT heure AS k, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} AND heure IS NOT NULL GROUP BY heure`).bind(debut, sec),
    db.prepare(`SELECT CAST(strftime('%w', jour) AS INTEGER) AS k, COUNT(DISTINCT jour || v) AS visiteurs FROM visites WHERE ${W} GROUP BY k`).bind(debut, sec),
    db.prepare(`SELECT SUM(c = 1) AS seuls, COUNT(*) AS tous FROM (SELECT COUNT(*) AS c FROM visites WHERE ${W} GROUP BY jour, v)`).bind(debut, sec),
    db.prepare(`SELECT page, COUNT(*) AS visiteurs FROM (SELECT page, ROW_NUMBER() OVER (PARTITION BY jour, v ORDER BY id) AS rn FROM visites WHERE ${W}) WHERE rn = 1 GROUP BY page ORDER BY visiteurs DESC LIMIT 10`).bind(debut, sec),
    db.prepare(`SELECT e, COUNT(*) AS n, COUNT(DISTINCT jour || v) AS visiteurs FROM evenements WHERE ${E} AND e <> '_temps' GROUP BY e`).bind(debut, fin),
    db.prepare(`SELECT e, COUNT(*) AS n FROM evenements WHERE ${E} AND e <> '_temps' GROUP BY e`).bind(avant, debut),
    db.prepare(`SELECT e, d, COUNT(*) AS n FROM evenements WHERE ${E} AND e IN ('clic-contact', 'formulaire', 'sortie', 'document') GROUP BY e, d ORDER BY n DESC LIMIT 60`).bind(debut, fin),
    db.prepare(`SELECT page, COUNT(*) AS n FROM evenements WHERE ${E} AND e = 'clic-contact' GROUP BY page ORDER BY n DESC LIMIT 10`).bind(debut, fin),
    db.prepare(`SELECT ${cle} AS k, SUM(e = 'clic-contact') AS clics, SUM(e = 'formulaire') AS demandes, SUM(e = 'appel') AS appels FROM evenements WHERE ${E} GROUP BY k`).bind(debut, fin),
    db.prepare(`SELECT SUM(n) AS s FROM evenements WHERE ${E} AND e = '_temps'`).bind(debut, fin),
    db.prepare(`SELECT page, AVG(n) AS moyenne, COUNT(*) AS lectures FROM evenements WHERE ${E} AND e = '_temps' GROUP BY page HAVING lectures >= 3 ORDER BY moyenne DESC LIMIT 10`).bind(debut, fin),
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
  const act = new Map((serieActions.results || []).map((r) => [r.k, r]));
  const parK = (res, n) => Array.from({ length: n }, (_, k) => (res.results || []).find((r) => r.k === k)?.visiteurs || 0);

  // Espace membre : qui se connecte (comptes personnels)
  let membres = null;
  if (sec === 'membre') {
    try {
      await tablesComptes(db);
      const aujourdhui = jourParis(new Date(auj));
      const [comptes, derniers, assidus, actifs, actifsAvant, auj1, parJour] = await db.batch([
        db.prepare(`SELECT COUNT(*) AS tous, SUM(actif = 1 AND hash IS NOT NULL) AS actifs, SUM(actif = 1 AND hash IS NOT NULL AND derniere IS NULL) AS jamais,
          SUM(actif = 1 AND hash IS NULL) AS attente, SUM(actif = 0) AS desactives FROM membres`),
        db.prepare(`SELECT prenom, nom, identifiant, derniere FROM membres WHERE derniere IS NOT NULL ORDER BY derniere DESC LIMIT 12`),
        db.prepare(`SELECT m.prenom, m.nom, m.identifiant, COUNT(*) AS jours, MAX(p.jour) AS dernier FROM presence p JOIN membres m ON m.id = p.membre
          WHERE p.jour >= ?1 GROUP BY p.membre ORDER BY jours DESC, dernier DESC LIMIT 12`).bind(debut),
        db.prepare('SELECT COUNT(DISTINCT membre) AS n FROM presence WHERE jour >= ?1').bind(debut),
        db.prepare('SELECT COUNT(DISTINCT membre) AS n FROM presence WHERE jour >= ?1 AND jour < ?2').bind(avant, debut),
        db.prepare('SELECT COUNT(DISTINCT membre) AS n FROM presence WHERE jour = ?1').bind(aujourdhui),
        db.prepare(`SELECT ${cle} AS k, COUNT(DISTINCT membre) AS n FROM presence WHERE jour >= ?1 GROUP BY k`).bind(debut),
      ]);
      const c = comptes.results?.[0] || {};
      membres = {
        comptes: { tous: c.tous || 0, actifs: c.actifs || 0, jamais: c.jamais || 0, attente: c.attente || 0, desactives: c.desactives || 0 },
        actifs: actifs.results?.[0]?.n || 0, actifsAvant: actifsAvant.results?.[0]?.n || 0, aujourdhui: auj1.results?.[0]?.n || 0,
        derniers: derniers.results || [], assidus: assidus.results || [], parJour: parJour.results || [],
      };
    } catch { membres = null; }
  }

  return json({
    ok: true, jours, section: sec, membres, parMois, depuis: premier.results?.[0]?.j || null,
    enDirect: direct.results?.[0]?.n || 0,
    totaux: totaux.results || [], precedent: precedent.results || [],
    serie: cases.map((k) => ({ k, vues: vus.get(k)?.vues || 0, visiteurs: vus.get(k)?.visiteurs || 0,
      clics: act.get(k)?.clics || 0, demandes: act.get(k)?.demandes || 0, appels: act.get(k)?.appels || 0 })),
    heures: parK(heures, 24), semaine: parK(semaine, 7),
    rebond: rebond.results?.[0] || { seuls: 0, tous: 0 }, entrees: entrees.results || [],
    actions: actions.results || [], actionsAvant: actionsAvant.results || [], details: details.results || [],
    pagesReserver: pagesReserver.results || [], tempsTotal: temps.results?.[0]?.s || 0, tempsPages: tempsPages.results || [],
    pages: pages.results || [], sources: sources.results || [], appareils: appareils.results || [], villes: villes.results || [],
  });
}
