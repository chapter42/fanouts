# Changelog

Alle noemenswaardige wijzigingen aan Fanouts. Opzet volgt
[Keep a Changelog](https://keepachangelog.com/nl/1.1.0/), versienummers volgen
[Semantic Versioning](https://semver.org/lang/nl/).

## [Unreleased]

### Toegevoegd
- CI op elke PR: `tools/check.js` en de testsuite op Node 20, 22 en 24, plus het
  bouwen van fixture en previews.
- `tools/check.js` — statische controle op de projectregels: geen dependencies,
  geen extra uitgaande aanroepen, geen `chrome.storage.sync`, geen extra
  permissies of host-matches, geen hardgecodeerde kleuren buiten de
  themavariabelen, versies gelijk in manifest en package, en de iconen die
  pixel-voor-pixel overeenkomen met hun generator.

## [0.3.1] — 2026-07-27

### Gewijzigd
- De knop **Sync** heet nu **Historie ophalen**. "Sync" suggereerde
  tweerichtingsverkeer naar een server, terwijl het eenrichtingsverkeer *van*
  ChatGPT naar je eigen schijf is. De tooltip zegt dat nu ook expliciet.
  Gedrag is ongewijzigd.

## [0.3.0] — 2026-07-27

### Toegevoegd
- **Licht thema**, nu de standaard. Donker blijft beschikbaar via de knop in het
  paneel (☾/☀) en in het dashboard; de keuze wordt bewaard in je instellingen.
- **Antwoordtekst in de exports.** De volledige gegenereerde tekst zit nu in de
  turns-CSV (kolom `antwoord`), de bronnen-CSV en het Markdown-rapport
  (als blockquote per turn). In de JSON-export zat hij al. Niets wordt afgekapt —
  daar is de inhoudelijke analyse juist op gebaseerd.
- Antwoord uitklapbaar op de turnkaarten in het dashboard.

### Gewijzigd
- Kleuren zijn nu volledig token-gedreven. Tinten en overlays worden met
  `color-mix()` uit de themakleuren afgeleid, zodat een thema uit een handvol
  basiskleuren bestaat in plaats van tientallen losse rgba-waarden.

### Opgelost
- **Balkvullingen waren onzichtbaar.** `.fill` en `.track` zijn `<span>`-elementen
  en dus inline; `width` en `height` werden genegeerd. Zat er sinds 0.1.0 in en
  viel niet op omdat de lege track op een donkere achtergrond op een dunne lijn lijkt.
- **Sticky tabelkop dekte de eerste rij af.** `.table-wrap` is door `overflow-x: auto`
  zelf de scroll-container, dus de sticky-offset gold t.o.v. die wrapper. De
  `top: 41px` duwde de kop over rij één heen. Zat er sinds 0.1.0 in.
- Vervolgvragen kregen ten onrechte een bronnenteller mee. Ze horen niet bij een
  tool-call — er is niet voor gezocht.
- De domeinen-CSV miste de `assistenten`-kolom door een patch die stil faalde.

## [0.2.0] — 2026-07-27

### Toegevoegd
- **Perplexity-ondersteuning.** SSE-stream op `/rest/sse/perplexity_ask`. Beide
  payloadvormen worden gedekt: de oudere met `step_type`-blokken in een
  JSON-in-JSON `text`-veld, en de nieuwere met `blocks`. Pro Search-stappen
  (`Searching for "…"`, `Zoeken naar …`) worden als queries herkend.
- **Gemini-ondersteuning.** Het `batchexecute`-protocol met positionele arrays
  zonder veldnamen. Extractie ankert op de `grounding-api-redirect`-URL's en op
  de `google.com/search?q=`-links achter de Google Search-chips.
- **Vervolgvragen** (Perplexity's "related") worden apart vastgelegd en tellen
  niet mee als fan-out.
- Dashboard-view **Per assistent**: onderlinge verhouding plus welke domeinen
  door meerdere assistenten worden geciteerd.
- Providerfilter en gekleurde providerbadges in paneel en dashboard.
- `provider`-kolom in alle CSV-exports en een providertabel in het Markdown-rapport.

### Gewijzigd
- De interceptor is een **provider-architectuur** geworden. `fetch`/`XHR` wordt
  nog één keer gepatcht; alles wat per assistent verschilt zit in
  `src/inject/providers/`. Een nieuwe assistent is één bestand plus een regel in
  het manifest.
- Turn-id's dragen nu een provider-prefix (`chatgpt:<conversatie>:<prompt>`).
  Turns die onder 0.1.0 zijn opgenomen krijgen bij een hercapture een nieuw id.

## [0.1.0] — 2026-07-27

Eerste versie. ChatGPT-only.

### Toegevoegd
- MAIN-world interceptor die de streaming POST naar `/backend-api/conversation`
  aftapt en ChatGPT's delta-encoding reconstrueert tot complete message-objecten,
  inclusief de "sticky path"-optimalisatie waarbij vervolg-events alleen `{v:"…"}`
  bevatten.
- Historie-route via de GET `/backend-api/conversation/<id>`, plus een
  knop die de huidige conversatie expliciet ophaalt.
- Extractie van fan-out queries, bronnen en citaties, met een deep-scan als
  vangnet voor formaatwijzigingen.
- Lokale entiteit-extractie (NL/EN) uit prompt, queries, antwoord en brontitels,
  met per entiteit de herkomst en de markering *door het model toegevoegd*.
- Queryclassificatie op token-overlap met de prompt plus intent-patronen.
- Zijpaneel met live weergave en dashboard met vijf views.
- Export naar JSON, Markdown en zes CSV-varianten.
- Instelling *mijn domeinen* voor share-of-voice-markering.
- Testsuite die de echte interceptor in een nagebootste browser draait.

[0.3.1]: https://github.com/chapter42/fanouts/releases/tag/v0.3.1
[0.3.0]: https://github.com/chapter42/fanouts/releases/tag/v0.3.0
[0.2.0]: https://github.com/chapter42/fanouts/releases/tag/v0.2.0
[0.1.0]: https://github.com/chapter42/fanouts/releases/tag/v0.1.0
