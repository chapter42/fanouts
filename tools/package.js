/*
 * Bouwt het ZIP-bestand voor de Chrome Web Store.
 *
 *   node tools/package.js
 *
 * Bewust een include-lijst en geen exclude-lijst: bij uitsluiten lekt er vroeg of
 * laat een nieuw dev-bestand mee dat niemand opmerkt. Hier gaat alleen mee wat
 * Chrome nodig heeft om de extensie te draaien.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', 'icons', 'src', 'LICENSE'];

process.chdir(ROOT);

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const out = `fanouts-v${manifest.version}.zip`;

const missing = INCLUDE.filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error('Ontbrekend: ' + missing.join(', '));
  process.exit(1);
}

// Draai eerst de projectcontroles — een pakket bouwen van een repo die zijn eigen
// regels schendt is precies het moment waarop je het niet wilt ontdekken.
try {
  execFileSync(process.execPath, ['tools/check.js'], { stdio: 'inherit' });
} catch (e) {
  console.error('\nControles gefaald — geen pakket gebouwd.');
  process.exit(1);
}

fs.rmSync(out, { force: true });

execFileSync('zip', ['-r', '-q', '-X', out].concat(INCLUDE), { stdio: 'inherit' });

const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

// Vangnet: als er ooit toch iets meeglipt dat er niet hoort, faalt dit hier.
const forbidden = listing.filter((f) =>
  /(^|\/)(\.git|node_modules|dev|tools|\.github)\//.test(f) ||
  /\.(md|zip|log)$/i.test(f) && !/^LICENSE$/.test(f) ||
  /(^|\/)\.(DS_Store|env)/.test(f) ||
  /^(package(-lock)?\.json)$/.test(f)
);
if (forbidden.length) {
  console.error('\nDeze bestanden horen niet in het pakket:\n  ' + forbidden.join('\n  '));
  fs.rmSync(out, { force: true });
  process.exit(1);
}

const size = fs.statSync(out).size;
console.log(`\n${out} — ${listing.length} bestanden, ${(size / 1024).toFixed(1)} KB`);
console.log('Inhoud:');
[...new Set(listing.map((f) => f.split('/').slice(0, 2).join('/')))].sort()
  .forEach((f) => console.log('  ' + f));
console.log('\nUpload dit bestand in het Chrome Developer Dashboard.');
console.log('Vul de listing in vanuit CHROMEWEBSTORE.md.');
