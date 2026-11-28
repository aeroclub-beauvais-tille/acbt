// Documents généraux du club (onglet Préparer), modifiés depuis l'appli.
//   GET  → { lignes: [...] } (membres) : changements faits par l'admin, fusionnés dans l'appli avec les documents du site
//   POST multipart (admin) : motDePasse, cle? (vide = nouveau document), rubrique, titre, descr?, fichier? | lien?, base? (JSON)
//        → nouvelle version en ligne ; la version d'avant passe dans l'historique.
//          Sans fichier ni lien : la version d'avant garde son fichier (simple changement de nom, de rubrique…).
//          « base » : le document du site tel qu'il était, gardé dans l'historique à son premier changement.
//   POST JSON (admin) { action, motDePasse, ... }
//        retirer   { cle, base? } → le document n'est plus affiché (historique, peut être remis en ligne)
//        restaurer { id }        → cette version reprend sa place
//        effacer   { id }        → version effacée définitivement
//        rubriques { liste: [{ id, nom }] } → rubriques créées, renommées, supprimées, rangées (refusé si une rubrique supprimée a encore des documents)
import { estAdmin, json } from '../../_alertes.js';
import { tableDocsClub, RUBRIQUES_DEFAUT, lireRubriques, MORCEAU } from '../../_docs_club.js';

const texte = (v, max) => String(v ?? '').trim().slice(0, max);
const lienOk = (v) => /^https?:\/\/[^\s]+$/i.test(v) || /^\/[^\s]*$/.test(v);

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, lignes: [] }, 503);
  await tableDocsClub(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, cle, rubrique, titre, descr, lien, fichier, mime, taille, donnees, cree, change, etat FROM docs_club WHERE etat != 'efface' OR cle IN (SELECT cle FROM docs_club GROUP BY cle HAVING SUM(etat != 'efface') = 0) ORDER BY cree DESC LIMIT 1000",
  ).all();
  return json({ ok: true, lignes: results || [], rubriques: await lireRubriques(env.DB) });
}

const ids = async (db) => ((await lireRubriques(db)) || RUBRIQUES_DEFAUT).map((r) => r.id);

/** Première modification d'un document du site : sa version d'origine est gardée dans l'historique. */
async function garderBase(db, cle, base, quand) {
  if (!base || typeof base !== 'object') return;
  const deja = await db.prepare('SELECT 1 FROM docs_club WHERE cle = ?1 LIMIT 1').bind(cle).first();
  if (deja) return;
  const rub = /^[a-z0-9-]{1,40}$/.test(String(base.rubrique || '')) ? base.rubrique : 'avant';
  const lien = texte(base.lien, 600);
  if (!lienOk(lien)) return;
  await db.prepare(`INSERT INTO docs_club (id, cle, rubrique, titre, descr, lien, morceaux, cree, change, etat)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, NULL, 'actif')`).bind(crypto.randomUUID(), cle, rub, texte(base.titre, 120) || cle, texte(base.descr, 200) || null, lien, quand).run();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const db = env.DB;
  await tableDocsClub(db);
  const maintenant = new Date().toISOString();
  const type = request.headers.get('content-type') || '';

  if (type.includes('application/json')) {
    let d = null;
    try { d = await request.json(); } catch { /* illisible */ }
    if (!d || !(await estAdmin(env, d.motDePasse))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);

    if (d.action === 'rubriques') {
      const brut = Array.isArray(d.liste) ? d.liste.slice(0, 30) : [];
      const liste = brut.map((r) => ({ id: texte(r?.id, 40), nom: texte(r?.nom, 40) }));
      if (!liste.length) return json({ ok: false, erreur: 'Gardez au moins une rubrique.' }, 400);
      if (liste.some((r) => !/^[a-z0-9-]{1,40}$/.test(r.id) || !r.nom)) return json({ ok: false, erreur: 'Chaque rubrique doit avoir un nom.' }, 400);
      if (new Set(liste.map((r) => r.id)).size !== liste.length) return json({ ok: false, erreur: 'Rubrique en double.' }, 400);
      // Une rubrique supprimée ne doit plus contenir de document déposé depuis l'appli (l'appli vérifie aussi les documents du site)
      const gardees = new Set(liste.map((r) => r.id));
      const { results } = await db.prepare("SELECT rubrique, COUNT(*) AS n FROM docs_club WHERE etat = 'actif' GROUP BY rubrique").all();
      const pleine = (results || []).find((x) => !gardees.has(x.rubrique));
      if (pleine) return json({ ok: false, erreur: 'Une rubrique supprimée contient encore des documents : déplacez-les ou supprimez-les d’abord.' }, 400);
      await db.prepare("INSERT INTO docs_club_reglages (cle, valeur, maj) VALUES ('rubriques', ?1, ?2) ON CONFLICT (cle) DO UPDATE SET valeur = ?1, maj = ?2").bind(JSON.stringify(liste), maintenant).run();
      return json({ ok: true, rubriques: liste });
    }
    if (d.action === 'retirer') {
      const cle = texte(d.cle, 80);
      if (!cle) return json({ ok: false, erreur: 'Document inconnu.' }, 400);
      await garderBase(db, cle, d.base, maintenant);
      await db.prepare("UPDATE docs_club SET etat = 'retire', change = ?2 WHERE cle = ?1 AND etat = 'actif'").bind(cle, maintenant).run();
      return json({ ok: true });
    }
    if (d.action === 'restaurer') {
      const l = await db.prepare('SELECT cle FROM docs_club WHERE id = ?1').bind(texte(d.id, 80)).first();
      if (!l) return json({ ok: false, erreur: 'Version introuvable.' }, 404);
      await db.batch([
        db.prepare("UPDATE docs_club SET etat = 'ancien', change = ?2 WHERE cle = ?1 AND etat = 'actif'").bind(l.cle, maintenant),
        db.prepare("UPDATE docs_club SET etat = 'actif', change = ?2 WHERE id = ?1").bind(texte(d.id, 80), maintenant),
      ]);
      return json({ ok: true });
    }
    if (d.action === 'effacer') {
      const id = texte(d.id, 80);
      const l = await db.prepare('SELECT cle, donnees, etat FROM docs_club WHERE id = ?1').bind(id).first();
      if (!l) return json({ ok: true });
      if (l.etat === 'actif') return json({ ok: false, erreur: 'Supprimez d’abord ce document de la liste.' }, 400);
      // La ligne reste (état « efface ») : un document du site effacé ne doit pas réapparaître
      await db.prepare("UPDATE docs_club SET etat = 'efface', change = ?2 WHERE id = ?1").bind(id, maintenant).run();
      // Le fichier n'est effacé que si plus aucune version gardée ne s'en sert
      if (l.donnees) {
        const encore = await db.prepare("SELECT 1 FROM docs_club WHERE donnees = ?1 AND etat != 'efface' LIMIT 1").bind(l.donnees).first();
        if (!encore) await db.batch([
          db.prepare('DELETE FROM docs_club_morceaux WHERE doc = ?1').bind(l.donnees),
          db.prepare('UPDATE docs_club SET morceaux = 0, donnees = NULL WHERE donnees = ?1').bind(l.donnees),
        ]);
      }
      return json({ ok: true });
    }
    return json({ ok: false, erreur: 'Action inconnue.' }, 400);
  }

  let f = null;
  try { f = await request.formData(); } catch { /* pas un formulaire */ }
  if (!f) return json({ ok: false, erreur: 'Envoi illisible.' }, 400);
  if (!(await estAdmin(env, f.get('motDePasse')))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);

  const cle = texte(f.get('cle'), 80) || crypto.randomUUID();
  const rubrique = String(f.get('rubrique') || '');
  const titre = texte(f.get('titre'), 120);
  const descr = texte(f.get('descr'), 200);
  const lien = texte(f.get('lien'), 600);
  const fichier = f.get('fichier');
  const avecFichier = fichier && typeof fichier !== 'string' && fichier.size > 0;
  if (!(await ids(db)).includes(rubrique)) return json({ ok: false, erreur: 'Choisissez la rubrique.' }, 400);
  if (!titre) return json({ ok: false, erreur: 'Indiquez le nom du document.' }, 400);
  if (avecFichier && fichier.size > 40_000_000) return json({ ok: false, erreur: 'Fichier trop lourd (40 Mo au plus).' }, 413);
  if (lien && !lienOk(lien)) return json({ ok: false, erreur: 'Adresse du lien incorrecte (elle commence par https://).' }, 400);

  let base = null;
  try { base = JSON.parse(String(f.get('base') || 'null')); } catch { /* sans */ }
  await garderBase(db, cle, base, maintenant);
  const avant = await db.prepare("SELECT lien, fichier, mime, taille, donnees FROM docs_club WHERE cle = ?1 AND etat = 'actif' ORDER BY cree DESC LIMIT 1").bind(cle).first();

  const id = crypto.randomUUID();
  let v = { lien: null, fichier: null, mime: null, taille: null, donnees: null, morceaux: 0 };
  if (avecFichier) {
    const ext = (fichier.name.match(/\.[A-Za-z0-9]{1,5}$/) || ['.pdf'])[0].toLowerCase();
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const n = Math.max(1, Math.ceil(octets.length / MORCEAU));
    // Un morceau par requête : chaque requête D1 reste sous sa taille limite
    for (let i = 0; i < n; i++) await db.prepare('INSERT INTO docs_club_morceaux (doc, n, data) VALUES (?1, ?2, ?3)').bind(id, i, octets.buffer.slice(i * MORCEAU, (i + 1) * MORCEAU)).run();
    v = { lien: null, fichier: titre.replace(/[\\/:*?"<>|]/g, '-') + ext, mime: fichier.type || 'application/octet-stream', taille: octets.length, donnees: id, morceaux: n };
  } else if (lien) {
    v.lien = lien;
  } else if (avant) {
    v = { lien: avant.lien, fichier: avant.fichier, mime: avant.mime, taille: avant.taille, donnees: avant.donnees, morceaux: 0 };
  } else {
    return json({ ok: false, erreur: 'Choisissez un fichier ou indiquez un lien.' }, 400);
  }

  await db.batch([
    db.prepare("UPDATE docs_club SET etat = 'ancien', change = ?2 WHERE cle = ?1 AND etat = 'actif'").bind(cle, maintenant),
    db.prepare(`INSERT INTO docs_club (id, cle, rubrique, titre, descr, lien, fichier, mime, taille, morceaux, donnees, cree, change, etat)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, 'actif')`).bind(
      id, cle, rubrique, titre, descr || null, v.lien, v.fichier, v.mime, v.taille, v.morceaux, v.donnees, maintenant),
  ]);
  return json({ ok: true, id, cle, titre });
}
