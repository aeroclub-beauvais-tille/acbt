// Comptes individuels de l'espace membre : un identifiant (adresse e-mail) et un mot de passe par membre.
// Tout est rangé dans la base D1 du site (liaison DB) :
//   - membres  : un membre par ligne (nom, prénom, e-mail, empreinte du mot de passe, actif ou non) ;
//   - sessions : une ligne par appareil connecté (le cookie ne contient qu'un numéro tiré au hasard) ;
//   - liens    : liens d'invitation et de réinitialisation envoyés par mail (valables 24 h, ou 14 jours pour une invitation).
// Le mot de passe commun du club (MOT_DE_PASSE_MEMBRES) reste accepté tant que l'admin ne l'a pas coupé
// (Admin > Comptes des membres) : personne n'est mis dehors pendant la création des comptes.
import { jeton, lireCookie, egal } from './_session.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hasard = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (t) => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
export const maintenant = () => new Date().toISOString();

export const UNE_HEURE = 3600e3;
export const DUREE = { reinit: 24 * UNE_HEURE, invitation: 14 * 24 * UNE_HEURE };

export async function tablesComptes(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS membres (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, prenom TEXT, nom TEXT,
      hash TEXT, sel TEXT, actif INTEGER NOT NULL DEFAULT 1,
      cree TEXT NOT NULL, maj TEXT NOT NULL, derniere TEXT, invite TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      jeton TEXT PRIMARY KEY, membre TEXT NOT NULL, cree TEXT NOT NULL, vu TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_membre ON sessions (membre)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS liens (
      jeton TEXT PRIMARY KEY, membre TEXT NOT NULL, type TEXT NOT NULL, expire TEXT NOT NULL, cree TEXT NOT NULL)`),
    db.prepare('CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)'),
  ]);
  // Identifiant (nom d'utilisateur), distinct de l'adresse e-mail : ajouté après coup, rempli pour les comptes existants
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('membres')").all();
  if (!(results || []).some((r) => r.name === 'identifiant')) {
    try { await db.prepare('ALTER TABLE membres ADD COLUMN identifiant TEXT').run(); } catch { /* ajoutée entre-temps */ }
  }
  const sans = (await db.prepare('SELECT id, prenom, nom, email FROM membres WHERE identifiant IS NULL').all()).results || [];
  for (const m of sans) await db.prepare('UPDATE membres SET identifiant = ?1 WHERE id = ?2').bind(await identifiantLibre(db, proposerIdentifiant(m)), m.id).run();
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS membres_identifiant ON membres (identifiant)').run();
  // Rôle : « membre » ou « admin » (l'onglet Admin et ses outils, sans connaître le mot de passe admin du site)
  if (!(results || []).some((r) => r.name === 'role')) {
    try { await db.prepare("ALTER TABLE membres ADD COLUMN role TEXT NOT NULL DEFAULT 'membre'").run(); } catch { /* ajoutée entre-temps */ }
  }
  await db.prepare('CREATE TABLE IF NOT EXISTS cles_admin (jeton TEXT PRIMARY KEY, membre TEXT NOT NULL, cree TEXT NOT NULL)').run();
}

// --- Clé admin : remise à la connexion d'un compte « Administrateur », gardée sur son appareil (comme l'était le mot de passe admin)
// et envoyée avec chaque action admin. Désactiver le compte ou lui retirer le rôle la rend inutilisable.
export const ROLES = ['membre', 'admin'];
export async function creerCleAdmin(env, membre) {
  const brut = hasard(32);
  await env.DB.prepare('INSERT INTO cles_admin (jeton, membre, cree) VALUES (?1, ?2, ?3)').bind(await sha(brut), membre, maintenant()).run();
  return `cle.${brut}`;
}
export async function cleAdminValide(env, cle) {
  if (!env.DB || !/^cle\.[0-9a-f]{64}$/.test(cle)) return false;
  try {
    const r = await env.DB.prepare(`SELECT 1 FROM cles_admin c JOIN membres m ON m.id = c.membre
      WHERE c.jeton = ?1 AND m.actif = 1 AND m.role = 'admin'`).bind(await sha(cle.slice(4))).first();
    return !!r;
  } catch { return false; } // tables pas encore créées
}

// --- Identifiant : lettres minuscules sans accent, chiffres, point, tiret ; « prenom.nom » proposé par défaut
export const normIdentifiant = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 40);
export const identifiantValide = (v) => /^[a-z0-9][a-z0-9._-]{1,39}$/.test(v) && !v.includes('@');
export function proposerIdentifiant({ prenom, nom, email }) {
  const base = normIdentifiant([prenom, nom].filter(Boolean).join('.'));
  return base.length >= 2 ? base : normIdentifiant(String(email || '').split('@')[0]) || 'membre';
}
/** L'identifiant voulu, ou le même suivi de 2, 3… s'il est déjà pris. */
export async function identifiantLibre(db, voulu, sauf = '') {
  for (let i = 1; i < 500; i++) {
    const essai = i === 1 ? voulu : `${voulu}${i}`;
    if (!(await db.prepare('SELECT 1 FROM membres WHERE identifiant = ?1 AND id != ?2').bind(essai, sauf).first())) return essai;
  }
  return `${voulu}.${crypto.randomUUID().slice(0, 6)}`;
}
/** Cherche un membre par son identifiant ou par son adresse e-mail. */
export function chercherMembre(db, saisie, colonnes) {
  const v = String(saisie || '').trim().toLowerCase();
  return v.includes('@')
    ? db.prepare(`SELECT ${colonnes} FROM membres WHERE email = ?1`).bind(v).first()
    : db.prepare(`SELECT ${colonnes} FROM membres WHERE identifiant = ?1`).bind(normIdentifiant(v)).first();
}

export const normEmail = (v) => String(v || '').trim().toLowerCase();
export const emailValide = (v) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(v);

// --- Mots de passe : PBKDF2-SHA256, 100 000 tours (le maximum permis par Cloudflare), sel propre à chaque membre
export async function hacher(motDePasse, sel) {
  const cle = await crypto.subtle.importKey('raw', enc.encode(String(motDePasse)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sel), iterations: 100000 }, cle, 256);
  return hex(bits);
}
export async function nouveauHash(motDePasse) {
  const sel = hasard(16);
  return { sel, hash: await hacher(motDePasse, sel) };
}
export const mdpAcceptable = (m) => String(m || '').length >= 8;

// --- Mot de passe commun du club : accepté tant que l'admin ne l'a pas coupé
export async function mdpCommunActif(env) {
  if (!env.MOT_DE_PASSE_MEMBRES) return false;
  if (!env.DB) return true;
  try {
    const r = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'mdp_commun'").first();
    return !r || r.valeur !== '0';
  } catch { return true; } // table pas encore créée
}

// --- Sessions : le cookie vaut « s.<numéro au hasard> » ; la base garde l'empreinte du numéro et le membre
// membre = id du membre, « club » (mot de passe commun) ou « admin » (mot de passe admin)
export async function ouvrirSession(env, membre) {
  const brut = hasard(32);
  const t = maintenant();
  await env.DB.prepare('INSERT INTO sessions (jeton, membre, cree, vu) VALUES (?1, ?2, ?3, ?3)').bind(await sha(brut), membre, t).run();
  return `s.${brut}`;
}

export async function fermerSession(env, request) {
  const c = lireCookie(request);
  if (!c.startsWith('s.') || !env.DB) return;
  try { await env.DB.prepare('DELETE FROM sessions WHERE jeton = ?1').bind(await sha(c.slice(2))).run(); } catch { /* déjà partie */ }
}

/** Qui est connecté sur cet appareil ? { qui: 'membre'|'club'|'admin', membre? } ou null. */
export async function session(request, env, waitUntil) {
  const c = lireCookie(request);
  if (!c) return null;
  if (c.startsWith('s.')) {
    if (!env.DB) return null;
    let r = null;
    try {
      r = await env.DB.prepare(`SELECT s.jeton, s.membre, s.vu, m.actif, m.prenom, m.nom, m.email
        FROM sessions s LEFT JOIN membres m ON m.id = s.membre WHERE s.jeton = ?1`).bind(await sha(c.slice(2))).first();
    } catch { return null; }
    if (!r) return null;
    if (r.membre === 'club' && !(await mdpCommunActif(env))) return null;
    if (r.membre === 'admin' && !env.MOT_DE_PASSE_ADMIN && !env.ARCHIVE_PASSWORD) return null;
    if (r.membre !== 'club' && r.membre !== 'admin' && r.actif !== 1) return null;
    // On note le passage au plus une fois par jour (pour la colonne « dernière connexion »), sans ralentir la page
    const t = maintenant();
    if (r.vu.slice(0, 10) !== t.slice(0, 10)) {
      const maj = env.DB.batch([
        env.DB.prepare('UPDATE sessions SET vu = ?1 WHERE jeton = ?2').bind(t, r.jeton),
        env.DB.prepare('UPDATE membres SET derniere = ?1 WHERE id = ?2').bind(t, r.membre),
      ]).catch(() => {});
      if (waitUntil) waitUntil(maj);
    }
    if (r.membre === 'club' || r.membre === 'admin') return { qui: r.membre };
    return { qui: 'membre', membre: { id: r.membre, prenom: r.prenom, nom: r.nom, email: r.email } };
  }
  // Ancien cookie (avant les comptes) : l'empreinte du mot de passe commun
  if (env.MOT_DE_PASSE_MEMBRES && (await mdpCommunActif(env)) && egal(c, await jeton(env.MOT_DE_PASSE_MEMBRES))) return { qui: 'club' };
  return null;
}

// --- Liens d'invitation / de réinitialisation
export async function creerLien(env, membre, type) {
  const brut = hasard(24);
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM liens WHERE membre = ?1 OR expire < ?2').bind(membre, new Date(t).toISOString()),
    env.DB.prepare('INSERT INTO liens (jeton, membre, type, expire, cree) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(await sha(brut), membre, type, new Date(t + DUREE[type]).toISOString(), new Date(t).toISOString()),
  ]);
  return brut;
}

export async function lireLien(env, brut) {
  if (!/^[0-9a-f]{48}$/.test(String(brut || ''))) return null;
  const r = await env.DB.prepare(`SELECT l.jeton, l.type, l.expire, m.id, m.prenom, m.nom, m.email, m.identifiant, m.role, m.actif
    FROM liens l JOIN membres m ON m.id = l.membre WHERE l.jeton = ?1`).bind(await sha(brut)).first();
  if (!r || r.expire < maintenant() || r.actif !== 1) return null;
  return r;
}

export const adresseSite = (request, env) => String(env.SITE || new URL(request.url).origin).replace(/\/+$/, '');

// --- Envoi des mails (Resend, ou Brevo) : une clé d'accès qui n'expire pas, rangée en secret Cloudflare
export const mailPret = (env) => !!(env.RESEND_API_KEY || env.BREVO_API_KEY);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/** Envoie un mail. Renvoie { ok: true } ou { ok: false, raison }. */
export async function envoyerMail(env, { a, sujet, texte, html }) {
  const de = String(env.MAIL_EXPEDITEUR || 'Aéroclub de Beauvais-Tillé <espace-membres@acbt60.fr>');
  const repondre = String(env.MAIL_REPONSE || 'acbt60@gmail.com');
  try {
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: de, to: [a], reply_to: repondre, subject: sujet, text: texte, html }),
      });
      return r.ok ? { ok: true } : { ok: false, raison: `Resend ${r.status} ${(await r.text()).slice(0, 200)}` };
    }
    if (env.BREVO_API_KEY) {
      const m = de.match(/^(.*)<(.+)>$/);
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: m ? { name: m[1].trim(), email: m[2].trim() } : { email: de }, to: [{ email: a }], replyTo: { email: repondre }, subject: sujet, textContent: texte, htmlContent: html }),
      });
      return r.ok ? { ok: true } : { ok: false, raison: `Brevo ${r.status} ${(await r.text()).slice(0, 200)}` };
    }
  } catch (e) { return { ok: false, raison: String(e?.message || e) }; }
  return { ok: false, raison: 'aucun service de mail réglé' };
}

/** Mail d'invitation (nouveau compte) ou de réinitialisation, avec le lien pour choisir son mot de passe. */
export function mailLien({ type, prenom, email, identifiant, lien }) {
  const bonjour = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const invitation = type === 'invitation';
  const sujet = invitation ? 'Votre compte sur l\'espace membres de l\'ACBT' : 'Nouveau mot de passe pour l\'espace membres de l\'ACBT';
  const intro = invitation
    ? 'Un compte vient d\'être créé pour vous sur l\'espace membres de l\'aéroclub de Beauvais-Tillé.'
    : 'Une demande de nouveau mot de passe a été faite pour votre compte de l\'espace membres de l\'aéroclub de Beauvais-Tillé.';
  const action = invitation ? 'Choisir mon mot de passe' : 'Choisir un nouveau mot de passe';
  const duree = invitation ? 'Ce lien est valable 14 jours.' : 'Ce lien est valable 24 heures. Si vous n\'avez rien demandé, ignorez ce mail : votre mot de passe actuel reste valable.';
  const ident = identifiant ? `Votre identifiant : ${identifiant} (vous pouvez aussi vous connecter avec votre adresse ${email})` : `Votre identifiant : ${email}`;
  const texte = `${bonjour}\n\n${intro}\n\n${ident}\n\n${action} :\n${lien}\n\n${duree}\n\nAéroclub de Beauvais-Tillé`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f2f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f1d33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b2a5b;color:#ffffff;padding:18px 22px;font-weight:bold;font-size:17px">Espace membres · ACBT</td></tr>
<tr><td style="padding:22px;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">${esc(bonjour)}</p>
<p style="margin:0 0 12px">${esc(intro)}</p>
<p style="margin:0 0 18px">Votre identifiant : <b>${esc(identifiant || email)}</b>${identifiant ? `<br><span style="color:#5b6b82;font-size:13px">Vous pouvez aussi vous connecter avec votre adresse ${esc(email)}.</span>` : ''}</p>
<p style="margin:0 0 18px"><a href="${esc(lien)}" style="display:inline-block;background:#0b2a5b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(action)}</a></p>
<p style="margin:0 0 12px;color:#5b6b82;font-size:13px">${esc(duree)}</p>
<p style="margin:0;color:#5b6b82;font-size:12px;word-break:break-all">Si le bouton ne marche pas, copiez ce lien dans le navigateur : ${esc(lien)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { sujet, texte, html };
}

/** Crée le lien, envoie le mail et renvoie { envoye, lien, raison }. */
export async function envoyerLien(request, env, m, type) {
  const brut = await creerLien(env, m.id, type);
  const lien = `${adresseSite(request, env)}/membre/mot-de-passe/?jeton=${brut}`;
  const r = await envoyerMail(env, { a: m.email, ...mailLien({ type, prenom: m.prenom, email: m.email, identifiant: m.identifiant, lien }) });
  if (type === 'invitation') await env.DB.prepare('UPDATE membres SET invite = ?1 WHERE id = ?2').bind(maintenant(), m.id).run();
  return { envoye: r.ok, lien, raison: r.ok ? '' : r.raison };
}
