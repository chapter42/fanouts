/*
 * Statische controles op de projectregels uit CLAUDE.md.
 *
 * De testsuite bewaakt gedrag; dit bewaakt de afspraken die je niet met een unit
 * test vangt — geen dependencies, geen extra netwerkaanroepen, geen
 * storage.sync, geen hardgecodeerde kleuren buiten het thema. Dat zijn precies
 * de dingen die SECURITY.md aan gebruikers belooft.
 *
 *   node tools/check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  \x1b[32m✓\x1b[0m ' + label); return true; }
  failures++;
  console.log('  \x1b[31m✗\x1b[0m ' + label + (detail !== undefined ? '\n      → ' + detail : ''));
  return false;
}

function section(name) { console.log('\n\x1b[1m' + name + '\x1b[0m'); }

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

function walk(dir, ext, out) {
  out = out || [];
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(function (e) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, ext, out);
    else if (e.name.endsWith(ext)) out.push(rel);
  });
  return out;
}

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const srcJs = walk('src', '.js');
const srcCss = walk('src', '.css');

/* ===================================================================== */
section('1. Bestandsverwijzingen');

const manifestRefs = [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page]
  .concat(Object.values(manifest.icons))
  .concat(manifest.content_scripts.reduce(function (a, c) { return a.concat(c.js); }, []));

const missingManifest = manifestRefs.filter(function (r) { return !exists(r); });
ok(missingManifest.length === 0, manifestRefs.length + ' verwijzingen in manifest.json bestaan', missingManifest.join(', '));

const htmlMissing = [];
['src/panel/panel.html', 'src/dashboard/dashboard.html'].forEach(function (f) {
  const html = read(f);
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/^(https?:|data:|#)/.test(m[1])) continue;
    const target = path.normalize(path.join(path.dirname(f), m[1]));
    if (!exists(target)) htmlMissing.push(f + ' → ' + m[1]);
  }
});
ok(htmlMissing.length === 0, 'alle script- en stylesheet-verwijzingen in de HTML bestaan', htmlMissing.join(', '));

const docMissing = [];
['README.md', 'CLAUDE.md', 'SECURITY.md', 'CHANGELOG.md']
  .concat(exists('docs') ? walk('docs', '.md') : [])
  .forEach(function (f) {
  if (!exists(f)) return;
  const re = /\]\((?!https?:|#|mailto:)([^)]+)\)/g;
  let m;
  const text = read(f);
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/#.*$/, '').replace(/\/$/, '');
    if (!raw) continue;
    const target = path.normalize(path.join(path.dirname(f), raw));
    if (!exists(target)) docMissing.push(f + ' → ' + m[1]);
  }
});
ok(docMissing.length === 0, 'alle interne links in de documentatie bestaan', docMissing.join(', '));

/* ===================================================================== */
section('2. Syntaxis');

// vm.Script compileert zonder uit te voeren — precies wat een syntaxcheck nodig
// heeft, en explicieter dan new Function() misbruiken.
const syntaxErrors = [];
srcJs.concat(walk('tools', '.js')).forEach(function (f) {
  try { new vm.Script(read(f), { filename: f }); } catch (e) { syntaxErrors.push(f + ': ' + e.message); }
});
ok(syntaxErrors.length === 0, srcJs.length + ' bronbestanden parsen zonder fout', syntaxErrors.join('; '));

/* ===================================================================== */
section('3. Laadvolgorde en providers');

const mainWorld = manifest.content_scripts.filter(function (c) { return c.world === 'MAIN'; })[0];
ok(!!mainWorld, 'er is een MAIN-world content script');

if (mainWorld) {
  ok(/util\.js$/.test(mainWorld.js[0]), 'util.js wordt als eerste geladen', mainWorld.js[0]);
  ok(/interceptor\.js$/.test(mainWorld.js[mainWorld.js.length - 1]),
    'interceptor.js wordt als laatste geladen', mainWorld.js[mainWorld.js.length - 1]);

  const onDisk = walk('src/inject/providers', '.js').sort();
  const inManifest = mainWorld.js.filter(function (f) { return f.indexOf('providers/') !== -1; }).sort();
  ok(onDisk.length === inManifest.length && onDisk.every(function (f, i) { return f === inManifest[i]; }),
    'elke provider op schijf staat in het manifest',
    'schijf: ' + onDisk.join(', ') + ' | manifest: ' + inManifest.join(', '));

  const iface = ['id', 'matchesHost', 'match', 'promptFromRequest', 'consumeStream'];
  const incomplete = [];
  onDisk.forEach(function (f) {
    const src = read(f);
    iface.forEach(function (k) {
      if (src.indexOf(k) === -1) incomplete.push(f + ' mist ' + k);
    });
  });
  ok(incomplete.length === 0, 'elke provider implementeert de kern van de interface', incomplete.join(', '));
}

/* ===================================================================== */
section('4. Harde regels uit CLAUDE.md');

// 4a. Geen dependencies — de extensie moet zonder build-stap laadbaar blijven.
const deps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
ok(deps.length === 0, 'geen npm-dependencies', deps.join(', '));

// 4b. Nooit chrome.storage.sync — dat zou gespreksdata naar het Google-account sturen.
const syncUse = srcJs.filter(function (f) { return /chrome\.storage\.sync/.test(read(f)); });
ok(syncUse.length === 0, 'nergens chrome.storage.sync', syncUse.join(', '));

/*
 * 4c. Uitgaande aanroepen.
 * Alleen de twee same-origin fetches achter "Historie ophalen" mogen een request
 * starten. De interceptor roept `originalFetch` aan — dat is de aanroep van de
 * pagina zelf, doorgegeven, geen nieuwe. Groeit deze lijst, dan is dat een
 * bewuste keuze die je hier expliciet moet maken.
 */
const ALLOWED_CALLS = [
  { file: 'src/content/content.js', pattern: "fetch('/api/auth/session'" },
  { file: 'src/content/content.js', pattern: "fetch('/backend-api/conversation/'" }
];
const NETWORK = /\bfetch\s*\(|navigator\.sendBeacon|new\s+WebSocket|new\s+EventSource|\bimport\s*\(/g;
const unexpected = [];
srcJs.forEach(function (f) {
  const src = read(f);
  src.split('\n').forEach(function (line, i) {
    NETWORK.lastIndex = 0;
    if (!NETWORK.test(line)) return;
    // De patch zelf en het doorgeven van de originele fetch tellen niet mee.
    if (/originalFetch|window\.fetch\s*=|var originalFetch|XhrOpen|XhrSend/.test(line)) return;
    const allowed = ALLOWED_CALLS.some(function (a) { return a.file === f && line.indexOf(a.pattern) !== -1; });
    if (!allowed) unexpected.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 80));
  });
});
ok(unexpected.length === 0, 'geen andere uitgaande aanroepen dan de twee toegestane', unexpected.join(' | '));

// 4d. Host-permissies mogen niet ongemerkt uitbreiden.
const EXPECTED_HOSTS = [
  'https://chatgpt.com/*', 'https://chat.openai.com/*',
  'https://www.perplexity.ai/*', 'https://perplexity.ai/*',
  'https://gemini.google.com/*'
];
const extraHosts = manifest.host_permissions.filter(function (h) { return EXPECTED_HOSTS.indexOf(h) === -1; });
ok(extraHosts.length === 0, 'geen onverwachte host_permissions', extraHosts.join(', '));
manifest.content_scripts.forEach(function (c, i) {
  const extra = c.matches.filter(function (h) { return EXPECTED_HOSTS.indexOf(h) === -1; });
  ok(extra.length === 0, 'content script ' + i + ' draait alleen op de bekende hosts', extra.join(', '));
});

const EXPECTED_PERMS = ['storage', 'unlimitedStorage', 'sidePanel', 'tabs'];
const extraPerms = manifest.permissions.filter(function (p) { return EXPECTED_PERMS.indexOf(p) === -1; });
ok(extraPerms.length === 0, 'geen onverwachte permissies', extraPerms.join(', '));

// 4e. Het zijpaneel is alleen via de actieknop te openen. Valt die ene route
// weg, dan is de extensie onbruikbaar — dus moet er een tweede zijn.
const sw = read(manifest.background.service_worker);
ok(/setPanelBehavior/.test(sw) && /action\.onClicked/.test(sw),
  'zijpaneel heeft twee openingsroutes (setPanelBehavior + action.onClicked)');
ok(/openPanelOnActionClick/.test(sw) && !/openPanelOnActionIconClick/.test(sw),
  'setPanelBehavior gebruikt openPanelOnActionClick, niet de Icon-variant');
ok(!manifest.action || !manifest.action.default_popup,
  'geen default_popup naast setPanelBehavior — die zou onClicked blokkeren');

/*
 * 4f. Async-stijl. Chrome's eigen richtlijn is expliciet: async/await, geen
 * .then()-ketens. De uitzondering is de fetch-wrapper, die de response bewust
 * ongeawait doorgeeft zodat het meelezen de host-app niet kan vertragen.
 */
const THEN_ALLOWLIST = [
  { file: 'src/inject/interceptor.js', pattern: 'pending.then(' }
];
const strayThen = [];
srcJs.forEach(function (f) {
  read(f).split('\n').forEach(function (line, i) {
    if (line.indexOf('.then(') === -1) return;
    const allowed = THEN_ALLOWLIST.some(function (a) { return a.file === f && line.indexOf(a.pattern) !== -1; });
    if (!allowed) strayThen.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 70));
  });
});
ok(strayThen.length === 0, 'async/await in plaats van .then()-ketens', strayThen.join(' | '));

/* ===================================================================== */
section('5. Thema-discipline');

/*
 * Kleuren horen als token in het :root-blok van ui.css. Een hardgecodeerde hex
 * elders werkt per definitie maar in één thema — dat is precies hoe het lichte
 * thema aanvankelijk brak.
 */
const HEX_ALLOWLIST = { '#fff': 1 };  // witte tekst op de accentknop

function hexOutsideRoot(file) {
  const lines = read(file).split('\n');
  const out = [];
  let depth = 0;
  let inRoot = false;
  lines.forEach(function (line, i) {
    const startsRoot = /:root[^{]*\{/.test(line);
    if (startsRoot && depth === 0) inRoot = true;
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    const depthBefore = depth;
    depth += opens - closes;
    if (!(inRoot && depthBefore + opens > 0)) {
      (line.match(/#[0-9a-fA-F]{3,8}\b/g) || []).forEach(function (hex) {
        if (!HEX_ALLOWLIST[hex.toLowerCase()]) out.push(file + ':' + (i + 1) + ' ' + hex);
      });
    }
    if (depth <= 0) { depth = 0; inRoot = false; }
  });
  return out;
}

const strayHex = [];
srcCss.forEach(function (f) {
  if (f === 'src/shared/ui.css') strayHex.push.apply(strayHex, hexOutsideRoot(f));
  else {
    read(f).split('\n').forEach(function (line, i) {
      (line.match(/#[0-9a-fA-F]{3,8}\b/g) || []).forEach(function (hex) {
        if (!HEX_ALLOWLIST[hex.toLowerCase()]) strayHex.push(f + ':' + (i + 1) + ' ' + hex);
      });
    });
  }
});
ok(strayHex.length === 0, 'geen hardgecodeerde kleuren buiten de themavariabelen', strayHex.join(' | '));

const themedRoots = (read('src/shared/ui.css').match(/:root/g) || []).length;
ok(themedRoots >= 2, 'ui.css definieert een licht én een donker thema', themedRoots + ' :root-blokken');

/* ===================================================================== */
section('6. Versie en changelog');

ok(manifest.version === pkg.version,
  'versie gelijk in manifest.json en package.json',
  'manifest ' + manifest.version + ' vs package ' + pkg.version);
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'versie volgt semver', manifest.version);

const changelog = read('CHANGELOG.md');
ok(changelog.indexOf('## [Unreleased]') !== -1, 'CHANGELOG heeft een Unreleased-kop');
ok(changelog.indexOf('## [' + manifest.version + ']') !== -1,
  'huidige versie staat in de CHANGELOG', manifest.version);

/* ===================================================================== */
section('7. Chrome Web Store');

// De storelistering kapt de korte beschrijving af op 132 tekens; manifest.json
// is de bron daarvoor. Stond er eerst op 174 en dat viel pas op bij het
// voorbereiden van de indiening.
ok(manifest.description.length <= 132,
  'manifest-beschrijving past binnen de storelimiet',
  manifest.description.length + ' tekens (max 132)');
ok(manifest.name.length <= 75, 'extensienaam past binnen de storelimiet',
  manifest.name.length + ' tekens (max 75)');

// Merknamen in de extensienaam zijn een bekende afwijzingsgrond; in de
// beschrijving is nominatief gebruik wel toegestaan.
const BRANDS = /\b(ChatGPT|OpenAI|Perplexity|Gemini|Google)\b/i;
ok(!BRANDS.test(manifest.name), 'geen merknaam in de extensienaam', manifest.name);

ok(exists('CHROMEWEBSTORE.md') && exists('PRIVACY.md'),
  'storelistering en privacybeleid aanwezig');
if (exists('CHROMEWEBSTORE.md')) {
  const cws = read('CHROMEWEBSTORE.md');
  ok(cws.indexOf(manifest.version) !== -1,
    'CHROMEWEBSTORE.md noemt de huidige versie', manifest.version);
  ok(cws.indexOf(manifest.description) !== -1,
    'korte beschrijving in CHROMEWEBSTORE.md is gelijk aan die in het manifest');
}

/* ===================================================================== */
section('8. Iconen');

/*
 * De iconen zijn gegenereerd; ze horen overeen te komen met wat make-icons.js
 * tekent. Byte-vergelijking werkt daarvoor niet: zlib comprimeert per platform
 * net anders, dus dezelfde pixels leveren op Linux een andere PNG op dan op
 * macOS. We vergelijken daarom de gedecodeerde pixels.
 */
function decodePng(buf) {
  const zlib = require('zlib');
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('geen PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colourType !== 6) throw new Error('verwacht 8-bit RGBA');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;      // links
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;          // boven
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error('onbekend filter ' + filter);
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width: width, height: height, pixels: out };
}

const icons = require('./make-icons');
const iconMismatch = [];
icons.SIZES.forEach(function (size) {
  const file = 'icons/icon' + size + '.png';
  if (!exists(file)) { iconMismatch.push(file + ' ontbreekt'); return; }
  try {
    const onDisk = decodePng(fs.readFileSync(path.join(ROOT, file)));
    const fresh = decodePng(icons.draw(size));
    if (onDisk.width !== size || onDisk.height !== size) {
      iconMismatch.push(file + ' is ' + onDisk.width + 'x' + onDisk.height);
    } else if (!onDisk.pixels.equals(fresh.pixels)) {
      let diff = 0;
      for (let i = 0; i < fresh.pixels.length; i++) if (fresh.pixels[i] !== onDisk.pixels[i]) diff++;
      iconMismatch.push(file + ': ' + diff + ' bytes afwijkend');
    }
  } catch (e) {
    iconMismatch.push(file + ': ' + e.message);
  }
});
ok(iconMismatch.length === 0,
  icons.SIZES.length + ' iconen komen pixel-voor-pixel overeen met de generator',
  iconMismatch.join(', '));

/* ===================================================================== */
console.log('\n' + (failures === 0
  ? '\x1b[32m' + checks + '/' + checks + ' controles geslaagd\x1b[0m'
  : '\x1b[31m' + failures + ' van ' + checks + ' controles gefaald\x1b[0m'));
process.exit(failures === 0 ? 0 : 1);
