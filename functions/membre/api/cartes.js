// Cartes météo de l'onglet Météo de l'appli membres : grille Météo-France (WINTEM et temps significatif du club)
// et heure de la dernière carte des fronts du DWD. Mêmes données que la TV (functions/_cartes.js).
import { lireCartes } from '../../_cartes.js';
import { json } from '../../_maa.js';

export async function onRequestGet({ waitUntil }) {
  try {
    const c = await lireCartes(globalThis.caches?.default, waitUntil);
    return json({ ok: Boolean(c.grille || c.fronts), ...c }, 200);
  } catch {
    return json({ ok: false }, 502);
  }
}
