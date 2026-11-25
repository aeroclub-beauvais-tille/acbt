// Vents en altitude au-dessus de LFOB (modèle AROME) et METAR des terrains voisins pour l'onglet Météo de l'appli membres.
// Mêmes sources que le tableau de bord TV ; gardé 10 min en cache chez Cloudflare.
import { lireAltitude, lireVoisins } from '../../dashboard/api/donnees.js';
import { json } from '../../_maa.js';

const CACHE_CLE = 'https://cache.acbt60.local/membre/api/aero';
// Terrains voisins montrés dans l'appli (choix du club : pas Évreux ni les terrains parisiens)
const VOISINS_APPLI = ['LFAQ', 'LFAT', 'LFOP', 'LFPT'];

export async function onRequestGet({ waitUntil }) {
  const cache = globalThis.caches?.default;
  if (cache) {
    const deja = await cache.match(new Request(CACHE_CLE));
    if (deja) return json(await deja.json());
  }
  const [altitude, voisins] = await Promise.all([lireAltitude().catch(() => null), lireVoisins().catch(() => null)]);
  const corps = { ok: Boolean(altitude || voisins), altitude, voisins: voisins ? voisins.filter((v) => VOISINS_APPLI.includes(v.id)) : null };
  if (cache && corps.ok) waitUntil?.(cache.put(new Request(CACHE_CLE), new Response(JSON.stringify(corps), { headers: { 'Cache-Control': 'public, max-age=600' } })));
  return json(corps, corps.ok ? 200 : 503);
}
