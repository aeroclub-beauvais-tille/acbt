// Fonctions de l'appli « Espace membre » côté téléphone : connexion, installation, documents hors ligne.
import { url } from '../lib/utils';

const CLE = 'acbt-membre';
const DOCS = 'acbt-membre-docs';

const lire = () => { try { return localStorage.getItem(CLE); } catch { return null; } };
const ecrire = (v: string | null) => { try { v ? localStorage.setItem(CLE, v) : localStorage.removeItem(CLE); } catch { /* navigation privée */ } };

export const estConnecte = () => !!lire();

/**
 * Vérifie le mot de passe du club.
 * - Sur Cloudflare, la fonction /api/connexion compare au mot de passe secret et dépose le cookie de session.
 * - Tant qu'elle n'existe pas (maquette sur GitHub Pages), tout mot de passe est accepté.
 */
export async function seConnecter(motDePasse: string): Promise<'ok' | 'refuse' | 'maquette' | 'erreur'> {
  try {
    const rep = await fetch(url('/api/connexion'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motDePasse }),
      credentials: 'same-origin',
    });
    if (rep.status === 401) return 'refuse';
    if (rep.ok && (rep.headers.get('content-type') || '').includes('json')) { ecrire('serveur'); return 'ok'; }
    if (rep.status >= 500) return 'erreur';
  } catch { /* pas de réseau ou pas de serveur */ }
  ecrire('maquette');
  return 'maquette';
}

export async function seDeconnecter() {
  ecrire(null);
  try { await caches.delete(DOCS); } catch { /* rien à effacer */ }
  try { await fetch(url('/api/deconnexion'), { method: 'POST', credentials: 'same-origin' }); } catch { /* maquette */ }
  location.href = url('/membre/connexion/');
}

/**
 * Installe le service worker et garde l'appli à jour toute seule :
 * à chaque retour sur l'appli (et toutes les 30 min), on regarde si le site a changé ;
 * si oui, la nouvelle version s'installe et la page se recharge, sans rien désinstaller.
 */
export function enregistrer() {
  if (!('serviceWorker' in navigator)) return;
  const dejaActif = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(url('/sw-membre.js'), { scope: url('/'), updateViaCache: 'none' }).then((reg) => {
    const verifier = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier(); });
    window.addEventListener('online', verifier);
    setInterval(verifier, 30 * 60 * 1000);
  }).catch(() => {});

  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!dejaActif || recharge) return; // première installation : la page est déjà à jour
    const occupe = () => document.body.dataset.telechargement === 'oui' || document.activeElement?.matches('input, textarea');
    const recharger = () => { if (recharge) return; recharge = true; location.reload(); };
    if (document.visibilityState === 'hidden' || !occupe()) return recharger();
    // La personne est en train de taper ou de télécharger : on attend qu'elle ait fini
    const attendre = setInterval(() => { if (!occupe()) { clearInterval(attendre); recharger(); } }, 2000);
  });
}

export const estInstallee = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const iphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Bouton « Installer l'appli » : invite du navigateur sur Android et ordinateur, explication sur iPhone. */
export function boutonInstaller(bouton: HTMLButtonElement | null, aide: HTMLElement | null) {
  if (!bouton || estInstallee()) return;
  let invite: (Event & { prompt: () => Promise<void> }) | null = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e as typeof invite; bouton.hidden = false; });
  window.addEventListener('appinstalled', () => { bouton.hidden = true; if (aide) aide.hidden = true; });
  if (iphone()) bouton.hidden = false;
  bouton.addEventListener('click', async () => {
    if (invite) { await invite.prompt(); invite = null; return; }
    if (aide) aide.hidden = !aide.hidden;
  });
}

/**
 * Badges de validité, recalculés dans le navigateur à chaque ouverture (justes même hors ligne,
 * contrairement à un calcul figé au moment de la publication). Alimente aussi le bandeau d'alerte.
 * Chaque badge porte data-fin (AAAA-MM-JJ), éventuellement data-debut, ou data-sansfin.
 */
export function badges(racine: ParentNode = document) {
  const PREAVIS = 30;
  const auj = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ du jour à Paris
  const midi = (iso: string) => Date.parse(iso + 'T12:00:00Z');
  const jours = (iso: string) => Math.round((midi(iso) - midi(auj)) / 86_400_000);
  const fmt = (iso: string) =>
    new Date(iso + 'T12:00:00Z')
      .toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' })
      .replace(/^1 /, '1er ');
  const alertes: { titre: string; code: string; txt: string; vers?: string }[] = [];

  racine.querySelectorAll<HTMLElement>('.badge').forEach((b) => {
    const fin = b.dataset.fin;
    const debut = b.dataset.debut;
    let code = 'sans-fin';
    let txt = 'N’expire pas';
    if (debut && jours(debut) > 0) {
      code = 'a-venir';
      txt = 'Valide à partir du ' + fmt(debut);
    } else if (fin) {
      const j = jours(fin);
      if (j < 0) { code = 'expire'; txt = 'Expiré le ' + fmt(fin); }
      else if (j === 0) { code = 'bientot'; txt = 'Expire aujourd’hui'; }
      else if (j <= PREAVIS) { code = 'bientot'; txt = `Expire dans ${j} jour${j > 1 ? 's' : ''}`; }
      else { code = 'valide'; txt = 'Valide jusqu’au ' + fmt(fin); }
    }
    b.dataset.code = code;
    b.textContent = txt;
    b.hidden = false;
    if ((code === 'expire' || code === 'bientot') && b.dataset.titre && !alertes.some((a) => a.titre === b.dataset.titre))
      alertes.push({ titre: b.dataset.titre, code, txt, vers: b.dataset.vers });
  });

  const zone = racine.querySelector<HTMLElement>('#alerte-docs');
  if (zone) {
    const liste = zone.querySelector('[data-liste]');
    const vide = zone.querySelector<HTMLElement>('[data-vide]');
    alertes.sort((a, b) => (a.code === b.code ? 0 : a.code === 'expire' ? -1 : 1));
    if (liste) liste.innerHTML = alertes
      .map((a) => `<li class="al al-${a.code}"><span class="pt"></span><span><b>${a.titre}</b> — ${a.txt}</span></li>`)
      .join('');
    zone.dataset.n = String(alertes.length);
    if (vide) vide.hidden = alertes.length > 0;
    zone.querySelector<HTMLElement>('[data-pleine]')!.hidden = alertes.length === 0;
  }
}

/**
 * Onglets de l'espace membre (Accueil, Avions, Club…). Une seule page : évite de recharger
 * et de recacher chaque sous-page dans l'appli. L'onglet choisi est gardé dans l'adresse (#avions).
 */
export function onglets() {
  const barre = document.getElementById('onglets');
  if (!barre) return;
  const boutons = [...barre.querySelectorAll<HTMLButtonElement>('[data-onglet]')];
  const sections = new Map(boutons.map((b) => [b.dataset.onglet!, document.getElementById(b.dataset.onglet!)]));
  const montrer = (id: string, defiler = true) => {
    if (!sections.has(id)) id = boutons[0].dataset.onglet!;
    boutons.forEach((b) => {
      const on = b.dataset.onglet === id;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('actif', on);
    });
    sections.forEach((s, k) => { if (s) s.hidden = k !== id; });
    try { history.replaceState(null, '', '#' + id); } catch { /* navigation privée */ }
    if (defiler) scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };
  boutons.forEach((b) => b.addEventListener('click', () => montrer(b.dataset.onglet!)));
  document.querySelectorAll<HTMLElement>('[data-vers]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); montrer(a.dataset.vers!); }));
  montrer(location.hash.replace('#', '') || boutons[0].dataset.onglet!, false);
  return montrer;
}

/** Encadré « Hors ligne » : compte les documents déjà gardés et permet de tout télécharger d'un coup. */
export async function horsLigne(zone: HTMLElement | null) {
  if (!zone || !('caches' in window)) { if (zone) zone.hidden = true; return; }
  const fichiers: string[] = JSON.parse(zone.dataset.fichiers || '[]');
  const etat = zone.querySelector<HTMLElement>('[data-etat]');
  const bouton = zone.querySelector<HTMLButtonElement>('button');
  const barre = zone.querySelector<HTMLProgressElement>('progress');
  const cle = (f: string) => { const u = new URL(f, location.href); return u.pathname + u.search; };
  const compter = async () => {
    const cache = await caches.open(DOCS);
    let n = 0;
    for (const f of fichiers) if (await cache.match(cle(f))) n++;
    return n;
  };
  const afficher = (n: number) => {
    if (etat) etat.textContent = n === fichiers.length
      ? `Les ${n} documents sont disponibles sans réseau.`
      : `${n} document${n > 1 ? 's' : ''} sur ${fichiers.length} disponible${n > 1 ? 's' : ''} sans réseau.`;
    if (bouton) bouton.hidden = n === fichiers.length;
  };
  afficher(await compter());
  bouton?.addEventListener('click', async () => {
    bouton.disabled = true;
    document.body.dataset.telechargement = 'oui';
    try { await navigator.storage?.persist?.(); } catch { /* facultatif */ }
    const cache = await caches.open(DOCS);
    if (barre) { barre.hidden = false; barre.max = fichiers.length; barre.value = 0; }
    let echecs = 0;
    for (const f of fichiers) {
      if (!(await cache.match(cle(f)))) {
        try {
          const rep = await fetch(f, { credentials: 'same-origin', cache: 'reload' });
          if (rep.ok && !rep.redirected) await cache.put(cle(f), rep); else echecs++;
        } catch { echecs++; }
      }
      if (barre) barre.value++;
    }
    if (barre) barre.hidden = true;
    bouton.disabled = false;
    delete document.body.dataset.telechargement;
    afficher(await compter());
    if (echecs && etat) etat.textContent += ` ${echecs} n'ont pas pu être téléchargés : réessayez avec une meilleure connexion.`;
  });
}
