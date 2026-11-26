// Procédures par faible visibilité (LVP) et Pré-LVP de l'aéroport de Beauvais.
// Le service trafic de l'aéroport envoie un mail « Activation - LVP » / « Désactivation - Pré-LVP »…
// avec « Date et heure : 2026-11-22T04:43:00Z ». Ces mails arrivent sur meteo@acbt60.fr et passent par /api/maa.
// État rangé dans la base D1 (table lvp) : une ligne par procédure (lvp, prelvp).

// Sans mail de désactivation, la procédure s'arrête d'elle-même le lendemain du jour de réception (J+1) à 03h00, heure de Paris.
const HEURE_FIN = 3;

/** J+1 à 03h00 heure de Paris, J étant le jour (à Paris) de l'instant donné. */
export function finAuto(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return 0;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const decalage = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60000) * 60000; // Paris - UTC
  return Date.UTC(+p.year, +p.month - 1, +p.day + 1, HEURE_FIN) - decalage; // le lendemain (J+1) à 03h00
}

export async function tableLvp(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lvp (
    cle TEXT PRIMARY KEY, actif INTEGER NOT NULL, depuis TEXT, maj TEXT NOT NULL)`).run();
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('lvp')").all();
  if (!(results || []).some((r) => r.name === 'vu')) { try { await db.prepare('ALTER TABLE lvp ADD COLUMN vu TEXT').run(); } catch { /* déjà là */ } }
}

const simple = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Lit un mail LVP : { cle: 'lvp' | 'prelvp', actif, date } ou null si ce n'en est pas un. */
export function lireLvp(sujet, texte, recu = new Date()) {
  for (const source of [sujet, texte]) {
    const m = simple(source).match(/\b(activation|desactivation)\s*[-–:]\s*(pre\s*-?\s*lvp|lvp)\b/);
    if (!m) continue;
    const d = simple(texte + ' ' + sujet).match(/date et heure\s*:\s*(\d{4}-\d\d-\d\dt\d\d:\d\d(?::\d\d)?z)/);
    const date = d ? new Date(d[1].toUpperCase()) : recu;
    return { cle: m[2].startsWith('pre') ? 'prelvp' : 'lvp', actif: m[1] === 'activation', date: isNaN(date) ? recu.toISOString() : date.toISOString() };
  }
  return null;
}

/** Enregistre l'activation ou la désactivation : l'heure affichée est toujours celle du DERNIER mail reçu
 * (à la réouverture du terrain, l'aéroport renvoie une activation ; un mail plus ancien que l'état connu est ignoré). */
export async function appliquerLvp(db, lu) {
  await tableLvp(db);
  const r = await db.prepare(`INSERT INTO lvp (cle, actif, depuis, maj, vu) VALUES (?1, ?2, ?3, ?3, ?4)
    ON CONFLICT(cle) DO UPDATE SET actif = ?2, depuis = ?3, maj = ?3, vu = ?4
    WHERE lvp.maj <= ?3`).bind(lu.cle, lu.actif ? 1 : 0, lu.date, new Date().toISOString()).run();
  return r.meta.changes > 0;
}

/** État pour l'appli et la TV : { actif, type: 'LVP' | 'Pré-LVP', depuis } (la LVP l'emporte sur la Pré-LVP). */
export async function etatLvp(db) {
  try {
    await tableLvp(db);
    const { results } = await db.prepare('SELECT cle, actif, depuis, maj, vu FROM lvp').all();
    const n = Date.now();
    // Seul compte le DERNIER mail reçu, LVP et Pré-LVP confondus (règle d'Hugo) :
    // une activation affiche son type, une désactivation (LVP ou Pré-LVP) éteint tout.
    const dernier = (results || []).reduce((a, r) => (!a || String(r.maj) > String(a.maj) ? r : a), null);
    const l = dernier && dernier.actif && n < finAuto(dernier.vu || dernier.depuis) ? dernier : null;
    return l ? { actif: true, type: l.cle === 'lvp' ? 'LVP' : 'Pré-LVP', depuis: l.maj || l.depuis } : { actif: false }; // depuis = heure du dernier mail reçu
  } catch { return null; }
}
