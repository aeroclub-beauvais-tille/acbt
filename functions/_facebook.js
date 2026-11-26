// État de la copie des actus Facebook, rangé dans la base D1 du site (liaison DB).
// Après chaque passage, la tâche GitHub (.github/workflows/facebook.yml) envoie son résultat à
// /api/facebook-etat. Aucun mot de passe ni jeton à gérer : GitHub signe l'envoi (jeton OIDC de
// GitHub Actions, valable quelques minutes), et le site vérifie la signature et le dépôt d'origine.

export async function tableFacebook(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS facebook_passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, ok INTEGER NOT NULL,
    ajoutees INTEGER NOT NULL DEFAULT 0, manuel INTEGER NOT NULL DEFAULT 0,
    total INTEGER, derniere_actu TEXT, lien TEXT)`).run();
}

const DEPOT = 'aeroclub-beauvais-tille/acbt';
const EMETTEUR = 'https://token.actions.githubusercontent.com';
export const AUDIENCE = 'acbt60-facebook';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Vérifie que le jeton vient bien de la tâche Facebook du dépôt du club. Renvoie ses informations, ou null. */
export async function verifierGithub(jeton) {
  const [h, p, s] = String(jeton || '').split('.');
  if (!h || !p || !s) return null;
  let entete, infos;
  try { entete = JSON.parse(new TextDecoder().decode(b64(h))); infos = JSON.parse(new TextDecoder().decode(b64(p))); } catch { return null; }
  if (entete.alg !== 'RS256') return null;
  const cles = await fetch(`${EMETTEUR}/.well-known/jwks`, { cf: { cacheTtl: 3600 } }).then((r) => r.json()).catch(() => null);
  const jwk = cles?.keys?.find((k) => k.kid === entete.kid);
  if (!jwk) return null;
  const cle = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const bon = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cle, b64(s), new TextEncoder().encode(`${h}.${p}`));
  const maintenant = Date.now() / 1000;
  if (!bon || infos.iss !== EMETTEUR || infos.aud !== AUDIENCE || !(infos.exp > maintenant) || !(infos.nbf <= maintenant + 60)) return null;
  if (infos.repository !== DEPOT || !String(infos.workflow_ref || '').startsWith(`${DEPOT}/.github/workflows/facebook.yml@`)) return null;
  return infos;
}
