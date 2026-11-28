// Comptes des membres (appli > Admin > Comptes des membres). Toutes les actions demandent le mot de passe admin.
//   POST { motDePasse, action, ... } :
//     liste                                   → { membres, mdpCommun, mailPret }
//     creer      { prenom, nom, email, identifiant?, role?, nouveauMdp?, inviter } (identifiant « prenom.nom » proposé s'il est vide) → crée le compte et envoie l'invitation par mail
//     importer   { lignes, inviter }          → plusieurs comptes d'un coup (une ligne par membre)
//     modifier   { id, prenom, nom, email, identifiant, role }   (role : « membre » ou « admin »)
//     actif      { id, actif }                → désactiver (déconnecte tous ses appareils) ou réactiver
//     supprimer  { id }
//     lien       { id }                       → envoie un lien pour choisir un nouveau mot de passe (invitation s'il n'en a jamais eu)
//     definirMdp { id, nouveauMdp }            → l'admin saisit le mot de passe (jamais renvoyé ni affiché) ; déconnecte ses appareils
//     mdpCommun  { actif }                    → accepter ou non le mot de passe commun du club
// Quand le mail n'a pas pu partir, le lien est renvoyé à l'admin pour qu'il le transmette lui-même (SMS, WhatsApp…).
import { estAdmin, json } from '../../_alertes.js';
import { tablesComptes, normEmail, emailValide, envoyerLien, mdpCommunActif, mailPret, maintenant, normIdentifiant, identifiantValide, proposerIdentifiant, identifiantLibre, ROLES, nouveauHash, mdpAcceptable, MDP_REGLE } from '../../_comptes.js';

const propre = (v, n = 60) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const majPrenom = (p) => propre(p).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** « Jean DUPONT jean@x.fr », « jean@x.fr; Dupont; Jean », « DUPONT Jean <jean@x.fr> »… */
function lireLigne(ligne) {
  const m = ligne.match(/[^\s<>,;:"']+@[^\s<>,;:"']+\.[a-z]{2,}/i);
  if (!m) return null;
  const email = normEmail(m[0]);
  const reste = ligne.replace(m[0], ' ').replace(/[<>;,\t"]+/g, ' ').replace(/\s+/g, ' ').trim();
  const mots = reste ? reste.split(' ') : [];
  const caps = mots.filter((w) => /\p{L}/u.test(w) && w === w.toUpperCase());
  let nom, prenom;
  if (caps.length && caps.length < mots.length) { nom = caps.join(' '); prenom = mots.filter((w) => !caps.includes(w)).join(' '); }
  else if (/[,;\t]/.test(ligne) && mots.length >= 2) { nom = mots[0]; prenom = mots.slice(1).join(' '); } // « email; Nom; Prénom »
  else { prenom = mots[0] || ''; nom = mots.slice(1).join(' '); }
  return { email, nom: propre(nom).toUpperCase(), prenom: majPrenom(prenom) };
}

const LISTE = `SELECT id, identifiant, email, role, prenom, nom, actif, cree, derniere, invite, (hash IS NOT NULL) AS a_mdp,
  (SELECT COUNT(*) FROM sessions s WHERE s.membre = membres.id) AS appareils FROM membres ORDER BY nom COLLATE NOCASE, prenom COLLATE NOCASE`;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d = null;
  try { d = await request.json(); } catch { /* illisible */ }
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!(await estAdmin(env, d.motDePasse))) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  const db = env.DB;
  await tablesComptes(db);
  const t = maintenant();
  const role = ROLES.includes(d.role) ? d.role : 'membre';
  const un = (id) => db.prepare('SELECT id, identifiant, email, prenom, nom, role, actif, hash FROM membres WHERE id = ?1').bind(String(id || '')).first();

  switch (d.action) {
    case 'liste': {
      const { results } = await db.prepare(LISTE).all();
      const sessionsClub = await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE membre = 'club'").first();
      return json({ ok: true, membres: results || [], mdpCommun: await mdpCommunActif(env), mdpCommunRegle: !!env.MOT_DE_PASSE_MEMBRES, appareilsClub: sessionsClub?.n || 0, mailPret: mailPret(env) });
    }

    case 'creer':
    case 'importer': {
      const fiches = d.action === 'creer'
        ? [{ email: normEmail(d.email), nom: propre(d.nom).toUpperCase(), prenom: majPrenom(d.prenom) }]
        : String(d.lignes || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500).map((l) => lireLigne(l) || { erreur: l });
      const crees = [], refus = [], liens = [];
      for (const f of fiches) {
        if (f.erreur) { refus.push({ ligne: f.erreur, raison: 'pas d\'adresse e-mail' }); continue; }
        if (!emailValide(f.email)) { refus.push({ ligne: f.email, raison: 'adresse invalide' }); continue; }
        if (d.action === 'creer' && !f.nom && !f.prenom) return json({ ok: false, erreur: 'Indiquez au moins le nom ou le prénom.' }, 400);
        if (await db.prepare('SELECT 1 FROM membres WHERE email = ?1').bind(f.email).first()) {
          if (d.action === 'creer') return json({ ok: false, erreur: `Un compte existe déjà pour ${f.email}.` }, 409);
          refus.push({ ligne: f.email, raison: 'compte déjà existant' }); continue;
        }
        // Identifiant choisi par l'admin (refusé s'il est pris), sinon « prenom.nom » (avec un numéro s'il est pris)
        let identifiant;
        if (d.action === 'creer' && String(d.identifiant || '').trim()) {
          identifiant = normIdentifiant(d.identifiant);
          if (!identifiantValide(identifiant)) return json({ ok: false, erreur: 'Identifiant invalide : au moins 2 caractères, lettres, chiffres, point ou tiret.' }, 400);
          if (await db.prepare('SELECT 1 FROM membres WHERE identifiant = ?1').bind(identifiant).first()) return json({ ok: false, erreur: `L'identifiant « ${identifiant} » est déjà pris.` }, 409);
        } else identifiant = await identifiantLibre(db, proposerIdentifiant(f));
        // Mot de passe saisi par l'admin (facultatif) : seule son empreinte est gardée
        const saisi = d.action === 'creer' && String(d.nouveauMdp || '') ? String(d.nouveauMdp) : '';
        if (saisi && !mdpAcceptable(saisi)) return json({ ok: false, erreur: MDP_REGLE }, 400);
        const id = crypto.randomUUID();
        const r = await db.prepare('INSERT OR IGNORE INTO membres (id, identifiant, email, prenom, nom, role, actif, cree, maj) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)')
          .bind(id, identifiant, f.email, f.prenom, f.nom, d.action === 'creer' ? role : 'membre', t).run();
        if (!r.meta?.changes) {
          if (d.action === 'creer') return json({ ok: false, erreur: `Un compte existe déjà pour ${f.email}.` }, 409);
          refus.push({ ligne: f.email, raison: 'compte déjà existant' }); continue;
        }
        crees.push(identifiant);
        if (saisi) {
          const { sel, hash } = await nouveauHash(saisi);
          await db.prepare('UPDATE membres SET hash = ?1, sel = ?2 WHERE id = ?3').bind(hash, sel, id).run();
        }
        if (d.inviter !== false && !saisi) {
          const e = await envoyerLien(request, env, { id, identifiant, email: f.email, prenom: f.prenom }, 'invitation');
          if (!e.envoye) liens.push({ email: f.email, identifiant, nom: `${f.prenom} ${f.nom}`.trim(), lien: e.lien });
        }
      }
      return json({ ok: true, crees, identifiant: crees[0] || '', refus, liens, mailPret: mailPret(env) });
    }

    case 'modifier': {
      const m = await un(d.id);
      if (!m) return json({ ok: false, erreur: 'Compte introuvable.' }, 404);
      const email = normEmail(d.email);
      if (!emailValide(email)) return json({ ok: false, erreur: 'Adresse e-mail invalide.' }, 400);
      const autre = await db.prepare('SELECT 1 FROM membres WHERE email = ?1 AND id != ?2').bind(email, m.id).first();
      if (autre) return json({ ok: false, erreur: `Un autre compte utilise déjà ${email}.` }, 409);
      const identifiant = normIdentifiant(d.identifiant || m.identifiant);
      if (!identifiantValide(identifiant)) return json({ ok: false, erreur: 'Identifiant invalide : au moins 2 caractères, lettres, chiffres, point ou tiret.' }, 400);
      if (await db.prepare('SELECT 1 FROM membres WHERE identifiant = ?1 AND id != ?2').bind(identifiant, m.id).first()) return json({ ok: false, erreur: `L'identifiant « ${identifiant} » est déjà pris.` }, 409);
      const nouveauRole = ROLES.includes(d.role) ? d.role : m.role;
      await db.batch([
        db.prepare('UPDATE membres SET email = ?1, prenom = ?2, nom = ?3, identifiant = ?4, role = ?5, maj = ?6 WHERE id = ?7')
          .bind(email, majPrenom(d.prenom), propre(d.nom).toUpperCase(), identifiant, nouveauRole, t, m.id),
        // Plus administrateur : ses clés admin ne servent plus (il se reconnecte pour perdre l'onglet Admin)
        ...(nouveauRole !== 'admin' ? [db.prepare('DELETE FROM cles_admin WHERE membre = ?1').bind(m.id)] : []),
      ]);
      return json({ ok: true });
    }

    case 'actif': {
      const m = await un(d.id);
      if (!m) return json({ ok: false, erreur: 'Compte introuvable.' }, 404);
      const actif = d.actif ? 1 : 0;
      await db.batch([
        db.prepare('UPDATE membres SET actif = ?1, maj = ?2 WHERE id = ?3').bind(actif, t, m.id),
        ...(actif ? [] : [db.prepare('DELETE FROM sessions WHERE membre = ?1').bind(m.id), db.prepare('DELETE FROM liens WHERE membre = ?1').bind(m.id), db.prepare('DELETE FROM cles_admin WHERE membre = ?1').bind(m.id)]),
      ]);
      return json({ ok: true });
    }

    case 'supprimer': {
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE membre = ?1').bind(String(d.id || '')),
        db.prepare('DELETE FROM liens WHERE membre = ?1').bind(String(d.id || '')),
        db.prepare('DELETE FROM cles_admin WHERE membre = ?1').bind(String(d.id || '')),
        db.prepare('DELETE FROM membres WHERE id = ?1').bind(String(d.id || '')),
      ]);
      return json({ ok: true });
    }

    case 'lien': {
      const m = await un(d.id);
      if (!m) return json({ ok: false, erreur: 'Compte introuvable.' }, 404);
      if (m.actif !== 1) return json({ ok: false, erreur: 'Ce compte est désactivé : réactivez-le d\'abord.' }, 400);
      const e = await envoyerLien(request, env, m, m.hash ? 'reinit' : 'invitation');
      return json({ ok: true, envoye: e.envoye, lien: e.envoye ? '' : e.lien, email: m.email, raison: e.raison, mailPret: mailPret(env) });
    }

    case 'definirMdp': {
      const m = await un(d.id);
      if (!m) return json({ ok: false, erreur: 'Compte introuvable.' }, 404);
      if (!mdpAcceptable(d.nouveauMdp)) return json({ ok: false, erreur: MDP_REGLE }, 400);
      const { sel, hash } = await nouveauHash(d.nouveauMdp);
      await db.batch([
        db.prepare('UPDATE membres SET hash = ?1, sel = ?2, maj = ?3 WHERE id = ?4').bind(hash, sel, t, m.id),
        db.prepare('DELETE FROM sessions WHERE membre = ?1').bind(m.id),
        db.prepare('DELETE FROM liens WHERE membre = ?1').bind(m.id),
        db.prepare('DELETE FROM cles_admin WHERE membre = ?1').bind(m.id),
      ]);
      return json({ ok: true });
    }

    case 'mdpCommun': {
      const actif = !!d.actif;
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('mdp_commun', ?1)").bind(actif ? '1' : '0'),
        ...(actif ? [] : [db.prepare("DELETE FROM sessions WHERE membre = 'club'")]),
      ]);
      return json({ ok: true, mdpCommun: await mdpCommunActif(env) });
    }
  }
  return json({ ok: false, erreur: 'Action inconnue.' }, 400);
}
