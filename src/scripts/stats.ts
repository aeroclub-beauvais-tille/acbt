// Statistiques du site public : ce que font les visiteurs (clics sur Réserver, appels, mails, liens sortants,
// documents, formulaire envoyé) et le temps passé sur chaque page. Sans cookies : rien n'est gardé dans le navigateur.
// Les visites elles-mêmes sont comptées côté serveur (functions/_visites.js) ; tout est lu sur /statistiques/.

type Stat = (e: string, d?: string, n?: number) => void;
declare global { interface Window { acbtStat?: Stat } }

const API = '/api/evenement';
const envoyer: Stat = (e, d = '', n) => {
  try {
    const corps = JSON.stringify({ e, d: String(d).slice(0, 80), n, p: location.pathname });
    if (!navigator.sendBeacon?.(API, corps)) fetch(API, { method: 'POST', body: corps, keepalive: true }).catch(() => {});
  } catch { /* jamais bloquant */ }
};
window.acbtStat = envoyer;

document.addEventListener('click', (ev) => {
  const a = (ev.target as HTMLElement | null)?.closest?.('a');
  if (!a) return;
  const h = a.getAttribute('href') || '';
  if (h.startsWith('tel:')) return envoyer('appel');
  if (h.startsWith('mailto:')) return envoyer('mail');
  let u: URL;
  try { u = new URL(a.href, location.href); } catch { return; }
  if (u.origin === location.origin) {
    if (/^\/contact\/?$/.test(u.pathname)) return envoyer('clic-contact', u.searchParams.get('objet') || 'Contact');
    if (/\.(pdf|docx?|xlsx?)$/i.test(u.pathname)) return envoyer('document', decodeURIComponent(u.pathname.split('/').pop() || ''));
    return;
  }
  if (/^https?:$/.test(u.protocol)) envoyer('sortie', u.hostname.replace(/^www\./, ''));
}, { capture: true });

// Temps passé sur la page, onglet visible seulement (plafonné à 30 min)
let visible = document.visibilityState === 'visible' ? performance.now() : 0;
let cumul = 0;
let envoye = false;
const arreter = () => { if (visible) { cumul += performance.now() - visible; visible = 0; } };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { visible = performance.now(); envoye = false; return; }
  arreter();
  if (!envoye && cumul > 1000) { envoyer('_temps', '', Math.min(1800, Math.round(cumul / 1000))); envoye = true; cumul = 0; }
});
addEventListener('pagehide', () => {
  arreter();
  if (!envoye && cumul > 1000) { envoyer('_temps', '', Math.min(1800, Math.round(cumul / 1000))); envoye = true; cumul = 0; }
});

export {};
