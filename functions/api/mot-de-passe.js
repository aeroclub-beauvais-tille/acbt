// Mot de passe oublié et choix du mot de passe (lien reçu par mail), sans être connecté.
//   POST { action: 'oublie', identifiant }        → (identifiant ou e-mail) envoie un lien de réinitialisation (réponse identique que l'adresse existe ou non)
//   POST { action: 'verifier', jeton }            → { ok, prenom, email, type } si le lien est encore valable
//   POST { action: 'choisir', jeton, motDePasse } → enregistre le mot de passe, déconnecte les autres appareils, ouvre la session ici
import { poserCookie } from '../_session.js';
import { json } from '../_alertes.js';
import { tablesComptes, chercherMembre, envoyerLien, lireLien, nouveauHash, mdpAcceptable, ouvrirSession, maintenant, mailPret, creerCleAdmin, MDP_REGLE, noterPassage } from '../_comptes.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d = null;
  try { d = await request.json(); } catch { /* illisible */ }
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  await tablesComptes(env.DB);

  if (d.action === 'oublie') {
    if (!String(d.identifiant || '').trim()) return json({ ok: false, erreur: 'Indiquez votre identifiant ou votre adresse e-mail.' }, 400);
    if (!mailPret(env)) return json({ ok: false, erreur: 'L\'envoi des mails n\'est pas encore en service. Demandez un nouveau mot de passe à un responsable du club.' }, 503);
    const m = await chercherMembre(env.DB, d.identifiant, 'id, prenom, email, identifiant, actif');
    if (m && m.actif === 1) {
      // Pas plus d'un mail toutes les 2 minutes pour la même adresse
      const recent = await env.DB.prepare('SELECT 1 FROM liens WHERE membre = ?1 AND cree > ?2').bind(m.id, new Date(Date.now() - 120e3).toISOString()).first();
      if (!recent) await envoyerLien(request, env, m, 'reinit');
    } else {
      await new Promise((r) => setTimeout(r, 400));
    }
    return json({ ok: true });
  }

  const l = await lireLien(env, d.jeton);
  if (!l) return json({ ok: false, erreur: 'Ce lien n\'est plus valable. Demandez-en un nouveau depuis l\'écran de connexion (« Mot de passe oublié ? »).' }, 410);

  if (d.action === 'verifier') return json({ ok: true, prenom: l.prenom || '', email: l.email, identifiant: l.identifiant || '', type: l.type });

  if (d.action === 'choisir') {
    if (!mdpAcceptable(d.motDePasse)) return json({ ok: false, erreur: MDP_REGLE }, 400);
    const { sel, hash } = await nouveauHash(d.motDePasse);
    await env.DB.batch([
      env.DB.prepare('UPDATE membres SET hash = ?1, sel = ?2, maj = ?3 WHERE id = ?4').bind(hash, sel, maintenant(), l.id),
      env.DB.prepare('DELETE FROM sessions WHERE membre = ?1').bind(l.id),
      env.DB.prepare('DELETE FROM liens WHERE membre = ?1').bind(l.id),
      env.DB.prepare('DELETE FROM cles_admin WHERE membre = ?1').bind(l.id),
    ]);
    await noterPassage(env.DB, l.id);
    const cookie = poserCookie(await ouvrirSession(env, l.id));
    const cleAdmin = l.role === 'admin' ? await creerCleAdmin(env, l.id) : '';
    return new Response(JSON.stringify({ ok: true, email: l.email, identifiant: l.identifiant || '', prenom: l.prenom || '', nom: l.nom || '', cleAdmin }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookie },
    });
  }
  return json({ ok: false, erreur: 'Action inconnue.' }, 400);
}
