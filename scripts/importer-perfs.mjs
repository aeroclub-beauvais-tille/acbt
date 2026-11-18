// Intègre l'appli « Performances » (dépôt hugoflying/calculateurperformances) dans l'espace membre,
// sous /membre/perfs/ : même adresse que l'appli membre, donc elle s'ouvre dedans, sans barre de navigateur,
// et garde ses réglages (avion, pilote, marge…) dans la même mémoire.
//
// Lancé à chaque publication (toutes les 30 min) : les modifications faites sur Perfs arrivent toutes seules.
// Si le dépôt n'est pas joignable, la copie déjà présente dans public/membre/perfs/ est gardée telle quelle.
//
//   node scripts/importer-perfs.mjs            → télécharge la dernière version
//   node scripts/importer-perfs.mjs <dossier>  → utilise un dossier local
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEPOT = 'https://github.com/hugoflying/calculateurperformances';
// Les fonctions serveur (OpenAIP, archive des fiches) restent sur l'hébergement Cloudflare de Perfs.
const SERVEUR = 'https://prepa-vols-acbt.pages.dev';
const CIBLE = 'public/membre/perfs';

let src = process.argv[2];
let temp;
if (!src) {
  temp = mkdtempSync(join(tmpdir(), 'perfs-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', DEPOT, temp], { stdio: 'inherit', timeout: 120000 });
    src = temp;
  } catch {
    console.warn('[perfs] dépôt injoignable : copie existante conservée.');
    process.exit(0);
  }
}

const lire = (f) => readFileSync(join(src, f), 'utf8');
function remplacer(texte, avant, apres, fichier) {
  if (!texte.includes(avant)) throw new Error(`[perfs] « ${avant} » introuvable dans ${fichier} : à adapter.`);
  return texte.split(avant).join(apres);
}

const RETOUR = '<a class="icon-btn perfs-retour" href="../#preparer" aria-label="Retour à l\'espace membres" title="Espace membres">'
  + '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></a>\n    ';

try {
  let index = lire('index.html');
  // Pas de manifeste propre : la page fait partie de l'appli « Espace membres ».
  index = remplacer(index, '<link rel="manifest" href="/manifest.json"/>', '', 'index.html');
  index = remplacer(index, 'href="/icons/', 'href="icons/', 'index.html');
  // Un seul service worker : celui de l'espace membre garde aussi Perfs pour le hors-ligne.
  index = remplacer(index, "navigator.serviceWorker.register('/sw.js')", 'Promise.resolve()', 'index.html');
  index = remplacer(index, '`/openaip?', '`' + SERVEUR + '/openaip?', 'index.html');
  index = remplacer(index, "'/api/fiches'", `'${SERVEUR}/api/fiches'`, 'index.html');
  index = remplacer(index, '<div class="brand-wrap">', RETOUR + '<div class="brand-wrap">', 'index.html');
  // Place pour la flèche retour : le titre ne doit jamais passer sous les boutons (gros textes du téléphone).
  index = index.replace('</head>', '<style>.topbar-in .perfs-retour{width:26px;margin-left:-4px}'
    + '.brand-wrap{overflow:hidden}.brand{overflow:hidden;text-overflow:ellipsis}'
    + '@media (max-width:440px){.brand-logo{height:28px}.brand-wrap{gap:7px}}</style>\n</head>');

  let doc = lire('documentation.html').split('href="/icons/').join('href="icons/');
  let archives = lire('archives.html').split("fetch('/api/fiches").join(`fetch('${SERVEUR}/api/fiches`);

  rmSync(CIBLE, { recursive: true, force: true });
  mkdirSync(CIBLE, { recursive: true });
  writeFileSync(join(CIBLE, 'index.html'), index);
  writeFileSync(join(CIBLE, 'documentation.html'), doc);
  writeFileSync(join(CIBLE, 'archives.html'), archives);
  for (const d of ['fonts', 'icons']) if (existsSync(join(src, d))) cpSync(join(src, d), join(CIBLE, d), { recursive: true });
  console.log('[perfs] appli Performances intégrée dans', CIBLE);
} catch (e) {
  // Perfs a changé de forme : on garde l'ancienne copie plutôt que de publier une appli cassée.
  console.warn(String(e.message || e), '— copie existante conservée.');
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
