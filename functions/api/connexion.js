// Écran de connexion de l'espace membre.
//   GET  → { comptes, mdpCommun } : l'écran sait s'il doit encore parler du mot de passe commun du club
//   POST { identifiant?, motDePasse } :
//     - identifiant (nom d'utilisateur ou adresse e-mail) + mot de passe personnel → compte du membre ;
//     - sans identifiant : mot de passe admin (fait apparaître l'onglet Admin sur l'appareil)
//       ou mot de passe commun du club, tant que l'admin ne l'a pas coupé.
// La session est rangée dans la base (cookie valable un an) : désactiver un membre le déconnecte partout.
import { jeton, poserCookie, egal } from '../_session.js';
import { estAdmin } from '../_alertes.js';
import { tablesComptes, mdpCommunActif, ouvrirSession, hacher, chercherMembre, noterPassage, creerCleAdmin } from '../_comptes.js';

const json = (corps, status = 200, cookie) => new Response(JSON.stringify(corps), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
});
const freiner = () => new Promise((r) => setTimeout(r, 800)); // freine les essais en série

export async function onRequestGet({ env }) {
  let comptes = false;
  if (env.DB) {
    try { await tablesComptes(env.DB); comptes = !!(await env.DB.prepare('SELECT 1 FROM membres LIMIT 1').first()); } catch { /* base indisponible */ }
  }
  return json({ ok: true, comptes, mdpCommun: await mdpCommunActif(env) });
}

export async function onRequestPost({ request, env }) {
  if (!env.MOT_DE_PASSE_MEMBRES && !env.DB) return json({ ok: false, raison: 'mot de passe non réglé' }, 503);
  let identifiant = '', motDePasse = '';
  try { ({ identifiant = '', motDePasse = '' } = await request.json()); } catch { /* formulaire vide */ }
  motDePasse = String(motDePasse);
  const saisie = String(identifiant || '').trim();
  if (env.DB) await tablesComptes(env.DB);

  // Sans base (cas de secours) : l'ancien fonctionnement, cookie = empreinte du mot de passe commun
  const ouvrir = async (membre) => (env.DB ? ouvrirSession(env, membre) : jeton(env.MOT_DE_PASSE_MEMBRES));

  if (saisie) {
    if (!env.DB) return json({ ok: false }, 401);
    const m = await chercherMembre(env.DB, saisie, 'id, prenom, nom, hash, sel, actif, role');
    const bon = m && m.hash && m.sel && egal(await hacher(motDePasse, m.sel), m.hash);
    if (!bon) { await freiner(); return json({ ok: false }, 401); }
    if (m.actif !== 1) return json({ ok: false, desactive: true }, 403);
    await noterPassage(env.DB, m.id);
    // Compte « Administrateur » : l'onglet Admin apparaît, avec une clé propre au compte à la place du mot de passe admin
    const admin = m.role === 'admin' ? { admin: true, cleAdmin: await creerCleAdmin(env, m.id) } : {};
    return json({ ok: true, prenom: m.prenom || '', nom: m.nom || '', ...admin }, 200, poserCookie(await ouvrir(m.id)));
  }
  // Le mot de passe admin ouvre aussi l'espace membre, et fait apparaître l'onglet Admin sur l'appareil
  if (await estAdmin(env, motDePasse)) {
    if (!env.DB && !env.MOT_DE_PASSE_MEMBRES) return json({ ok: false }, 503);
    return json({ ok: true, admin: true }, 200, poserCookie(await ouvrir('admin')));
  }
  if (await mdpCommunActif(env)) {
    if (egal(await jeton(motDePasse), await jeton(env.MOT_DE_PASSE_MEMBRES))) return json({ ok: true, club: true }, 200, poserCookie(await ouvrir('club')));
  }
  await freiner();
  return json({ ok: false, identifiantRequis: !(await mdpCommunActif(env)) }, 401);
}
