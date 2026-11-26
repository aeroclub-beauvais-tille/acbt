// Documents généraux du club (onglet Préparer), modifiés depuis l'appli (Admin > Documents du club).
// Rangés dans la base D1 du site, sans autre service. Fichiers découpés en morceaux de 1 Mo (comme _docs.js).
//   docs_club           : une ligne par version d'un document (clé, rubrique, titre, description, fichier ou lien, état)
//   docs_club_morceaux  : contenu des fichiers déposés
// Les états et la façon dont l'appli les affiche sont décrits dans src/lib/docs-club.ts.
export { MORCEAU } from './_docs.js';

export const RUBRIQUES = ['terrain', 'avant', 'pdv', 'securite', 'licence'];

export async function tableDocsClub(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS docs_club (
      id TEXT PRIMARY KEY, cle TEXT NOT NULL, rubrique TEXT NOT NULL, titre TEXT NOT NULL, descr TEXT, lien TEXT,
      fichier TEXT, mime TEXT, taille INTEGER, morceaux INTEGER NOT NULL DEFAULT 0, donnees TEXT,
      cree TEXT NOT NULL, change TEXT, etat TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS docs_club_cle ON docs_club (cle)'),
    db.prepare('CREATE TABLE IF NOT EXISTS docs_club_morceaux (doc TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (doc, n))'),
  ]);
}
