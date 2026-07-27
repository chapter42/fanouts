/*
 * Maakt de screenshots voor de Chrome Web Store op exact 1280×800.
 *
 *   npm run screenshots
 *
 * Rendert de échte UI (dezelfde HTML, CSS en JS als de extensie) headless met de
 * Chrome die op deze machine staat, met de demo-fixture als inhoud. Er wordt niets
 * nagebouwd of geretoucheerd: wat je ziet komt uit dezelfde code die de gebruiker
 * draait. De inhoud is wel verzonnen — zie CHROMEWEBSTORE.md.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store-assets');
const TMP = path.join(ROOT, 'dev', '.shots');
const W = 1280;
const H = 800;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Geen Chrome gevonden. Installeer Chrome of pas CHROME_CANDIDATES aan.');
  process.exit(1);
}

/*
 * Wachten tot de UI klaar is. De preview laadt zijn data uit een nagebootste
 * chrome.storage; die promises zijn snel klaar, maar "snel" is geen garantie —
 * dus pollen we op een element dat er pas is als er echt gerenderd is.
 */
const BOOTSTRAP = `
<script>
(function () {
  function waitFor(fn, ms) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (ms || 8000);
      (function tick() {
        var v = fn();
        if (v || Date.now() > deadline) return resolve(v);
        setTimeout(tick, 60);
      })();
    });
  }
  window.__ready = (async function () {
    await waitFor(function () { return document.querySelector('__WAIT__'); });
    __ACTION__
    await waitFor(function () { return document.querySelector('__WAIT2__'); });
    await new Promise(function (r) { setTimeout(r, 350); });
    document.documentElement.setAttribute('data-shot-ready', '1');
  })();
})();
</script>`;

const SHOTS = [
  {
    file: '01-zijpaneel.png',
    base: 'panel-preview.html',
    caption: 'Zijpaneel: fan-out live per vraag',
    wait: '.turn',
    wait2: '.q-item',
    action: `
      var sel = document.querySelector('#scope');
      if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change')); }
      await waitFor(function () { return document.querySelectorAll('.turn').length > 2; });
      document.querySelectorAll('.turn')[1].querySelector('.turn-head').click();`,
    /*
     * Het paneel is smal; rechts uitlijnen laat het lezen als wat het is — een
     * paneel naast het gesprek. De vrije ruimte links krijgt een tekstannotatie
     * en nadrukkelijk géén nagebootste chatinterface: een screenshot mag niet
     * suggereren dat de extensie iets toont wat ze niet toont.
     */
    style: `
      body { max-width: none; border: 0;
             background: linear-gradient(135deg, #eef0f6 0%, #e3e7f1 100%); }
      body > header, body > main, body > footer {
        margin-left: auto; width: 500px;
        border-left: 1px solid var(--border);
      }
      main { background: var(--bg); }
      .shot-note {
        position: fixed; left: 64px; top: 50%; transform: translateY(-50%);
        width: 620px; font-family: var(--sans); color: #191c24;
      }
      .shot-note h1 { font-size: 40px; line-height: 1.15; letter-spacing: -0.025em;
                      font-weight: 640; margin: 0 0 18px; }
      .shot-note p { font-size: 17px; line-height: 1.55; color: #4a5162; margin: 0; max-width: 540px; }
      .shot-note .tag { display: inline-block; font-size: 12px; font-weight: 700;
                        letter-spacing: .09em; text-transform: uppercase;
                        color: #5b4ee0; margin-bottom: 14px; }`,
    inject: `
      <div class="shot-note">
        <span class="tag">Zijpaneel</span>
        <h1>De zoekopdrachten achter elk antwoord</h1>
        <p>ChatGPT, Perplexity en Gemini formuleren zelf meerdere zoekopdrachten uit jouw
        vraag. Fanouts legt ze live vast — met het type, de bronnen die eruit kwamen en
        de merken die erin voorkomen.</p>
      </div>`
  },
  {
    file: '02-fanout-queries.png',
    base: 'dashboard-preview.html',
    caption: 'Dashboard: alle zoekopdrachten met hun type',
    wait: 'tbody tr',
    wait2: 'tbody tr',
    action: `document.querySelector('[data-view="queries"]').click();`
  },
  {
    file: '03-entiteiten.png',
    base: 'dashboard-preview.html',
    caption: 'Entiteiten, met ✦ voor wat het model zelf toevoegde',
    wait: 'tbody tr',
    wait2: 'tbody tr',
    action: `document.querySelector('[data-view="entities"]').click();`
  },
  {
    file: '04-per-assistent.png',
    base: 'dashboard-preview.html',
    caption: 'Vergelijking tussen de drie assistenten',
    wait: 'tbody tr',
    wait2: 'tbody tr',
    action: `document.querySelector('[data-view="providers"]').click();`
  },
  {
    file: '05-bronnen.png',
    base: 'dashboard-preview.html',
    caption: 'Welke domeinen worden aangehaald',
    wait: 'tbody tr',
    wait2: 'tbody tr',
    action: `document.querySelector('[data-view="domains"]').click();`
  }
];

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

SHOTS.forEach(function (shot) {
  const src = path.join(ROOT, 'dev', shot.base);
  if (!fs.existsSync(src)) {
    console.error('Ontbreekt: ' + shot.base + ' — draai eerst `npm run preview`.');
    process.exit(1);
  }

  let html = fs.readFileSync(src, 'utf8');
  // De preview verwijst relatief naar ../src; vanuit dev/.shots is dat een niveau dieper.
  html = html.replace(/(["'])\.\.\/src\//g, '$1../../src/');
  html = html.replace(/(["'])chrome-stub\.js/g, '$1../chrome-stub.js');

  const boot = BOOTSTRAP
    .replace('__WAIT__', shot.wait)
    .replace('__WAIT2__', shot.wait2)
    .replace('__ACTION__', shot.action || '');

  if (shot.style) html = html.replace('</head>', '<style>' + shot.style + '</style></head>');
  if (shot.inject) html = html.replace('<body>', '<body>' + shot.inject);
  html = html.replace('</body>', boot + '</body>');

  const tmpFile = path.join(TMP, shot.file.replace('.png', '.html'));
  fs.writeFileSync(tmpFile, html);

  const outFile = path.join(OUT, shot.file);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=' + W + ',' + H,
    '--virtual-time-budget=6000',
    '--screenshot=' + outFile,
    'file://' + tmpFile
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const buf = fs.readFileSync(outFile);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== W || h !== H) {
    console.error(`${shot.file}: ${w}×${h} in plaats van ${W}×${H}`);
    process.exit(1);
  }
  console.log(`  ✓ ${shot.file}  ${w}×${h}  ${(buf.length / 1024).toFixed(0)} KB  — ${shot.caption}`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + SHOTS.length + ' screenshots in store-assets/');
console.log('Controleer ze zelf voordat je ze uploadt — zie CHROMEWEBSTORE.md.');
