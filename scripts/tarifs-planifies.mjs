// Avant chaque publication : copie les changements de tarifs programmés dans l'appli (Cloudflare D1, /api/tarifs)
// dans src/data/tarifs-planifies.json, lu par src/lib/tarifs.ts.
// Si la lecture échoue, on arrête la publication : mieux vaut garder le site en ligne tel quel
// que de le republier avec les anciens prix.
import { writeFileSync } from 'node:fs';
const source = process.env.TARIFS_URL || 'https://acbt60.fr/api/tarifs';
let d = null;
for (let essai = 1; essai <= 3 && !d; essai++) {
  try {
    const r = await fetch(source, { headers: { 'User-Agent': 'acbt-publication' } });
    if (r.ok) d = await r.json();
    else console.log(`Essai ${essai} : réponse ${r.status}`);
  } catch (e) { console.log(`Essai ${essai} : ${e.message}`); }
  if (!d) await new Promise((ok) => setTimeout(ok, 5000 * essai));
}
if (!d || !Array.isArray(d.changements)) { console.error(`Tarifs programmés illisibles (${source}) : publication arrêtée.`); process.exit(1); }
writeFileSync(new URL('../src/data/tarifs-planifies.json', import.meta.url), JSON.stringify({ version: d.version, changements: d.changements }, null, 2) + '\n');
console.log(`${d.changements.length} changement(s) de tarif programmé(s), version ${d.version}.`);
