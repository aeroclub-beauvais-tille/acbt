// Cartes météo du club, partagées par la TV (/dashboard) et l'appli membres (onglet Météo) :
// - WINTEM du club : vent (barbules) et température à FL020, FL050, FL100 sur le nord de la France ;
// - « TEMSI » du club : nuages bas, pluie, neige, brouillard, orages et isotherme 0 °C (indicatif) ;
// - carte des fronts du DWD, recadrée sur la France.
// Données préparées par functions/_cartes.js (Open-Meteo, modèles Météo-France ; DWD).
// Couleurs réglables par page : --cm-mer, --cm-terre, --cm-voisin, --cm-trait, --cm-encre, --cm-chaud, --cm-froid.
import { FOND, FRANCE, VOISINS } from './fond-carte';

export type Grille = {
  grille: { lat0: number; dlat: number; nlat: number; lon0: number; dlon: number; nlon: number };
  heures: string[];
  v: (number | null)[][][];
};
export type Cartes = { grille: Grille | null; fronts: string | null };

export const NIVEAUX = ['FL020', 'FL050', 'FL100'];
const { w: W, h: H } = FOND;
const P = (lon: number, lat: number): [number, number] => [
  ((lon - FOND.lon0) / (FOND.lon1 - FOND.lon0)) * W,
  ((FOND.lat1 - lat) / (FOND.lat1 - FOND.lat0)) * H,
];
const f1 = (x: number) => x.toFixed(1);

const VILLES: [string, number, number][] = [
  ['Paris', 2.35, 48.86], ['Lille', 3.06, 50.63], ['Rouen', 1.1, 49.44], ['Caen', -0.37, 49.18], ['Reims', 4.03, 49.26],
  ['Amiens', 2.3, 49.89], ['Orléans', 1.9, 47.9], ['Rennes', -1.68, 48.11], ['Le Mans', 0.2, 48.0], ['Metz', 6.18, 49.12],
  ['Troyes', 4.08, 48.3], ['Tours', 0.69, 47.39], ['Dijon', 5.04, 47.32], ['Le Havre', 0.11, 49.49], ['Cherbourg', -1.62, 49.64],
];

const STYLE = `<style>
.cm-mer{fill:var(--cm-mer,#cfdcec)}.cm-fr{fill:var(--cm-terre,#f6f8fb);stroke:var(--cm-trait,#8f9bb0);stroke-width:1.3}
.cm-vo{fill:var(--cm-voisin,#e4e8ef);stroke:var(--cm-trait,#8f9bb0);stroke-width:.8}
.cm-v{fill:var(--cm-encre,#55607a);font-size:11px}.cm-vp{fill:var(--cm-encre,#55607a)}
.cm-b{stroke:var(--cm-barbule,#0b2a5b);fill:var(--cm-barbule,#0b2a5b);stroke-width:1.8;stroke-linecap:round}
.cm-tc{fill:var(--cm-chaud,#c0141f);font-weight:800;font-size:12.5px}.cm-tf{fill:var(--cm-froid,#1f4fd1);font-weight:800;font-size:12.5px}
.cm-lfob{fill:#ec091d;stroke:#fff;stroke-width:2}.cm-lfobt{fill:var(--cm-titre,#0b2a5b);font-weight:800;font-size:13px;paint-order:stroke;stroke:var(--cm-terre,#f6f8fb);stroke-width:3px}
.cm-nb{fill:var(--cm-nuage,#7d8799)}.cm-cb{fill:#d6333f;font-weight:900;font-size:15px;paint-order:stroke;stroke:var(--cm-terre,#fff);stroke-width:3px}
.cm-i0 rect{fill:var(--cm-terre,#fff);stroke:var(--cm-froid,#1f4fd1)}.cm-i0 text{fill:var(--cm-froid,#1f4fd1);font-weight:800;font-size:11px}
</style>`;

const DEFS = `<defs>
<filter id="cm-flou" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="9"/></filter>
<pattern id="cm-pluie" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><line x1="0" y1="0" x2="0" y2="9" stroke="#1f9d57" stroke-width="2.2"/></pattern>
<pattern id="cm-neige" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M8 3v10M3.7 5.5l8.6 5M3.7 10.5l8.6-5" stroke="#3b6fe0" stroke-width="1.5"/></pattern>
<pattern id="cm-brume" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.6" fill="#d18f00"/></pattern>
<clipPath id="cm-cadre"><rect width="${W}" height="${H}"/></clipPath></defs>`;

function fond() {
  return `<rect class="cm-mer" width="${W}" height="${H}"/><path class="cm-vo" d="${VOISINS}"/><path class="cm-fr" d="${FRANCE}"/>`;
}

function villes() {
  let s = '';
  for (const [n, lo, la] of VILLES) {
    const [x, y] = P(lo, la);
    if (x < 10 || x > W - 40 || y < 10 || y > H - 10) continue;
    s += `<circle class="cm-vp" cx="${f1(x)}" cy="${f1(y)}" r="2.4"/><text class="cm-v" x="${f1(x + 5)}" y="${f1(y + 12)}">${n}</text>`;
  }
  const [x, y] = P(2.1128, 49.4544);
  return s + `<circle class="cm-lfob" cx="${f1(x)}" cy="${f1(y)}" r="6"/><text class="cm-lfobt" x="${f1(x + 9)}" y="${f1(y - 8)}">LFOB</text>`;
}

const svg = (contenu: string, titre: string) =>
  `<svg class="cm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${titre}" xmlns="http://www.w3.org/2000/svg" font-family="inherit">${STYLE}${DEFS}<g clip-path="url(#cm-cadre)">${contenu}</g></svg>`;

// Points de la grille : [lon, lat, valeurs]
function points(g: Grille, ech: number) {
  const { lat0, dlat, nlat, lon0, dlon, nlon } = g.grille;
  const l: { i: number; j: number; lon: number; lat: number; v: (number | null)[] }[] = [];
  for (let i = 0; i < nlat; i++) for (let j = 0; j < nlon; j++) l.push({ i, j, lat: lat0 + i * dlat, lon: lon0 + j * dlon, v: g.v[ech]?.[i * nlon + j] ?? [] });
  return l;
}

// Barbule de vent : hampe vers la direction d'où vient le vent, barbe = 10 kt, demi-barbe = 5 kt, fanion = 50 kt
function barbule(x: number, y: number, dir: number, kt: number) {
  const k0 = Math.round(kt / 5) * 5;
  if (k0 < 5) return `<circle class="cm-b" cx="${f1(x)}" cy="${f1(y)}" r="4.5" fill="none"/>`;
  const a = (dir * Math.PI) / 180, L = 30;
  const ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux;
  const ex = x + ux * L, ey = y + uy * L;
  const pt = (t: number) => [ex - ux * t, ey - uy * t];
  let s = `<line class="cm-b" x1="${f1(x)}" y1="${f1(y)}" x2="${f1(ex)}" y2="${f1(ey)}"/><circle class="cm-b" cx="${f1(x)}" cy="${f1(y)}" r="2.2"/>`;
  let k = k0, pos = 0;
  while (k >= 50) {
    const [x1, y1] = pt(pos), [x2, y2] = pt(pos + 7);
    s += `<polygon class="cm-b" points="${f1(x1)},${f1(y1)} ${f1(x1 + px * 12)},${f1(y1 + py * 12)} ${f1(x2)},${f1(y2)}"/>`;
    k -= 50; pos += 9;
  }
  while (k >= 10) {
    const [x1, y1] = pt(pos);
    s += `<line class="cm-b" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x1 + px * 12 + ux * 4)}" y2="${f1(y1 + py * 12 + uy * 4)}"/>`;
    k -= 10; pos += 5;
  }
  if (k >= 5) {
    if (pos === 0) pos = 5;
    const [x1, y1] = pt(pos);
    s += `<line class="cm-b" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x1 + px * 6 + ux * 2)}" y2="${f1(y1 + py * 6 + uy * 2)}"/>`;
  }
  return s;
}

/** WINTEM du club : niveau 0 = FL020 (925 hPa), 1 = FL050 (850 hPa), 2 = FL100 (700 hPa) */
export function wintem(g: Grille, ech: number, niveau: number) {
  let s = fond() + villes();
  for (const p of points(g, ech)) {
    const [d, ff, t] = [p.v[niveau * 3], p.v[niveau * 3 + 1], p.v[niveau * 3 + 2]];
    if (d == null || ff == null || t == null) continue;
    const [x, y] = P(p.lon, p.lat);
    s += barbule(x, y, d, ff);
    const tt = Math.round(t);
    s += `<text class="${tt < 0 ? 'cm-tf' : 'cm-tc'}" x="${f1(x + 6)}" y="${f1(y + 16)}">${tt > 0 ? '+' : ''}${tt}°</text>`;
  }
  return svg(s, `Vent et température ${NIVEAUX[niveau]}`);
}

// Altitude de l'isotherme 0 °C (pieds) à partir des températures à 925, 850 et 700 hPa
function iso0(v: (number | null)[]) {
  const niv: [number, number | null][] = [[2500, v[2]], [5000, v[5]], [10000, v[8]]];
  if (niv.some(([, t]) => t == null)) return null;
  const n = niv as [number, number][];
  if (n[0][1] <= 0) {
    // sous 2500 ft : extrapolation avec le gradient 925-850 hPa
    const g = (n[0][1] - n[1][1]) / 2500;
    const z = g > 0 ? 2500 + n[0][1] / g : 0;
    return z <= 300 ? 'SFC' : `${Math.round(z / 500) * 5}`.padStart(3, '0');
  }
  for (let k = 0; k < 2; k++) {
    const [z1, t1] = n[k], [z2, t2] = n[k + 1];
    if (t1 > 0 && t2 <= 0) return `${Math.round((z1 + ((z2 - z1) * t1) / (t1 - t2)) / 500) * 5}`.padStart(3, '0');
  }
  return '>100';
}

const pluie = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82);
const neige = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;

/** « TEMSI » du club : temps significatif à basse altitude (indicatif) */
export function temsi(g: Grille, ech: number) {
  const { lat0, dlat, nlat, lon0, dlon, nlon } = g.grille;
  const pts = points(g, ech);
  const val = (i: number, j: number, k: number) => pts[Math.min(nlat - 1, Math.max(0, i)) * nlon + Math.min(nlon - 1, Math.max(0, j))].v[k] ?? 0;
  // Sous-grille 4 fois plus fine : nuages bas interpolés, phénomènes au point le plus proche
  const F = 4;
  let nuages = '', pl = '', ne = '', br = '';
  for (let a = -2; a <= (nlat - 1) * F + 2; a++) for (let b = -2; b <= (nlon - 1) * F + 2; b++) {
    const fi = a / F, fj = b / F, i0 = Math.floor(fi), j0 = Math.floor(fj), di = fi - i0, dj = fj - j0;
    const bas = val(i0, j0, 9) * (1 - di) * (1 - dj) + val(i0 + 1, j0, 9) * di * (1 - dj) + val(i0, j0 + 1, 9) * (1 - di) * dj + val(i0 + 1, j0 + 1, 9) * di * dj;
    const pr = val(i0, j0, 13) * (1 - di) * (1 - dj) + val(i0 + 1, j0, 13) * di * (1 - dj) + val(i0, j0 + 1, 13) * (1 - di) * dj + val(i0 + 1, j0 + 1, 13) * di * dj;
    const c = val(Math.round(fi), Math.round(fj), 11);
    const [x1, y1] = P(lon0 + (fj - 0.5 / F) * dlon, lat0 + (fi + 0.5 / F) * dlat);
    const [x2, y2] = P(lon0 + (fj + 0.5 / F) * dlon, lat0 + (fi - 0.5 / F) * dlat);
    const r = `x="${f1(x1)}" y="${f1(y1)}" width="${f1(x2 - x1 + 0.6)}" height="${f1(y2 - y1 + 0.6)}"`;
    if (bas >= 60) nuages += `<rect ${r} opacity="${Math.min(0.6, ((bas - 50) / 50) * 0.6).toFixed(2)}"/>`;
    if (neige(c)) ne += `<rect ${r}/>`;
    else if (pr >= 0.1 || pluie(c)) pl += `<rect ${r}/>`;
    if (c === 45 || c === 48) br += `<rect ${r}/>`;
  }
  let s = fond();
  s += `<g class="cm-nb" filter="url(#cm-flou)">${nuages}</g>`;
  s += `<g fill="url(#cm-pluie)" opacity=".85">${pl}</g><g fill="url(#cm-neige)">${ne}</g><g fill="url(#cm-brume)">${br}</g>`;
  s += villes();
  for (const p of pts) {
    const c = p.v[11] ?? 0, cape = p.v[12] ?? 0;
    if (c >= 95 || cape >= 500) {
      const [x, y] = P(p.lon, p.lat);
      s += `<text class="cm-cb" x="${f1(x)}" y="${f1(y + 5)}" text-anchor="middle">CB</text>`;
    }
  }
  for (const p of pts) {
    if (p.i % 3 !== 1 || p.j % 3 !== 1) continue;
    const z = iso0(p.v);
    if (!z) continue;
    const [x, y] = P(p.lon, p.lat);
    const t = z === 'SFC' ? '0° SFC' : `0° FL${z}`;
    s += `<g class="cm-i0" transform="translate(${f1(x)},${f1(y)})"><rect x="-30" y="-10" width="60" height="19" rx="5" stroke-width="1.2"/><text y="4" text-anchor="middle">${t}</text></g>`;
  }
  return svg(s, 'Temps significatif');
}

export const LEGENDE_TEMSI = `<span class="cm-lg"><i style="background:#7d8799;opacity:.55"></i>Nuages bas</span><span class="cm-lg"><i style="background:repeating-linear-gradient(120deg,#1f9d57 0 2px,transparent 2px 6px)"></i>Pluie</span><span class="cm-lg"><i style="background:repeating-linear-gradient(0deg,#3b6fe0 0 1.5px,transparent 1.5px 5px)"></i>Neige</span><span class="cm-lg"><i style="background:radial-gradient(#d18f00 35%,transparent 40%) 0 0/5px 5px"></i>Brouillard</span><span class="cm-lg"><b style="color:#d6333f">CB</b>Orage</span><span class="cm-lg"><b class="cm-lg-i0">0°</b>Isotherme 0 °C</span>`;

// Carte des fronts du DWD, recadrée sur la France, des îles Britanniques à la Méditerranée
// (fractions de l'image d'origine, qui fait environ 4389 × 3114 px)
const CADRE = { x0: 0.4215, x1: 0.7177, y0: 0.3693, y1: 0.8349 };
export function fronts(adresse: string, t: string | null) {
  const lx = CADRE.x1 - CADRE.x0;
  // translate(%) se rapporte à l'image elle-même : le recadrage ne dépend pas de la taille du cadre
  const style = `width:${f1(100 / lx)}%;transform:translate(${f1(-CADRE.x0 * 100)}%,${f1(-CADRE.y0 * 100)}%)`;
  return `<div class="cm-fronts"><img src="${adresse}?t=${t ?? ''}" alt="Carte des fronts" style="${style}" decoding="async"></div>`;
}

/** « 25/11 00 h UTC » à partir de AAAAMMJJHHMM */
export const heureFronts = (t: string | null) => (t ? `${t.slice(6, 8)}/${t.slice(4, 6)} ${t.slice(8, 10)} h UTC` : '');
/** « 12 h UTC » pour une échéance de la grille */
export const heureEch = (g: Grille, ech: number) => (g.heures[ech] ? `${g.heures[ech].slice(11, 13)} h UTC` : '');

/** Styles communs (à mettre une fois dans la page) */
export const CSS_CARTES = `.cm{display:block;width:100%;height:auto}
.cm-fronts{position:relative;overflow:hidden;aspect-ratio:1300/1450;width:100%;background:#8a97ab}
.cm-fronts img{position:absolute;left:0;top:0;max-width:none;height:auto}
.cm-lg{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.cm-lg i{display:inline-block;width:16px;height:11px;border-radius:2px}
.cm-lg-i0{font-size:11px;color:var(--cm-froid,#1f4fd1);border:1.2px solid currentColor;border-radius:4px;padding:0 3px}`;
