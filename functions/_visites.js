// Compteur de visites du site, sans cookies et sans données personnelles.
// Chaque page HTML servie à un vrai navigateur ajoute une ligne dans la table D1 « visites » :
// jour, section (vitrine, membre, perfs ; la TV du club n'est pas comptée), page, provenance, appareil, ville.
// Le visiteur n'est reconnu que le jour même, par une empreinte (adresse + navigateur + sel tiré au sort chaque jour) :
// le sel du jour est oublié le lendemain, on ne peut donc ni retrouver l'adresse ni suivre quelqu'un d'un jour à l'autre.
// Les chiffres sont lus par /statistiques/ (mot de passe admin).

const ROBOTS = /bot|crawl|spider|slurp|preview|fetch|monitor|lighthouse|headless|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|facebookexternalhit|whatsapp|telegram|discord|semrush|ahrefs|bingpreview|scan/i;
const GARDER_JOURS = 400;

let pret = false;
let sel = { jour: '', valeur: '' };

export const jourParis = (d = new Date()) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
export const heureParis = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).find((x) => x.type === 'hour')?.value || 0) % 24;

/** Empreinte du visiteur pour la journée (16 caractères), impossible à relier à une adresse ou à un autre jour. */
export async function empreinte(db, request, jour) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${await selDuJour(db, jour)}|${ip}|${ua}`)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const estRobot = (ua) => !ua || ROBOTS.test(ua);
export const estApercu = (url) => /\.acbt60\.pages\.dev$/.test(url.hostname) || url.hostname === 'localhost';

export async function tableVisites(db) {
  if (pret) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS visites (
      id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, jour TEXT NOT NULL, section TEXT NOT NULL,
      page TEXT NOT NULL, source TEXT, appareil TEXT, pays TEXT, ville TEXT, v TEXT, heure INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evenements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, jour TEXT NOT NULL, page TEXT NOT NULL, e TEXT NOT NULL, d TEXT, n REAL, v TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS evenements_jour ON evenements (jour, e)'),
    db.prepare('CREATE INDEX IF NOT EXISTS visites_jour ON visites (jour, section)'),
  ]);
  // Colonne ajoutée après la première mise en ligne (table déjà créée sans elle)
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('visites')").all();
  if (!(results || []).some((r) => r.name === 'heure')) {
    try { await db.prepare('ALTER TABLE visites ADD COLUMN heure INTEGER').run(); } catch { /* ajoutée entre-temps */ }
  }
  pret = true;
}

async function selDuJour(db, jour) {
  if (sel.jour === jour) return sel.valeur;
  const row = await db.prepare("SELECT valeur FROM reglages WHERE cle = 'sel-visites'").first();
  let s = row ? JSON.parse(row.valeur) : null;
  if (!s || s.jour !== jour) {
    const octets = crypto.getRandomValues(new Uint8Array(16));
    s = { jour, valeur: [...octets].map((b) => b.toString(16).padStart(2, '0')).join('') };
    await db.prepare("INSERT INTO reglages (cle, valeur) VALUES ('sel-visites', ?1) ON CONFLICT(cle) DO UPDATE SET valeur = ?1").bind(JSON.stringify(s)).run();
  }
  sel = s;
  return s.valeur;
}

export function section(chemin) {
  if (chemin.startsWith('/membre/perfs')) return 'perfs';
  if (chemin === '/membre' || chemin.startsWith('/membre/')) return 'membre';
  return 'vitrine';
}

export function provenance(request, url) {
  const q = url.searchParams;
  if (q.has('fbclid')) return 'Facebook';
  if (q.has('gclid')) return 'Google';
  const ref = request.headers.get('Referer') || '';
  if (!ref) return q.get('utm_source') ? String(q.get('utm_source')).slice(0, 40) : 'Direct';
  let h = '';
  try { h = new URL(ref).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'Direct'; }
  if (h === url.hostname.replace(/^www\./, '') || h.endsWith('acbt60.fr') || h.endsWith('acbt60.pages.dev')) return 'interne';
  const connus = [
    [/(^|\.)google\./, 'Google'], [/bing\.com$/, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/qwant/, 'Qwant'], [/ecosia/, 'Ecosia'],
    [/yahoo/, 'Yahoo'], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/instagram/, 'Instagram'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X (Twitter)'],
    [/linkedin/, 'LinkedIn'], [/youtube|youtu\.be/, 'YouTube'], [/chatgpt|openai/, 'ChatGPT'], [/android-app/, 'Application'],
  ];
  for (const [re, nom] of connus) if (re.test(h)) return nom;
  return h.slice(0, 60);
}

export function appareil(ua) {
  if (/Android TV|GoogleTV|AFT[A-Z]|BRAVIA|SMART-TV|SmartTV|CrKey|Tizen|Web0S|HbbTV/i.test(ua)) return 'tv';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablette';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'telephone';
  return 'ordinateur';
}

export function pageNette(chemin) {
  let p = chemin;
  try { p = decodeURIComponent(p); } catch { /* tel quel */ }
  p = p.toLowerCase().replace(/\/index\.html?$/, '/').replace(/\/{2,}/g, '/');
  if (!p.endsWith('/') && !/\.[a-z0-9]{2,5}$/.test(p)) p += '/';
  return p.slice(0, 120);
}

/** Faut-il compter cette réponse comme une page vue ? */
export function aCompter(request, rep, url) {
  if (request.method !== 'GET' || rep.status !== 200) return false;
  if (!(rep.headers.get('Content-Type') || '').includes('text/html')) return false;
  if (!(request.headers.get('Accept') || '').includes('text/html')) return false;
  const but = `${request.headers.get('Sec-Purpose') || ''} ${request.headers.get('Purpose') || ''} ${request.headers.get('X-Moz') || ''}`;
  if (/prefetch|prerender/i.test(but)) return false;
  if (estRobot(request.headers.get('User-Agent') || '')) return false;
  const p = url.pathname;
  if (p === '/dashboard' || p.startsWith('/dashboard/')) return false; // TV du club : une seule télé, pas utile
  if (p.startsWith('/api/') || p.startsWith('/admin') || p.startsWith('/statistiques') || p.includes('/api/')) return false;
  // Les adresses d'aperçu (branche.acbt60.pages.dev) ne comptent pas
  return !estApercu(url);
}

export async function compter(request, env, url) {
  if (!env.DB) return;
  try {
    const db = env.DB;
    await tableVisites(db);
    const maintenant = new Date();
    const jour = jourParis(maintenant);
    const ua = request.headers.get('User-Agent') || '';
    const v = await empreinte(db, request, jour);
    const cf = request.cf || {};
    await db.prepare('INSERT INTO visites (t, jour, section, page, source, appareil, pays, ville, v, heure) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(maintenant.toISOString(), jour, section(url.pathname), pageNette(url.pathname), provenance(request, url), appareil(ua),
        cf.country || null, cf.city ? String(cf.city).slice(0, 60) : null, v, heureParis(maintenant))
      .run();
    if (Math.random() < 0.002) {
      const limite = jourParis(new Date(Date.now() - GARDER_JOURS * 864e5));
      await db.batch([db.prepare('DELETE FROM visites WHERE jour < ?1').bind(limite), db.prepare('DELETE FROM evenements WHERE jour < ?1').bind(limite)]);
    }
  } catch { /* le comptage ne doit jamais gêner le site */ }
}
