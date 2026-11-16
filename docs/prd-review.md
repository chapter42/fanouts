# Review van de PRD-update — getoetst aan de code

**Datum:** 10 augustus 2026 · **Betreft:** [prd-fanout-update.md](prd-fanout-update.md) · **Versie codebase:** 0.3.4

De PRD stelt in sectie 8 dat Q1 tot en met Q4 blokkerend zijn vóór Phase 1. Vier
vragen zijn uit de code te beantwoorden; twee niet. Hieronder staan de antwoorden
die ik kán geven, een gap-analyse per feature, en drie botsingen met bestaande
harde regels die vóór de build een besluit vragen.

**Wat hier níét in staat:** een verificatie van de cijfers uit de RESONEO-studie en
de Moz-dataset. Die heb ik niet nagelopen; ze komen uit de bronnen die de PRD
noemt en worden hier als gegeven behandeld.

---

## 1. Antwoorden op de blokkerende vragen

### Q1 — SSE-stream of DOM? → **SSE-stream. F1 t/m F3 zijn bouwbaar.**

Bevestigd in de code, niet uit het hoofd:

- [`src/inject/interceptor.js:87`](../src/inject/interceptor.js) patcht `window.fetch`,
  regel 120 patcht `XMLHttpRequest.prototype.send`
- vijf MAIN-world scripts op `run_at: document_start`
- **nul DOM-selectors** in de hele capture-laag (`src/inject/`) — er wordt geen
  `querySelector` of `getElementBy*` gebruikt

De PRD hoeft dus niet herschreven te worden als rebuild. Wel één nuance: we lezen
uitsluitend een *clone* van de response en wijzigen niets. Dat is harde regel 3 in
[CLAUDE.md](../CLAUDE.md) en moet zo blijven.

### Q3 — Publiceren in de Chrome Web Store? → **Ja, dat traject loopt al.**

[CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) is compleet, het privacybeleid staat live
op chapter42.com, en `npm run package` bouwt een schone ZIP. De permissieset en het
afwijzingspad zitten dus al in scope — precies zoals de PRD stelt.

Dit heeft één gevolg dat de PRD niet noemt: **F0 breidt de data-disclosure uit
nadat die is opgesteld maar vóórdat hij is ingediend.** Zie botsing 3.

### Q6 — Captures van vóór 21 juli 2026? → **Nee.**

De eerste commit in deze repo is van 27 juli 2026, ná de cut-off. Er is geen enkele
capture met een echte `result_source`-waarde.

Gevolg: **F1 kan niet gevalideerd worden.** De acceptatie-eis van ≥90% overeenkomst
is niet haalbaar en de classifier moet als *ongevalideerd* in de interface staan.
Dat is geen reden om hem niet te bouwen, wel om het label niet weg te laten.

### Q8 — Opslagplafond? → **Geen probleem. Gemeten, niet geschat.**

| Meting | Waarde |
| --- | --- |
| Gemiddelde turn | 7,8 KB |
| 800 turns (huidige limiet) | ≈ 6,1 MB |
| `unlimitedStorage` | aanwezig |

F0 voegt acht velden per rij toe, grofweg 200 byte — verwaarloosbaar. Archivering
hoeft niet naar Phase 1.

### Q2 en Q4 — deze kan ik niet beantwoorden

**Q2 (voor wie?)** — er is wel een aanwijzing: we hebben net een publieke
storelisting gebouwd, wat richting "publiek instrument" wijst. Maar dat is mijn
gevolgtrekking, niet jouw besluit. Het antwoord bepaalt of het dashboard überhaupt
nodig is (een klantdeliverable heeft genoeg aan F5 en F7).

**Q4 (ChatGPT of ook Gemini?)** — hier klopt de vraagstelling niet helemaal met de
werkelijkheid: **de extensie doet al ChatGPT, Perplexity én Gemini**, met een
provider-architectuur waarin een assistent één bestand is. De echte vraag is dus
niet of we Gemini toevoegen, maar of F1 t/m F5 — die ChatGPT-specifiek zijn —
alleen voor ChatGPT gelden terwijl de andere twee op het huidige niveau blijven.
Dat lijkt me verdedigbaar, maar het is jouw keuze en F0's schema hangt eraan.

---

## 2. Gap-analyse per feature

Wat er al is, wat ontbreekt, en of het bouwbaar is met hoe we vandaag vangen.

| Feature | Nu aanwezig | Ontbreekt | Oordeel |
| --- | --- | --- | --- |
| **F0** provenance | `createdAt`, `model`, `provider`, `source` | `account_id`, `plan`, `country`, `thinking_effort`, `parser_version`, `field_origin` | `parser_version` is triviaal. De rest raakt privacy — zie botsing 3 |
| **F1** engine-classifier | snippetlengte, titel, ellips-detectie mogelijk uit opgeslagen bronvelden | H1-anchoring | Grotendeels bouwbaar, **maar één signaal niet** — zie botsing 1 |
| **F2** funnel | *listed* (`search_result_groups`), *cited* (`content_references`), *opened* (tool-actie `open`) | *promoted* — het onderscheid top-sectie vs. overig leggen we niet vast | Bouwbaar; eerst nagaan of de stream promotie überhaupt prijsgeeft |
| **F3** rol + aard | grove herkomst: `search_results` / `citation` / `quote` | 7 rollen, 11 aarden, `ref_type` | `ref_type` gooien we mogelijk nu al weg. Uitzoeken vóór de bouw |
| **F4** layer-honest domeinen | domeintabel met share of voice | de laagselector | **Bouwbaar en de kritiek raakt ons direct** — onze huidige tabel mengt lagen precies zoals de PRD beschrijft |
| **F5** geopende pagina's | `open`-acties met ref_id/url | reconciliatie + `utm_present` | Bouwbaar, **maar we vernietigen het signaal nu actief** — zie botsing 2 |
| **F6** replay runs | — | alles | Nieuw concept, geen conflict |
| **F7** BigQuery NDJSON | JSON/CSV/Markdown-export | NDJSON + stabiel schema | Additief en klein |

---

## 3. Drie botsingen die vóór de build een besluit vragen

### Botsing 1 — F1's H1-signaal breekt de kernbelofte

Het signaal "snippet bevat de H1 van de pagina (~83%)" vereist dat we **de
brondpagina's zelf ophalen**. Dat zijn uitgaande aanroepen naar willekeurige
domeinen.

Dat botst met:

- harde regel 1 in [CLAUDE.md](../CLAUDE.md): alleen de twee same-origin fetches
- de belofte in [SECURITY.md](../SECURITY.md) en het live privacybeleid: *"er zijn
  geen andere bestemmingen"*
- `tools/check.js`, dat de build laat falen zodra er een aanroep bijkomt
- de `host_permissions`, die dit technisch onmogelijk maken zonder `<all_urls>` —
  en dat is een storeafwijzingsgrond op zichzelf

**Advies:** bouw F1 op de drie signalen die wél uit de stream komen (snippetlengte,
titeltruncatie, titel >75 tekens) en laat H1-anchoring vallen. De PRD wil "drie of
vier signalen scoren in plaats van één drempel" — met drie haal je dat doel, en de
extensie blijft wat ze belooft. Wil je H1-anchoring toch, dan hoort dat in een
server-side pipeline (C1-achtig), niet in de extensie.

### Botsing 2 — F5's `utm_present` gooien we nu weg

[`src/lib/parser.js:24`](../src/lib/parser.js) verwijdert `utm_source` en vijf
andere parameters uit elke URL voordat hij wordt opgeslagen:

```js
['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'oai']
  .forEach(function (p) { u.searchParams.delete(p); });
```

Dat is precies het onderscheid dat F5 nodig heeft: ChatGPT hangt
`utm_source=chatgpt.com` aan ~95% van de getoonde links, maar níét aan pagina's die
het zelf opende. Wij normaliseren dat verschil weg.

**Advies:** de vlag afleiden vóór het strippen en als veld bewaren. Kleine wijziging,
maar hij moet erin vóór er data wordt verzameld waarop je later wilt analyseren —
anders is elke bestaande capture waardeloos voor F5.

Dit is meteen het sterkste argument voor de volgorde in sectie 5: F0 en de
veldvastlegging eerst, want alles wat je nu níét opslaat, is achteraf niet te
reconstrueren.

### Botsing 3 — F0's `account_id`, `plan` en `country` openen een privacyhoofdstuk

Die drie vereisen dat we accountgegevens van de gebruiker lezen. Vandaag doen we dat
niet, en dat staat zo in het live privacybeleid: *"De extensie leest geen
DOM-inhoud, geen andere tabbladen, geen browsergeschiedenis, geen opgeslagen
wachtwoorden en geen cookies."*

Gevolgen als dit erin komt:

- [PRIVACY.md](../PRIVACY.md) en de live pagina op chapter42.com moeten mee
- [SECURITY.md](../SECURITY.md) idem
- de data-disclosure in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) krijgt er een
  categorie bij — en die is nog niet ingediend, dus dit kan nu nog goedkoop
- gehasht of niet, `account_id` is een pseudoniem identificatiemiddel

**Advies:** splits F0. `parser_version` en `field_origin` zijn puur intern en kunnen
meteen. `account_id`, `plan` en `country` zijn alleen zinvol als je meerdere
accounts naast elkaar draait (Q9: onderzoek publiceren). Hangt dat besluit nog, zet
ze dan achter een instelling die standaard uit staat, zodat de storelisting bij
indiening klopt.

---

## 4. Wat de PRD over het hoofd ziet

Twee dingen, ter overweging bij Q5.

**De positionering onderschat wat er al staat.** De PRD framet dit als
ChatGPT-concurrentie op capture-pariteit. Maar deze extensie doet al **drie
assistenten** en heeft **lokale entiteit-extractie** met het onderscheid tussen
"stond in je prompt" en "door het model zelf toegevoegd". Voor zover ik uit de PRD
kan opmaken heeft RESONEO geen van beide. De cross-assistent-vergelijking — welke
domeinen worden door meer dan één assistent geciteerd — is een laag die geen van de
genoemde bronnen levert. Dat is een sterker antwoord op Q5 dan de PRD zelf geeft.

**F4 raakt ons eigen dashboard.** De kritiek dat een top-domeinentabel zonder
laagselector "retrieval volume rapporteert en het zichtbaarheid noemt" is precies
wat onze tab *Bronnen & domeinen* nu doet. Dat is geen verwijt aan de PRD maar een
bevestiging: F4 is de meest waardevolle en tegelijk goedkoopste feature in de lijst,
en hij verbetert iets dat vandaag misleidend is.

---

## 5. Voorstel voor de volgorde

Afwijkend van sectie 5, en met een reden.

| Fase | Inhoud | Waarom |
| --- | --- | --- |
| **0** | `utm_present` bewaren (botsing 2), `parser_version` toevoegen | Beide zijn onomkeerbaar als je ze te laat doet: data die je nu niet opslaat komt niet terug. Klein, geen blokkerende vraag nodig |
| **1** | F4 laagselector | Grootste effect per regel code, corrigeert iets dat nu misleidend is, en heeft geen enkele blokkerende vraag nodig |
| **2** | F2 funnel, F3 labels | Nu pas, want ze bepalen wat de laagselector kan tonen |
| **3** | F1 classifier (drie signalen, ongevalideerd gelabeld), F5 | Na F3, want de rol-labels voeden de classifier |
| **4** | Rest van F0, F6, F7 | Vraagt eerst Q2, Q4 en Q9 |

Sectie 10 van de PRD vraagt: wat is de kleinste versie die volgende maand één
klantgesprek verandert? Mijn antwoord: **fase 0 en 1**. Dat is een paar dagen werk,
raakt geen enkele blokkerende vraag, en levert de zin op die sectie 7 als
succescriterium noemt — voor de lagen die we vandaag al vangen.

---

## 6. Wat ik nodig heb om te beginnen

1. **Q2** — persoonlijk instrument, klantdeliverable of publiek product?
2. **Q4** — blijven F1 t/m F5 ChatGPT-only terwijl Perplexity en Gemini op het
   huidige niveau blijven?
3. **Botsing 1** — akkoord dat H1-anchoring vervalt, of moet F1 wachten op een
   server-side pipeline?
4. **Botsing 3** — `account_id`/`plan`/`country` nu meenemen (en de storelisting
   aanpassen vóór indiening), of achter een uitgeschakelde instelling?

Fase 0 en 1 uit sectie 5 hierboven kan ik zonder die antwoorden bouwen. De rest
niet, en de PRD zegt dat zelf.
