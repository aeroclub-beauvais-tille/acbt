// Ferme la session de l'espace membre sur cet appareil (et l'efface de la base).
import { effacerCookie } from '../_session.js';
import { fermerSession } from '../_comptes.js';

export async function onRequestPost({ request, env }) {
  await fermerSession(env, request);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': effacerCookie() },
  });
}
