// Documents des avions déposés depuis l'appli.
//   GET                                       → { docs: [...] } (membres)
//   POST multipart (admin) : fichier, avion, type, titre?, debut?, fin?, motDePasse
//        → enregistre le document ; un document de vol du même type et du même avion passe en historique
//   POST JSON { action: 'supprimer', id, motDePasse } (admin) → document effacé
import { estAdmin, json } from '../../_alertes.js';
import { tableDocs, nommer, TYPES_VOL, TYPES_MANUEL, MORCEAU } from '../../_docs.js';

const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, docs: [] }, 503);
  await tableDocs(env.DB);
  const { results } = await env.DB.prepare(
    'SELECT id, avion, type, colonne, titre, debut, fin, fichier, mime, taille, cree, archive FROM docs ORDER BY cree DESC LIMIT 500',
  ).all();
  return json({ ok: true, docs: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  await tableDocs(env.DB);
  const type = request.headers.get('content-type') || '';

  if (type.includes('application/json')) {
    let d = null;
    try { d = await request.json(); } catch { /* illisible */ }
    if (!d || !estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
    if (d.action === 'supprimer') {
      const id = String(d.id || '');
      const doc = await env.DB.prepare('SELECT avion, type, colonne, archive FROM docs WHERE id = ?1').bind(id).first();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM docs_morceaux WHERE doc = ?1').bind(id),
        env.DB.prepare('DELETE FROM docs WHERE id = ?1').bind(id),
      ]);
      // Le document en vigueur est effacé : le plus récent de son historique reprend sa place
      if (doc && !doc.archive && doc.colonne === 'vol' && doc.type !== 'Autre document de vol') {
        await env.DB.prepare(`UPDATE docs SET archive = NULL WHERE id = (SELECT id FROM docs WHERE avion = ?1 AND type = ?2 ORDER BY cree DESC LIMIT 1)`).bind(doc.avion, doc.type).run();
      }
      return json({ ok: true });
    }
    return json({ ok: false, erreur: 'Action inconnue.' }, 400);
  }

  let f = null;
  try { f = await request.formData(); } catch { /* pas un formulaire */ }
  if (!f) return json({ ok: false, erreur: 'Envoi illisible.' }, 400);
  if (!estAdmin(env, f.get('motDePasse'))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  const fichier = f.get('fichier');
  const avion = String(f.get('avion') || '').trim().toUpperCase();
  const t = String(f.get('type') || '');
  const titre = String(f.get('titre') || '').trim().slice(0, 120);
  if (!fichier || typeof fichier === 'string' || !fichier.size) return json({ ok: false, erreur: 'Aucun fichier.' }, 400);
  if (fichier.size > 40_000_000) return json({ ok: false, erreur: 'Fichier trop lourd (40 Mo au plus).' }, 413);
  if (!/^[A-Z]-[A-Z0-9]{4}$/.test(avion)) return json({ ok: false, erreur: 'Avion inconnu.' }, 400);
  const colonne = TYPES_VOL.includes(t) ? 'vol' : TYPES_MANUEL.includes(t) ? 'manuel' : null;
  if (!colonne) return json({ ok: false, erreur: 'Type de document inconnu.' }, 400);
  if ((colonne === 'manuel' || t === 'Autre document de vol') && !titre) return json({ ok: false, erreur: 'Indiquez le nom du document.' }, 400);

  const id = crypto.randomUUID();
  const nom = nommer(avion, t, titre);
  const ext = (fichier.name.match(/\.[A-Za-z0-9]{1,5}$/) || ['.pdf'])[0].toLowerCase();
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const n = Math.max(1, Math.ceil(octets.length / MORCEAU));
  const maintenant = new Date().toISOString();
  const lignes = [];
  for (let i = 0; i < n; i++) lignes.push(env.DB.prepare('INSERT INTO docs_morceaux (doc, n, data) VALUES (?1, ?2, ?3)').bind(id, i, octets.buffer.slice(i * MORCEAU, (i + 1) * MORCEAU)));
  // Un seul morceau par requête : une requête D1 reste sous sa taille limite
  for (const l of lignes) await l.run();
  const lots = [];
  // Document de vol : l'ancien du même type passe en historique (sauf « Autre document de vol », qui s'ajoute)
  if (colonne === 'vol' && t !== 'Autre document de vol') lots.push(env.DB.prepare('UPDATE docs SET archive = ?3 WHERE avion = ?1 AND type = ?2 AND archive IS NULL').bind(avion, t, maintenant));
  lots.push(env.DB.prepare(`INSERT INTO docs (id, avion, type, colonne, titre, debut, fin, fichier, mime, taille, morceaux, cree, archive)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)`).bind(
    id, avion, t, colonne, nom, date(f.get('debut')), date(f.get('fin')), nom + ext, fichier.type || 'application/octet-stream', octets.length, n, maintenant));
  await env.DB.batch(lots);
  return json({ ok: true, id, titre: nom });
}
