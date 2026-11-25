// Vents en altitude (AROME) et METAR des terrains voisins : rendu partagé par la TV et l'appli membres.
export type Altitude = { heures: string[]; niveaux: { nom: string; dir: number[]; ff: number[]; t: number[] }[] };
export type Voisin = { id: string; nom: string; raw: string; obs?: string };

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function rendreAltitude(a: Altitude) {
  const fleche = (d: number) => `<svg class="fl" viewBox="0 0 24 24" style="transform:rotate(${d}deg)"><path d="M12 3v16M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const h = a.heures.map((t) => `${t.slice(11, 13)} h UTC`);
  let o = `<table class="alt"><tr><th>Niveau</th>${h.map((x) => `<th>${x}</th>`).join('')}</tr>`;
  for (const n of a.niveaux) o += `<tr><td>${esc(n.nom)}</td>${n.dir.map((d, i) => `<td>${fleche(d)}${String(Math.round(d / 10) * 10).padStart(3, '0')}/${Math.round(n.ff[i])} <span class="t">${n.t[i] > 0 ? '+' : ''}${Math.round(n.t[i])}°</span></td>`).join('')}</tr>`;
  return o + '</table>';
}

// Catégorie de vol à partir du METAR brut : visibilité et plafond (BKN/OVC/VV)
export function categorie(raw: string) {
  const cavok = /\bCAVOK\b/.test(raw);
  const v = cavok ? 9999 : Number(raw.match(/\s(\d{4})(?:NDV)?\s/)?.[1] ?? 9999);
  const pl = [...raw.matchAll(/\b(?:BKN|OVC|VV)(\d{3})/g)].map((m) => Number(m[1]) * 100);
  const c = pl.length ? Math.min(...pl) : 99999;
  return c < 500 || v < 1500 ? 'LIFR' : c < 1000 || v < 5000 ? 'IFR' : c <= 3000 || v <= 8000 ? 'MVFR' : 'VFR';
}

export const legendeVoisins = () => ['VFR', 'MVFR', 'IFR', 'LIFR'].map((c) => `<span class="lgc ${c}"><i></i>${c}</span>`).join('');

export const rendreVoisins = (l: Voisin[]) => l.map((m) => {
  const r = m.raw.replace(/^(METAR|SPECI)\s+/, '');
  const [id, ...reste] = r.split(' ');
  return `<div class="mv ${categorie(r)}"><b>${esc(id)}</b><span class="nm">${esc(m.nom)}</span><br><span class="mr">${esc(reste.join(' '))}</span></div>`;
}).join('');
