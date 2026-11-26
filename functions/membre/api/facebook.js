// État de la copie des actus Facebook (/membre/facebook/, admin, consultation seule).
// Les passages sont envoyés par GitHub après chaque copie (voir functions/_facebook.js) : aucun jeton à gérer.
//   GET → { actif, derniere, derniereReussie, total, derniereActu, recuperations }
import { tableFacebook } from '../../_facebook.js';
import { json } from '../../_alertes.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  await tableFacebook(env.DB);
  const db = env.DB;
  const [derniere, reussie, recups] = await Promise.all([
    db.prepare('SELECT * FROM facebook_passages ORDER BY date DESC LIMIT 1').first(),
    db.prepare('SELECT * FROM facebook_passages WHERE ok = 1 ORDER BY date DESC LIMIT 1').first(),
    db.prepare('SELECT date, ajoutees FROM facebook_passages WHERE ajoutees > 0 ORDER BY date DESC LIMIT 8').all(),
  ]);
  const passage = (r) => r && { date: r.date, ok: !!r.ok, manuel: !!r.manuel, lien: r.lien };
  return json({
    ok: true,
    actif: derniere ? !!derniere.ok : null,
    derniere: passage(derniere),
    derniereReussie: passage(reussie),
    total: reussie?.total ?? null,
    derniereActu: reussie?.derniere_actu ?? null,
    recuperations: (recups.results || []).map((r) => ({ date: r.date, nombre: r.ajoutees })),
  });
}
