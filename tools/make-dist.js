/*
 * Zet alles wat het Chrome Developer Dashboard vraagt in één map.
 *
 *   node tools/make-dist.js
 *
 * De teksten worden uit CHROMEWEBSTORE.md gehaald en niet hier overgetypt: twee
 * bronnen lopen vroeg of laat uit elkaar, en dan staat er in de store iets
 * anders dan wat is nagekeken. Elk anker wordt gecontroleerd — een zoekactie die
 * stil niets vindt kostte ons eerder een CSV-kolom.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
process.chdir(ROOT);

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const cws = fs.readFileSync('CHROMEWEBSTORE.md', 'utf8');
const zipName = `fanouts-v${manifest.version}.zip`;

function fail(msg) {
  console.error('\nGeen indienmap gebouwd: ' + msg);
  process.exit(1);
}

/* --------------------------------------------------- lezen uit de listing */

// Het eerste codeblok na een vet label, bijvoorbeeld **Short Description**.
function blockAfter(label) {
  const at = cws.indexOf('**' + label + '**');
  if (at === -1) fail('label "' + label + '" niet gevonden in CHROMEWEBSTORE.md');
  const m = /```[a-z]*\n([\s\S]*?)\n```/.exec(cws.slice(at));
  if (!m) fail('geen codeblok na "' + label + '"');
  return m[1];
}

// De regel direct na een vet label, zonder opmaak.
function lineAfter(label) {
  const m = new RegExp('\\*\\*' + label + '\\*\\*:?[ \\t]*\\n?([^\\n]+)').exec(cws);
  if (!m) fail('geen waarde na "' + label + '"');
  return m[1].replace(/`/g, '').replace(/\s*\(\d+ tekens\)\s*$/, '').trim();
}

// De rijen van de eerste tabel onder een kop, als arrays van cellen.
function tableUnder(heading) {
  const at = cws.indexOf(heading);
  if (at === -1) fail('kop "' + heading + '" niet gevonden');
  const rows = [];
  const lines = cws.slice(at).split('\n').slice(1);
  let started = false;
  for (const line of lines) {
    if (line.charAt(0) === '|') {
      started = true;
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      rows.push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/`/g, '')));
    } else if (started) break;
  }
  if (rows.length < 2) fail('geen tabel onder "' + heading + '"');
  return rows.slice(1);
}

const name = lineAfter('Extension Name');
const short = blockAfter('Short Description');
const long = blockAfter('Detailed Description');
const purpose = blockAfter('Single Purpose').replace(/\n/g, ' ');
const category = lineAfter('Category');
const language = lineAfter('Primary Language');
const privacyUrl = blockAfter('Privacy Policy URL').trim();
const visibility = lineAfter('Visibility');
const permissions = tableUnder('## Permissions Justification');
const dataTypes = tableUnder('### Data Collection');
const developer = tableUnder('## Developer Info');

// De listing mag niet uit de pas lopen met wat er wordt ingediend.
if (name !== manifest.name) fail('extensienaam wijkt af van manifest.json: "' + name + '"');
if (short !== manifest.description) fail('korte beschrijving wijkt af van manifest.json');
if (short.length > 132) fail('korte beschrijving is ' + short.length + ' tekens (max 132)');
if (!/^https:\/\//.test(privacyUrl)) fail('privacy-URL ziet er niet uit als een URL: ' + privacyUrl);

const declared = manifest.permissions.concat(manifest.host_permissions);
const justified = permissions.map((r) => r[0]).join(' ');
const unjustified = declared.filter((p) => justified.indexOf(p) === -1);
if (unjustified.length) fail('geen onderbouwing voor: ' + unjustified.join(', '));

/* ------------------------------------------------------------- bouwen */

const SHOTS = fs.readdirSync('store-assets').filter((f) => /^\d\d-.*\.png$/.test(f)).sort();
if (!SHOTS.length) fail('geen screenshots in store-assets/ — draai eerst npm run screenshots');

execFileSync(process.execPath, ['tools/package.js'], { stdio: 'inherit' });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'beelden'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'teksten'), { recursive: true });

fs.copyFileSync(zipName, path.join(DIST, zipName));
fs.copyFileSync('icons/icon128.png', path.join(DIST, 'beelden', 'icoon-128.png'));
SHOTS.forEach((f) => fs.copyFileSync(path.join('store-assets', f), path.join(DIST, 'beelden', f)));
fs.copyFileSync('store-assets/privacy.html', path.join(DIST, 'privacy.html'));

function text(file, body) {
  fs.writeFileSync(path.join(DIST, 'teksten', file), body.replace(/\s+$/, '') + '\n');
}

text('01-naam.txt', name);
text('02-korte-beschrijving.txt', short);
text('03-uitgebreide-beschrijving.txt', long);
text('04-single-purpose.txt', purpose);
text('05-rechten.txt', permissions.map((r) => r[0] + '\n' + r[2]).join('\n\n'));
text('06-privacybeleid-url.txt', privacyUrl);

/*
 * De dataverklaring is een juridische verklaring van de uitgever. De tabel in
 * CHROMEWEBSTORE.md zegt per soort of er iets verwerkt wordt; waar het antwoord
 * geen kaal ja of nee is, kiezen we hier niet voor de gebruiker.
 */
function tick(row) {
  const v = row[1].toLowerCase();
  if (v.indexOf('ja') === 0) return '[x]';
  if (v === 'nee') return '[ ]';
  return '[?]';
}
const doubts = dataTypes.filter((r) => tick(r) === '[?]');
const dataLines = dataTypes.map((r) => {
  const note = tick(r) === '[?]' ? '   ← jouw afweging: ' + (r[1].toLowerCase() === 'idem' ? dataTypes[0][1] : r[1]) : '';
  return tick(r) + ' ' + r[0] + note;
});

/* ------------------------------------------------------- INDIENEN.md */

const guide = `# Fanouts ${manifest.version} indienen bij de Chrome Web Store

Gebouwd op ${new Date().toISOString().slice(0, 10)} met \`npm run dist\`. Deze map is een
afgeleide: wijzig teksten in \`CHROMEWEBSTORE.md\` en bouw opnieuw.

Dashboard: https://chrome.google.com/webstore/devconsole

## Vooraf

- [ ] Ontwikkelaarsaccount geregistreerd (eenmalig 5 dollar)
- [ ] De privacy-URL opent en toont het contactadres, ook zonder JavaScript:
      ${privacyUrl}
- [ ] De ZIP nog één keer uitgepakt geladen en op alle drie de assistenten een
      zoekvraag gesteld, met de console open

## 1. Pakket

- [ ] Upload \`${zipName}\`

## 2. Store listing

| Veld | Bron |
| --- | --- |
| Naam | komt uit het pakket: \`${name}\` |
| Korte beschrijving | komt uit het pakket (\`teksten/02-korte-beschrijving.txt\`, ${short.length} tekens) |
| Uitgebreide beschrijving | \`teksten/03-uitgebreide-beschrijving.txt\` |
| Categorie | ${category} |
| Taal | ${language} |
| Store-icoon | \`beelden/icoon-128.png\` |
| Screenshots | ${SHOTS.map((f) => '`beelden/' + f + '`').join(', ')} |

- [ ] Uitgebreide beschrijving geplakt
- [ ] Categorie en taal gekozen
- [ ] Icoon en ${SHOTS.length} screenshots geüpload, in deze volgorde

## 3. Privacy practices

- [ ] Single purpose: \`teksten/04-single-purpose.txt\`
- [ ] Onderbouwing per recht: \`teksten/05-rechten.txt\` (${permissions.length} blokken, het
      dashboard vraagt ze per recht)
- [ ] Remote code: **Nee** — alle JavaScript zit in het pakket
- [ ] Privacybeleid-URL: \`teksten/06-privacybeleid-url.txt\`

### Welke data

Aanvinken wat de extensie verwerkt. Er wordt niets van het apparaat af verstuurd,
maar het dashboard vraagt naar verwerken, niet alleen naar versturen.

${dataLines.join('\n')}
${doubts.length ? `
De regels met [?] hangen af van wat de gebruiker zelf in een vraag typt. Dat is
een verklaring die jij als uitgever doet; de extensie zoekt er niet naar en
herkent het niet, maar bewaart wel de volledige vraag en het antwoord.
` : ''}
### Verklaringen

- [x] Ik verkoop geen gebruikersdata aan derden
- [x] Ik gebruik de data niet voor doelen buiten de kernfunctie
- [x] Ik gebruik de data niet voor kredietwaardigheid of leningen

## 4. Distributie

- [ ] Zichtbaarheid: ${visibility} — of Unlisted voor een eerste ronde met testers
- [ ] Regio's: alle

## 5. Account

${developer.map((r) => '- ' + r[0] + ': ' + r[1]).join('\n')}

## Na het indienen

- [ ] Status en datum bijgewerkt in \`CHROMEWEBSTORE.md\` (Version History)
- [ ] Bij een afwijzing: de reden letterlijk overgenomen onder Rejection History
`;
fs.writeFileSync(path.join(DIST, 'INDIENEN.md'), guide);

/* -------------------------------------------------------------- verslag */

function list(dir, prefix) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .reduce((acc, e) => acc.concat(e.isDirectory()
      ? list(path.join(dir, e.name), prefix + e.name + '/')
      : [prefix + e.name]), []);
}
console.log('\ndist/ — klaar voor versie ' + manifest.version);
list(DIST, '  ').forEach((f) => console.log(f));
if (doubts.length) {
  console.log('\nLet op: ' + doubts.length + ' datasoorten in de dataverklaring vragen jouw afweging (zie INDIENEN.md).');
}
console.log('\nBegin bij dist/INDIENEN.md.');
