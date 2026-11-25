// Cartes météo du club, à la place de la WINTEM d'Aéroweb (la TEMSI n'a pas d'équivalent libre) (Météo-France n'ouvre plus son API).
// 1. Grille de prévision sur le nord de la France (Open-Meteo, modèles Météo-France AROME/ARPEGE, licence CC BY 4.0) :
//    vent et température à 925, 850 et 700 hPa (≈ FL020, FL050, FL100).
//    Le dessin (WINTEM du club) est fait dans le navigateur : src/lib/cartes.ts.
// 2. Carte des fronts du service météo allemand (DWD, données ouvertes, sans inscription), analyse toutes les 6 h.
// Grille gardée 1 h en cache, liste DWD 20 min, image des fronts 6 h.

export const GRILLE = { lat0: 45.9, dlat: 0.7, nlat: 9, lon0: -1.95, dlon: 0.9, nlon: 8 };
const ECHEANCES = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // heures après l'heure ronde en cours (animation heure par heure)
const NIVEAUX = [925, 850, 700];
const CHAMPS = NIVEAUX.flatMap((p) => [`wind_direction_${p}hPa`, `wind_speed_${p}hPa`, `temperature_${p}hPa`]);
const DWD = 'https://opendata.dwd.de/weather/charts/analysis/';
const DWD_DERNIERE = `${DWD}Z__C_EDZW_LATEST_tka01%2Cana_bwkman_dwdna_O_000000_000000_LATEST_WV12.png`;

async function enCache(cache, waitUntil, cle, duree, lire) {
  const req = new Request(`https://cache.acbt60.local/cartes/${cle}`);
  if (cache) {
    const deja = await cache.match(req);
    if (deja) return deja.json();
  }
  const v = await lire();
  if (v && cache) waitUntil?.(cache.put(req, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${duree}` } })));
  return v;
}

export async function lireGrille(cache, waitUntil) {
  const heure = new Date().toISOString().slice(0, 13);
  return enCache(cache, waitUntil, `grille3-${heure}`, 3600, async () => {
    const la = [], lo = [];
    for (let i = 0; i < GRILLE.nlat; i++) for (let j = 0; j < GRILLE.nlon; j++) {
      la.push((GRILLE.lat0 + i * GRILLE.dlat).toFixed(3));
      lo.push((GRILLE.lon0 + j * GRILLE.dlon).toFixed(3));
    }
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=${CHAMPS.join(',')}&wind_speed_unit=kn&forecast_hours=${ECHEANCES.at(-1) + 1}&models=meteofrance_seamless&timezone=GMT`, { headers: { 'User-Agent': 'ACBT-tableau-de-bord/1.0' } });
    if (!r.ok) return null;
    const l = await r.json();
    if (!Array.isArray(l) || l.length !== la.length || !l[0]?.hourly?.time?.length) return null;
    const t = l[0].hourly.time;
    const ech = ECHEANCES.filter((i) => i < t.length);
    const arrondi = (x) => (x == null ? null : Math.round(x * 10) / 10);
    return {
      grille: GRILLE,
      heures: ech.map((i) => `${t[i]}Z`),
      // v[échéance][point] = [dir925, ff925, t925, dir850, ff850, t850, dir700, ff700, t700]
      v: ech.map((i) => l.map((p) => CHAMPS.map((c) => arrondi(p.hourly[c]?.[i])))),
    };
  });
}

// Heure de la dernière analyse des fronts publiée par le DWD (AAAAMMJJHHMM), lue dans la liste du dossier
export async function heureFronts(cache, waitUntil) {
  return enCache(cache, waitUntil, `fronts-${new Date().toISOString().slice(0, 15)}`, 1200, async () => {
    const r = await fetch(DWD);
    if (!r.ok) return null;
    const l = [...(await r.text()).matchAll(/ana_bwkman_dwdna_O_000000_000000_(\d{12})_WV12\.png/g)].map((m) => m[1]).sort();
    return l.length ? { t: l.at(-1) } : null;
  }).then((x) => x?.t ?? null);
}

export async function lireCartes(cache, waitUntil) {
  const [grille, fronts] = await Promise.all([lireGrille(cache, waitUntil).catch(() => null), heureFronts(cache, waitUntil).catch(() => null)]);
  return { grille, fronts };
}

// Image des fronts (PNG du DWD, ~5 Mo), relayée et gardée 6 h en cache ; ?t= sert seulement à changer d'adresse à chaque analyse
export async function imageFronts(request, waitUntil) {
  const cache = globalThis.caches?.default;
  const t = (new URL(request.url).searchParams.get('t') || '').replace(/\D/g, '').slice(0, 12);
  const req = new Request(`https://cache.acbt60.local/cartes/fronts-${t || 'dernier'}.png`);
  if (cache) {
    const deja = await cache.match(req);
    if (deja) return deja;
  }
  const r = await fetch(DWD_DERNIERE);
  if (!r.ok) return new Response('Carte indisponible', { status: 502 });
  const rep = new Response(r.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': `${t ? 'public, max-age=86400' : 'public, max-age=1800'}` } });
  if (cache) waitUntil?.(cache.put(req, rep.clone()));
  return rep;
}
