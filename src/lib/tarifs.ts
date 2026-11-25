// Tarifs affichés sur le site : ceux de tarifs.json (back-office) et des fiches avions,
// complétés par les changements programmés par l'admin dans l'appli (onglet Admin > Tarifs).
// Ces changements vivent sur Cloudflare (base D1, /api/tarifs) ; tarifs-planifies.json en est la copie
// faite juste avant chaque publication (scripts/tarifs-planifies.mjs). Le site se republie chaque nuit,
// et dans le quart d'heure qui suit une modification de l'admin : un nouveau prix s'affiche donc le jour prévu.
import base from '../data/tarifs.json';
import planifies from '../data/tarifs-planifies.json';

export type Changement = { id: string; cible: string; prix: number; prix2?: number | null; a_partir_du: string; note?: string | null };
const changements = (planifies.changements || []) as Changement[];
// Date du jour à Beauvais (AAAA-MM-JJ) au moment de la publication
const aujourdhui = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

/** Clé d'une ligne de prix d'une formule (vol découverte, initiation…) : « formule:<titre>|<libellé> ». */
export const cleFormule = (titre: string, libelle: string) => `formule:${titre}|${libelle}`;

/** Dernier changement entré en vigueur pour cette clé (ou rien). */
function enVigueur(cible: string) {
  return changements.filter((c) => c.cible === cible && c.a_partir_du <= aujourdhui).sort((a, b) => a.a_partir_du.localeCompare(b.a_partir_du)).pop();
}

/** tarifs.json avec les prix des formules à jour. */
export const tarifs = {
  ...base,
  formules: base.formules.map((f) => ({
    ...f,
    prix: f.prix.map((p) => ({ ...p, prix: enVigueur(cleFormule(f.titre, p.libelle))?.prix ?? p.prix })),
  })),
};

type Tarif = { a_partir_du: Date; prix_heure: number; prix_instruction?: number; note?: string };
/** Tarifs d'un avion : ceux de sa fiche + ceux programmés dans l'appli (même forme, datés). */
export function tarifsAvion(im: string | undefined, fiche: Tarif[]): Tarif[] {
  if (!im) return fiche;
  const ajout = changements.filter((c) => c.cible === `avion:${im}`).map((c) => ({
    a_partir_du: new Date(`${c.a_partir_du}T00:00:00+01:00`),
    prix_heure: c.prix,
    prix_instruction: c.prix2 ?? undefined,
    note: c.note ?? undefined,
  }));
  return [...fiche, ...ajout];
}
