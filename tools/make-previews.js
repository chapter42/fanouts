/* Genereert dev/*-preview.html uit de echte extensie-HTML (dev-only). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const fixture = fs.readFileSync(path.join(ROOT, 'dev/fixture.json'), 'utf8');
// Cache-buster: zonder dit blijft de browser de vorige CSS/JS serveren en
// kijk je naar een oude build terwijl je denkt de wijziging te beoordelen.
const V = String(Math.max(...['src/shared/ui.css', 'src/dashboard/dashboard.css', 'src/dashboard/dashboard.js',
  'src/panel/panel.css', 'src/panel/panel.js', 'src/lib/analysis.js', 'src/lib/parser.js',
  'src/lib/entities.js', 'src/lib/exporter.js', 'src/lib/store.js']
  .map((f) => fs.statSync(path.join(ROOT, f)).mtimeMs)));

function bodyOf(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return /<body>([\s\S]*?)<script/.exec(html)[1].trim();
}

function build(name, body, cssHref, jsHref, extraCss) {
  return `<!doctype html>
<html lang="nl" data-theme="light">
<head>
<meta charset="utf-8">
<title>Fanouts dev — ${name}</title>
<link rel="stylesheet" href="../src/shared/ui.css?v=${V}">
<link rel="stylesheet" href="${cssHref}?v=${V}">
${extraCss || ''}
</head>
<body>
${body}
<script>window.__FANOUT_FIXTURE__ = ${fixture};</script>
<script src="chrome-stub.js"></script>
<script src="../src/lib/parser.js?v=${V}"></script>
<script src="../src/lib/entities.js?v=${V}"></script>
<script src="../src/lib/analysis.js?v=${V}"></script>
<script src="../src/lib/exporter.js?v=${V}"></script>
<script src="../src/lib/store.js?v=${V}"></script>
<script src="${jsHref}?v=${V}"></script>
</body>
</html>`;
}

fs.writeFileSync(path.join(ROOT, 'dev/panel-preview.html'), build(
  'paneel', bodyOf('src/panel/panel.html'), '../src/panel/panel.css', '../src/panel/panel.js',
  '<style>body{max-width:400px;margin:0 auto;border-left:1px solid #24262f;border-right:1px solid #24262f}</style>'));

fs.writeFileSync(path.join(ROOT, 'dev/dashboard-preview.html'), build(
  'dashboard', bodyOf('src/dashboard/dashboard.html'), '../src/dashboard/dashboard.css', '../src/dashboard/dashboard.js'));

console.log('dev/panel-preview.html en dev/dashboard-preview.html geschreven');
