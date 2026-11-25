// Liste des NOTAM : même rendu sur le tableau de bord TV et dans l'espace membre.
// Données : API /dashboard/api/donnees (TV) ou /membre/api/notam (appli), toutes deux via lireNotam() (FAA NMS).

export interface Notam { numero: string; snow?: boolean; sujet: string | null; debut: string | null; fin: string | null; texte: string; horaires?: string | null; brut?: string | null }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const p2 = (n: number) => String(n).padStart(2, '0');
const utc = (iso: string | null) => (iso ? new Date(iso) : null);
const hUtc = (d: Date) => `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
const jmUtc = (d: Date) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`;

// Badge carré par catégorie (2 premières lettres du code Q) : lettre + nom, façon ForeFlight
const ANTENNE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 11v10"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M8.5 5.5a5 5 0 0 0 0 7M15.5 5.5a5 5 0 0 1 0 7M5.5 3a9 9 0 0 0 0 12.5M18.5 3a9 9 0 0 1 0 12.5"/></svg>';
const CATS: [RegExp, string, string, string][] = [
  [/^M[XY]/, 'TWY', 'Taxiway', 'jaune'], [/^M[KNP]/, 'APN', 'Aire de trafic', 'jaune'], [/^M/, 'RWY', 'Piste', 'rouge'],
  [/^L/, 'LGT', 'Balisage', 'jaune'], [/^[NI]/, ANTENNE, 'Radionav', 'gris'], [/^G/, 'GNSS', 'GNSS', 'bleu'],
  [/^C/, 'COM', 'Comm', 'bleu'], [/^[AR]/, 'AIR', 'Espace', 'violet'], [/^P/, 'PROC', 'Procédure', 'violet'],
  [/^W/, 'ACT', 'Activité', 'violet'], [/^S/, 'SVC', 'Service', 'gris'], [/^F/, 'AD', 'Aérodrome', 'gris'],
];
// Ordre d'affichage des NOTAM par badge (après « en cours / à venir ») : pistes d'abord
const ORDRE = ['RWY', 'TWY', 'APN', 'LGT', ANTENNE, 'GNSS', 'COM', 'AIR', 'PROC', 'ACT', 'SVC', 'AD', 'INFO'];
const cat = (q: string | null) => CATS.find(([re]) => re.test(q || '')) ?? [null, 'INFO', 'Divers', 'gris'] as const;
// Mots d'indisponibilité en rouge (abréviations développées comme ForeFlight)
const ROUGES = /\b(CLSD|CLOSED|U\/S|UNSERVICEABLE|OUT OF ORDER|OUT OF SERVICE|NOT AVBL|NOT AVAILABLE|SUSPENDED|PROHIBITED|FORBIDDEN|UNUSABLE|INUTILISABLE|HORS SERVICE|FERME|FERMEE|INTERDIT|INTERDITE|WITHDRAWN)\b/g;
const texteNotam = (t: string) => esc(t).replace(ROUGES, (m) => `<em>${m === 'CLSD' ? 'CLOSED' : m === 'U/S' ? 'UNSERVICEABLE' : m === 'NOT AVBL' ? 'NOT AVAILABLE' : m}</em>`);
export const actif = (debut: string | null) => { const d = utc(debut); return !!d && d.getTime() <= Date.now(); };
function validite(debut: string | null, fin: string | null) {
  const d = utc(debut), f = fin && /^\d{4}-/.test(fin) ? new Date(fin) : null;
  const t = (x: Date) => `${jmUtc(x)} · ${hUtc(x)}`;
  if (!d) return '';
  if (fin === 'PERM') return `Depuis le ${t(d)} · permanent`;
  return d.getTime() <= Date.now() ? (f ? `Jusqu’au ${t(f)} UTC` : '') : `${t(d)} → ${f ? t(f) : '…'} UTC`;
}

// Procédures (SID, STAR, approches) masquées pour l'instant : elles concernent surtout les vols IFR.
// La source renvoie parfois le même NOTAM deux fois : un seul par numéro.
// Tri : SNOWTAM, puis actifs, puis par catégorie (pistes d'abord), puis les plus récents.
export function trierNotam(liste: Notam[] = []) {
  const vus = new Set<string>();
  return [...liste].filter((x) => { const k = x.numero || x.texte; if (vus.has(k)) return false; vus.add(k); return true; })
    .filter((x) => x.snow || cat(x.sujet)[1] !== 'PROC')
    .sort((a, b) => Number(b.snow) - Number(a.snow) || Number(actif(b.debut)) - Number(actif(a.debut)) || ORDRE.indexOf(cat(a.sujet)[1]) - ORDRE.indexOf(cat(b.sujet)[1]) || String(b.debut).localeCompare(String(a.debut)));
}

export function ligneNotam(x: Notam, sup = false) {
  const [, l, nom, coul] = sup ? [null, 'SUP', 'SUP AIP', 'gris'] : x.snow ? [null, 'SNOW', 'SNOWTAM · état des pistes', 'neige'] : cat(x.sujet);
  return `<div class="n"><span class="ic ${coul}${l.length > 2 && !l.startsWith('<') ? ' l' + l.length : ''}" title="${nom}">${l}</span><div><b>${texteNotam(x.texte)} <span class="no">${esc(x.numero || '')}</span></b><small>${actif(x.debut) ? '<span class="actif">ACTIF</span>' : ''}${esc(validite(x.debut, x.fin))}</small></div></div>`;
}

export const NOTAM_INFO = 'hors obstacles et procédures IFR';
export const NOTAM_VIDE = 'Aucun NOTAM en vigueur (hors obstacles et procédures IFR).';
export const notamIndispo = (raison?: string) => raison === 'cle' ? 'En attente de la clé de l’API NOTAM (FAA) dans Cloudflare.' : 'NOTAM indisponibles pour le moment.';

// Détail d'un NOTAM (appli, au toucher) : catégorie, validité en LT et UTC, texte complet
const hLoc = (d: Date) => d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(' ', ' · ');
const deux = (d: Date) => `${hLoc(d)} LT <small>(${jmUtc(d)} · ${hUtc(d)} UTC)</small>`;
// Créneaux du champ D) (UTC) traduits en LT : « 1500-1545 » → « 16:00 → 16:45 LT (15:00 → 15:45 UTC) »
function horairesLT(h: string, ref: Date | null) {
  const decalage = (jour: Date) => { const p = new Date(jour.toLocaleString('en-US', { timeZone: 'Europe/Paris' })); const u = new Date(jour.toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((p.getTime() - u.getTime()) / 60000); };
  const dec = decalage(new Date(Math.max(Date.now(), ref?.getTime() ?? 0)));
  const loc = (hhmm: string) => { const m = (+hhmm.slice(0, 2) * 60 + +hhmm.slice(2) + dec + 1440) % 1440; return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`; };
  const fmt = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  const creneaux = [...h.matchAll(/\b([0-2]\d[0-5]\d)-([0-2]\d[0-5]\d)\b/g)];
  if (!creneaux.length) return esc(h);
  const lt = creneaux.map(([, a, b]) => `${loc(a)} → ${loc(b)}`).join(', ');
  const MOTS: Record<string, string> = { DAILY: 'chaque jour', MON: 'lun', TUE: 'mar', WED: 'mer', THU: 'jeu', FRI: 'ven', SAT: 'sam', SUN: 'dim', EXC: 'sauf', HOL: 'jours fériés', AND: 'et' };
  const reste = h.replace(/\b[0-2]\d[0-5]\d-[0-2]\d[0-5]\d\b/g, '').replace(/[\s,]+/g, ' ').trim().replace(/\b[A-Z]{3,5}\b/g, (m) => MOTS[m] ?? m).replace(/^./, (c) => c.toUpperCase());
  return `${esc(reste ? reste + ' · ' : 'Chaque jour · ')}${lt} LT <small>(${creneaux.map(([, a, b]) => `${fmt(a)} → ${fmt(b)}`).join(', ')} UTC · ${esc(h)})</small>`;
}
export function detailNotam(x: Notam) {
  const [, l, nom, coul] = x.snow ? [null, 'SNOW', 'SNOWTAM · état des pistes', 'neige'] : cat(x.sujet);
  const d = utc(x.debut), f = x.fin && /^\d{4}-/.test(x.fin) ? new Date(x.fin) : null;
  const on = actif(x.debut);
  return `<div class="nd-tete"><span class="ic ${coul}${l.length > 2 && !l.startsWith('<') ? ' l' + l.length : ''}">${l}</span><div><b>${esc(nom)}</b><span>NOTAM ${esc(x.numero || '')}</span></div><em class="${on ? 'on' : ''}">${on ? 'ACTIF' : 'À VENIR'}</em></div>
    <dl class="nd-dates"><div><dt>Début</dt><dd>${d ? deux(d) : '—'}</dd></div><div><dt>Fin</dt><dd>${x.fin === 'PERM' ? 'permanent' : f ? deux(f) : '—'}</dd></div></dl>
    ${x.horaires ? `<div class="nd-horaires"><dt>Horaires</dt><dd>${horairesLT(x.horaires, d)}</dd></div>` : ''}
    <p class="nd-texte">${texteNotam(x.texte)}</p>
    ${x.brut ? `<h4 class="nd-brut-t">Message brut</h4><pre class="nd-brut">${esc(x.brut)}</pre>` : ''}`;
}
