// Changements de tarifs programmés par l'admin (appli > Admin > Tarifs), rangés dans la base D1.
//   GET  (public, les prix le sont aussi)       → { changements: [...], version }
//        lu par scripts/tarifs-planifies.mjs juste avant chaque publication du site
//   POST { action, motDePasse, ... } (admin) :
//        ajouter  { cible, prix, prix2?, a_partir_du, note? }
//        modifier { id, prix, prix2?, a_partir_du, note? }
//        annuler  { id }
// cible : « avion:F-GCAL » (prix = heure en solo, prix2 = heure en double commande)
//         ou « formule:<titre>|<libellé> » (vol découverte, vol d'initiation…)
import { estAdmin, json } from '../_alertes.js';

async function table(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS tarifs_planifies (
    id TEXT PRIMARY KEY, cible TEXT NOT NULL, prix REAL NOT NULL, prix2 REAL, a_partir_du TEXT NOT NULL,
    note TEXT, cree TEXT NOT NULL, maj TEXT NOT NULL)`).run();
}
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const nombre = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, changements: [] }, 503);
  await table(env.DB);
  const { results } = await env.DB.prepare('SELECT id, cible, prix, prix2, a_partir_du, note, maj FROM tarifs_planifies ORDER BY a_partir_du, cible').all();
  const changements = results || [];
  const version = changements.map((c) => c.id + c.maj).sort().join('|');
  return new Response(JSON.stringify({ ok: true, changements, version: String(changements.length) + ':' + (await empreinte(version)) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}

async function empreinte(t) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d = null;
  try { d = await request.json(); } catch { /* illisible */ }
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!(await estAdmin(env, d.motDePasse))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  await table(env.DB);
  const maintenant = new Date().toISOString();
  if (d.action === 'annuler') {
    await env.DB.prepare('DELETE FROM tarifs_planifies WHERE id = ?1').bind(String(d.id || '')).run();
    return json({ ok: true });
  }
  const prix = nombre(d.prix), prix2 = d.prix2 === '' || d.prix2 == null ? null : nombre(d.prix2), jour = date(d.a_partir_du);
  const note = String(d.note || '').trim().slice(0, 200) || null;
  if (prix == null) return json({ ok: false, erreur: 'Prix invalide.' }, 400);
  if (!jour) return json({ ok: false, erreur: 'Date invalide.' }, 400);
  if (d.action === 'ajouter') {
    const cible = String(d.cible || '');
    if (!/^avion:[A-Z]-[A-Z0-9]{4}$|^formule:.+\|.+$/.test(cible)) return json({ ok: false, erreur: 'Tarif inconnu.' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO tarifs_planifies (id, cible, prix, prix2, a_partir_du, note, cree, maj) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
      .bind(id, cible, prix, prix2, jour, note, maintenant).run();
    return json({ ok: true, id });
  }
  if (d.action === 'modifier') {
    await env.DB.prepare('UPDATE tarifs_planifies SET prix = ?2, prix2 = ?3, a_partir_du = ?4, note = ?5, maj = ?6 WHERE id = ?1')
      .bind(String(d.id || ''), prix, prix2, jour, note, maintenant).run();
    return json({ ok: true });
  }
  return json({ ok: false, erreur: 'Action inconnue.' }, 400);
}
