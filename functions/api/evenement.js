// Reçoit les actions des visiteurs du site public (src/scripts/stats.ts) : clic sur Réserver, appel, mail,
// lien sortant, document, formulaire envoyé, temps passé sur la page. Sans cookies, voir _visites.js.
import { tableVisites, jourParis, empreinte, estRobot, estApercu, pageNette } from '../_visites.js';

const NOMS = new Set(['clic-contact', 'formulaire', 'formulaire-erreur', 'appel', 'mail', 'sortie', 'document', '_temps']);
const vide = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env, waitUntil }) {
  const url = new URL(request.url);
  if (!env.DB || estApercu(url) || estRobot(request.headers.get('User-Agent') || '')) return vide();
  const texte = await request.text().catch(() => '');
  if (texte.length > 1000) return vide();
  let d = null;
  try { d = JSON.parse(texte); } catch { return vide(); }
  if (!d || !NOMS.has(d.e)) return vide();
  const n = Number(d.n);
  waitUntil((async () => {
    try {
      const db = env.DB;
      await tableVisites(db);
      const maintenant = new Date();
      const jour = jourParis(maintenant);
      await db.prepare('INSERT INTO evenements (t, jour, page, e, d, n, v) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(maintenant.toISOString(), jour, pageNette(String(d.p || '/')), d.e, d.d ? String(d.d).slice(0, 80) : null,
          Number.isFinite(n) ? Math.max(0, Math.min(1800, n)) : null, await empreinte(db, request, jour))
        .run();
    } catch { /* jamais bloquant */ }
  })());
  return vide();
}
