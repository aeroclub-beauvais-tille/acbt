// Documents des avions déposés depuis l'appli (onglet Admin > Documents des avions), rangés dans la base D1 du site.
// Aucun service en plus : le fichier est découpé en morceaux de 1 Mo (limite d'une ligne D1), recollés à la lecture.
// Les fichiers restent privés : /membre/ n'est servi qu'avec le cookie des membres (voir _middleware.js).
//   docs           : une ligne par document (avion, type, titre, dates de validité, nom du fichier, archive)
//   docs_morceaux  : le contenu du fichier, par morceaux
export const MORCEAU = 1_000_000;

// Documents nécessaires au vol : chacun prend une place de la liste de la fiche avion (le nouveau remplace l'ancien).
export const TYPES_VOL = [
  "Certificat d'immatriculation",
  'Certificat de navigabilité (CDN)',
  "Certificat d'examen de navigabilité (CEN)",
  'Licence station radio',
  'Certificat acoustique',
  'Assurance',
  'Fiche de pesée et centrage',
  'Manuel de vol',
  'Autre document de vol',
];
// Manuels du matériel : ajoutés à la colonne « Manuels du matériel », ils ne remplacent rien.
export const TYPES_MANUEL = ['Manuel', 'Guide', 'Mémo', 'Checklist'];

export async function tableDocs(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY, avion TEXT NOT NULL, type TEXT NOT NULL, colonne TEXT NOT NULL, titre TEXT NOT NULL,
      debut TEXT, fin TEXT, fichier TEXT NOT NULL, mime TEXT, taille INTEGER, morceaux INTEGER NOT NULL,
      cree TEXT NOT NULL, archive TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS docs_morceaux (doc TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (doc, n))'),
  ]);
}

/** Nom affiché et nom du fichier : « F-GCAL - Certificat d'immatriculation », « F-GCAL - Guide - Radio GNC 255 ». */
export function nommer(avion, type, titre) {
  const t = String(titre || '').trim();
  if (TYPES_MANUEL.includes(type)) return t ? `${type} - ${t}` : type;
  if (type === 'Autre document de vol') return `${avion} - ${t || 'Document'}`;
  return `${avion} - ${type}`;
}
