// Garde de l'espace membre sur Cloudflare Pages : /membre/ et /uploads/membre/ ne s'ouvrent qu'avec le cookie de session.
// L'écran de connexion, l'icône et la fiche de l'appli restent accessibles à tous.
import { egal, jetonDash, lireCookieDash, motDePasseDash } from './_session.js';
import { session } from './_comptes.js';
import { aCompter, compter } from './_visites.js';

const LIBRES = ['/membre/connexion', '/membre/mot-de-passe', '/membre/manifest.webmanifest'];

// Chaque page vue par un vrai navigateur est comptée (voir _visites.js), sans ralentir la réponse.
export async function onRequest(context) {
  const rep = await garde(context);
  try {
    const url = new URL(context.request.url);
    if (aCompter(context.request, rep, url)) context.waitUntil(compter(context.request, context.env, url));
  } catch { /* jamais bloquant */ }
  return rep;
}

async function garde({ request, env, next, waitUntil }) {
  const { pathname, search } = new URL(request.url);
  // Tableau de bord TV : son propre mot de passe et son propre cookie
  if ((pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && !pathname.startsWith('/dashboard/connexion')) {
    if (egal(lireCookieDash(request), await jetonDash(motDePasseDash(env)))) {
      const rep = await next();
      const r = new Response(rep.body, rep);
      if (!r.headers.has('Cache-Control') || !pathname.startsWith('/dashboard/api/')) r.headers.set('Cache-Control', 'private, no-cache');
      r.headers.set('X-Robots-Tag', 'noindex');
      return r;
    }
    if (pathname.startsWith('/dashboard/api/')) return new Response('{"ok":false}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    return Response.redirect(new URL(`/dashboard/connexion/?retour=${encodeURIComponent(pathname + search)}`, request.url).href, 302);
  }
  const protege = (pathname === '/membre' || pathname.startsWith('/membre/') || pathname.startsWith('/uploads/membre/'))
    && !LIBRES.some((p) => pathname.startsWith(p));
  if (!protege) return next();

  if (!env.MOT_DE_PASSE_MEMBRES && !env.DB) {
    return new Response("Espace membre fermé : ni mot de passe du club (MOT_DE_PASSE_MEMBRES) ni base de comptes (DB) dans Cloudflare.", { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  // Compte personnel, mot de passe commun du club (tant qu'il est accepté) ou mot de passe admin
  if (await session(request, env, waitUntil)) {
    const rep = await next();
    const r = new Response(rep.body, rep);
    r.headers.set('Cache-Control', 'private, no-cache');
    r.headers.set('X-Robots-Tag', 'noindex');
    return r;
  }
  if (pathname.startsWith('/membre/api/')) return new Response('{"ok":false,"erreur":"Session terminée : reconnectez-vous."}', { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  // fin=1 : l'appli oublie qu'elle était connectée (compte désactivé, mot de passe changé…), sinon elle tournerait en rond
  const retour = encodeURIComponent(pathname + search);
  return Response.redirect(new URL(`/membre/connexion/?retour=${retour}&fin=1`, request.url).href, 302);
}
