// Reçoit le résultat de chaque passage de la copie Facebook (envoyé par GitHub Actions, voir _facebook.js).
//   POST, en-tête Authorization: Bearer <jeton OIDC GitHub>, corps { ok, ajoutees, total, derniereActu }
import { tableFacebook, verifierGithub } from '../_facebook.js';
import { json } from '../_alertes.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false }, 503);
  const infos = await verifierGithub((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!infos) return json({ ok: false, erreur: 'Envoi non reconnu.' }, 401);
  let d = {};
  try { d = await request.json(); } catch { /* vide */ }
  const n = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : null);
  await tableFacebook(env.DB);
  await env.DB.prepare('INSERT INTO facebook_passages (date, ok, ajoutees, manuel, total, derniere_actu, lien) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(new Date().toISOString(), d.ok ? 1 : 0, n(d.ajoutees) ?? 0, infos.event_name === 'workflow_dispatch' ? 1 : 0, n(d.total),
      d.derniereActu ? String(d.derniereActu).slice(0, 200) : null, `https://github.com/${infos.repository}/actions/runs/${infos.run_id}`)
    .run();
  // On garde un an d'historique au plus
  await env.DB.prepare("DELETE FROM facebook_passages WHERE date < ?1").bind(new Date(Date.now() - 366 * 864e5).toISOString()).run();
  return json({ ok: true });
}
