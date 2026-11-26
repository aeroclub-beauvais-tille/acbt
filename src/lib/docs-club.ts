// Documents généraux du club (onglet Préparer de l'espace membre).
// Base : les documents publiés avec le site (src/content/documents), rangés ici en 5 rubriques.
// Par-dessus : les changements faits par l'admin depuis l'appli (Admin > Documents du club), gardés dans la base D1
// (voir functions/membre/api/documents-club.js). Chaque document a une « clé » : l'identifiant du document du site,
// ou un identifiant neuf pour un document ajouté depuis l'appli. Une clé peut avoir plusieurs versions :
//   actif   : la version affichée
//   ancien  : une version remplacée (historique)
//   retire  : document supprimé par l'admin (historique, peut être remis en ligne)
//   efface  : effacé définitivement (rien n'est affiché)
// Ce fichier est utilisé au build (rangement de la base) et dans le navigateur (fusion et affichage).

export const RUBRIQUES_CLUB = [
  { id: 'terrain', nom: 'Terrain de Beauvais', svg: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  { id: 'avant', nom: 'Avant le vol', svg: 'M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20' },
  { id: 'pdv', nom: 'Plan de vol', svg: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 11h6M9 15h4' },
  { id: 'securite', nom: 'Sécurité', svg: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3zM9 12l2 2 4-4' },
  { id: 'licence', nom: 'Licence et règles', svg: 'M4 5h16v14H4zM8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M7 16c.6-1.4 1.8-2 3-2s2.4.6 3 2M15 9h3M15 13h3' },
] as const;
export type RubriqueClub = (typeof RUBRIQUES_CLUB)[number]['id'];

// Rangement des documents du site (identifiant du fichier → rubrique)
const RANGEMENT: Record<string, RubriqueClub> = {
  'espace-aerien-de-beauvais': 'terrain',
  'le-tour-de-piste-basse-hauteur-a-lfob': 'terrain',
  'zone-aeroplaisance': 'terrain',
  'fiche-icarus-beauvais': 'terrain',
  'procedures-radio-sur-terrain-controle': 'terrain',
  'les-papiers-pour-le-vol-le-minimum-exigible': 'avant',
  'emport-carburant-acbt-2017': 'avant',
  'complements-carte-vfr': 'avant',
  'memo-pilote-vfr': 'avant',
  'guide-meteo-france': 'avant',
  'formulaire-pdv': 'pdv',
  'mode-emploi-pdv': 'pdv',
  'memo-securite': 'securite',
  'memo-emport-pax': 'securite',
  'prorogation-et-renouvellement': 'licence',
  'regles-pratiques-ffa': 'licence',
  'fiches-pratiques-ffa': 'licence',
};
// Catégories du site montrées dans Préparer, et leur rubrique par défaut (document du site pas listé ci-dessus)
const PAR_CATEGORIE: Record<string, RubriqueClub> = {
  'Documentation pilote': 'avant', 'Préparation des vols': 'avant', 'Météo': 'avant', 'Formulaires': 'pdv', 'Sécurité': 'securite',
};

export type BaseClub = { cle: string; rubrique: RubriqueClub; titre: string; descr: string; lien: string };
export type LigneClub = {
  id: string; cle: string; rubrique: string; titre: string; descr: string | null; lien: string | null;
  fichier: string | null; mime: string | null; taille: number | null; donnees: string | null;
  cree: string; change: string | null; etat: 'actif' | 'ancien' | 'retire' | 'efface';
};
export type DocClub = { cle: string; rubrique: string; titre: string; descr: string; href: string; genre: string; site: boolean; ligne?: LigneClub };

/** Documents du site à afficher dans Préparer (au build). */
export function baseClub(docs: { id: string; titre?: string; categorie: string; fichier?: string; lien?: string; description?: string; archive?: boolean; type?: string }[], lienDe: (d: { fichier?: string; lien?: string }) => string): BaseClub[] {
  return docs
    .filter((d) => !d.archive && !d.type && (RANGEMENT[d.id] || PAR_CATEGORIE[d.categorie]) && (d.fichier || d.lien))
    .map((d) => ({ cle: d.id, rubrique: RANGEMENT[d.id] || PAR_CATEGORIE[d.categorie], titre: d.titre || d.id, descr: d.description || '', lien: lienDe(d) }));
}

/** PDF, LIEN, PHOTO… d'après le nom du fichier ou l'adresse. */
export function genre(nom: string, mime?: string | null): string {
  const n = (nom || '').split('?')[0].toLowerCase();
  const ext = n.includes('.') ? n.split('.').pop()! : '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'PDF';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'XLS';
  if (['doc', 'docx', 'odt'].includes(ext)) return 'DOC';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext) || mime?.startsWith('image/')) return 'PHOTO';
  if (['mp4', 'mov', 'webm'].includes(ext) || mime?.startsWith('video/') || /youtu|vimeo/.test(n)) return 'VIDÉO';
  if (/^https?:/.test(n)) return 'LIEN';
  return 'PDF';
}

/** Base du site + changements de l'admin → documents affichés (rangés) et historique. */
export function fusion(base: BaseClub[], lignes: LigneClub[], api: string) {
  const parCle = new Map<string, LigneClub[]>();
  for (const l of lignes) parCle.set(l.cle, [...(parCle.get(l.cle) || []), l]);
  const docs: DocClub[] = [];
  const deLigne = (l: LigneClub, site: boolean): DocClub => {
    const href = l.donnees ? `${api}/${l.donnees}` : l.lien || '';
    return { cle: l.cle, rubrique: l.rubrique, titre: l.titre, descr: l.descr || '', href, genre: l.donnees ? genre(l.fichier || '', l.mime) : genre(l.lien || ''), site, ligne: l };
  };
  const cles = new Set(base.map((b) => b.cle));
  for (const b of base) {
    const ls = parCle.get(b.cle);
    if (!ls) docs.push({ cle: b.cle, rubrique: b.rubrique, titre: b.titre, descr: b.descr, href: b.lien, genre: genre(b.lien), site: true });
    else { const a = ls.find((l) => l.etat === 'actif'); if (a) docs.push(deLigne(a, true)); }
  }
  for (const [cle, ls] of parCle) {
    if (cles.has(cle)) continue;
    const a = ls.find((l) => l.etat === 'actif');
    if (a) docs.push(deLigne(a, false));
  }
  docs.sort((p, q) => p.titre.localeCompare(q.titre, 'fr', { sensitivity: 'base' }));
  const historique = lignes.filter((l) => l.etat === 'ancien' || l.etat === 'retire')
    .sort((p, q) => (q.change || q.cree).localeCompare(p.change || p.cree))
    .map((l) => deLigne(l, cles.has(l.cle)));
  return { docs, historique };
}
