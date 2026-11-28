// Programme e-mail de l'aéroclub (Cloudflare Email Worker « acbt-maa-mail »).
// Quand un mail arrive sur meteo@acbt60.fr :
//   1. une copie part dans la boîte du club (acbt60@gmail.com) ;
//   2. le mail entier est transmis au site (https://acbt60.fr/api/maa), qui lit chaque PDF MAA joint
//      et l'affiche dans l'espace membre et sur la TV.
// Réglage nécessaire dans le Worker : variable secrète MAA_CLE (la même que dans le projet Pages acbt60).
// Ce fichier se colle tel quel dans Cloudflare > Workers > acbt-maa-mail > Modifier le code.
//
// Il lance aussi la copie des actus Facebook (tâche GitHub facebook.yml) à 9h, 13h, 16h, 19h et 23h,
// heure de Paris : GitHub saute la plupart de ses propres lancements planifiés, Cloudflare est ponctuel.
// Réglages : déclencheur Cron « 0 * * * * » (toutes les heures pile, le programme ne garde
// que les bonnes heures de Paris, été comme hiver) et variable secrète GITHUB_CLE (clé GitHub sans
// expiration, droit Actions : lecture et écriture sur le dépôt acbt).

const SITE = 'https://acbt60.fr/api/maa';
const COPIE = 'acbt60@gmail.com';
const DEPOT = 'aeroclub-beauvais-tille/acbt';
const HEURES_FACEBOOK = [9, 13, 16, 19, 23];

async function lancerFacebook(env) {
  const rep = await fetch(`https://api.github.com/repos/${DEPOT}/actions/workflows/facebook.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_CLE}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'acbt60-cloudflare',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  // 204 = copie lancée ; 401/403 = clé GitHub refusée (à refaire)
  console.log(`Copie Facebook : ${rep.status} ${rep.status === 204 ? 'lancée' : await rep.text()}`);
}

export default {
  async email(message, env, ctx) {
    const brut = await new Response(message.raw).arrayBuffer();
    try { await message.forward(COPIE); } catch (e) { console.log('Copie Gmail impossible :', e.message); }
    const rep = await fetch(SITE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.MAA_CLE}`, 'Content-Type': 'message/rfc822' },
      body: brut,
    });
    console.log(`MAA de ${message.from} : ${rep.status} ${await rep.text()}`);
  },

  async scheduled(event, env, ctx) {
    const heure = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date(event.scheduledTime)));
    if (!HEURES_FACEBOOK.includes(heure)) return;
    if (!env.GITHUB_CLE) { console.log('GITHUB_CLE absente : copie Facebook non lancée.'); return; }
    ctx.waitUntil(lancerFacebook(env));
  },
};
