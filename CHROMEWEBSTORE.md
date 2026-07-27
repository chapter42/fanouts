# Chrome Web Store Listing — Fanouts

> Last Updated: 2026-07-27 · Extensieversie 0.3.4 · **nog niet ingediend**

Dit bestand is de bron voor alles wat je in het Chrome Developer Dashboard moet
invullen. Het wordt **niet** meegeleverd in het ZIP-bestand.

---

## Store Listing

**Extension Name**
`Fanouts — AI query fan-out monitor` (34 tekens)

Merknamen staan bewust **niet** in de naam. Nominatief gebruik in de beschrijving
("werkt op ChatGPT") is gangbaar en toegestaan; een merknaam in de extensienaam is
een bekende afwijzingsgrond.

**Short Description** (max 132)
```
Zie welke zoekopdrachten ChatGPT, Perplexity en Gemini voor jouw vraag uitvoeren. Bronnen en entiteiten erbij, alles lokaal.
```
124 tekens. Identiek aan `description` in `manifest.json`.

**Detailed Description**

De Chrome Web Store stript opmaak — dit is platte tekst met regeleindes.

```
Als je een AI-assistent een vraag stelt die het web raakt, formuleert het model
daar zelf meerdere zoekopdrachten voor. Die zie je normaal niet. Fanouts legt ze
vast, samen met de bronnen die eruit kwamen en de merken en begrippen die erin
voorkomen.

WAT JE ZIET
• De zoekopdrachten achter elk antwoord, met hun type: herformulering,
  vergelijking, prijsvraag, actualiteit
• Welke websites zijn geraadpleegd en welke daarvan daadwerkelijk zijn geciteerd
• Welke merken, producten en plaatsen voorkomen — en welke daarvan de assistent
  zélf toevoegde, terwijl ze niet in jouw vraag stonden
• De volledige antwoordtekst, doorzoekbaar naast de rest
• Een overzicht over alle gesprekken heen: welke domeinen het vaakst worden
  aangehaald, en welke door meer dan één assistent

HOE JE HET GEBRUIKT
1. Klik op het Fanouts-icoon in je werkbalk om het zijpaneel te openen
2. Stel op ChatGPT, Perplexity of Gemini een vraag waarvoor het web geraadpleegd
   wordt — de zoekopdrachten verschijnen live in het paneel
3. Open het dashboard voor de analyse over alle gesprekken heen
4. Exporteer naar JSON, CSV of Markdown

VOOR WIE
Voor iedereen die wil weten hoe AI-assistenten aan hun informatie komen. Werk je
aan de vindbaarheid van een website, dan vul je je eigen domeinen in en zie je
per vraag of je wordt aangehaald.

PRIVACY
Alles blijft op je eigen computer. Er is geen server, geen account, geen
analytics en geen telemetrie. Je gesprekken worden lokaal opgeslagen en nooit
verstuurd. Je kunt de opname pauzeren en alles met één klik wissen.

De enige uitzondering is de knop "Historie ophalen": die vraagt bij ChatGPT jouw
eigen gesprek op zodat oudere vragen alsnog in het overzicht komen. Dat is een
download naar je eigen schijf, geen upload.

RECHTEN
• Toegang tot chatgpt.com, perplexity.ai en gemini.google.com — om mee te lezen
  met de antwoorden die je daar toch al krijgt. Andere websites worden niet
  benaderd.
• Opslag — om het overzicht op je eigen computer te bewaren.
• Tabbladen — om te weten welk gesprek open staat wanneer je op "Historie
  ophalen" klikt.

De volledige broncode is openbaar: https://github.com/chapter42/fanouts

SUPPORT
Vragen of een bug gevonden? https://github.com/chapter42/fanouts/issues of
roy@chapter42.com
```

**Category**
Developer Tools

*Overwogen:* Productivity. Developer Tools past beter — het is een analyse-instrument,
geen dagelijkse workflow-tool.

**Single Purpose**
```
Legt de zoekopdrachten vast die een AI-assistent uitvoert voor jouw vraag, en
maakt ze doorzoekbaar en exporteerbaar.
```

**Primary Language**
Nederlands

De interface, de exports en deze listing zijn Nederlands. Een Engelse listing bij
een Nederlandse interface levert teleurgestelde installaties en slechte reviews op.
Wil je internationaal, lokaliseer dan eerst de interface.

---

## Graphics & Assets

| Asset | Afmeting | Status | Bestand |
|---|---|---|---|
| Store Icon | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 | 1280×800 | ✅ Ready | `store-assets/01-zijpaneel.png` |
| Screenshot 2 | 1280×800 | ✅ Ready | `store-assets/02-fanout-queries.png` |
| Screenshot 3 | 1280×800 | ✅ Ready | `store-assets/03-entiteiten.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-assets/04-per-assistent.png` |
| Screenshot 5 | 1280×800 | ✅ Ready | `store-assets/05-bronnen.png` |
| Small Promo Tile | 440×280 | ⬜ Not created | optioneel, voor featured placement |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | optioneel |

### Screenshot Notes

Eén screenshot is verplicht, vier is beter. Wat ze moeten laten zien:

1. **Het paneel in actie** — naast een echt ChatGPT-gesprek, met de fan-out
   zichtbaar. Dit is de kernbelofte; laat de extensie werken, niet stilstaan.
2. **Fan-out queries** — de tabel met type en overlap. Toont de analyse.
3. **Entiteiten** — met de ✦-markering voor wat het model zelf toevoegde. Dat is
   het meest onderscheidende idee en verdient een eigen beeld.
4. **Per assistent** — de tabel met domeinen die door meerdere assistenten worden
   geciteerd.

### Hoe ze gemaakt zijn

```bash
npm run screenshots
```

Rendert de **echte** UI headless op exact 1280×800 — dezelfde HTML, CSS en JavaScript
die de gebruiker draait, met de demo-fixture als inhoud. Er wordt niets nagebouwd of
geretoucheerd.

**De inhoud is verzonnen.** De vragen over CRM-systemen, laadpalen en AI-zichtbaarheid
komen uit `tools/make-fixture.js`. Wat je ziet is echte uitvoer van echte code op
synthetische invoer — geen mockup van functies die niet bestaan, en dat is waar
"no misleading screenshots" over gaat. Toch: heb je vier eigen gesprekken die je
openbaar durft te tonen, dan zijn die overtuigender. Let dan op klantnamen en interne
informatie, want een screenshot is openbaar.

Op de paneelscreenshot staat links een tekstannotatie op een neutrale achtergrond.
Bewust geen nagebootste chatinterface: dat zou suggereren dat de extensie iets toont
wat ze niet toont.

---

## Permissions Justification

Elke regel wordt door het reviewteam gelezen. "Nodig voor de werking" wordt afgewezen.

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Bewaart de vastgelegde gesprekken, de gevonden zoekopdrachten en de instellingen van de gebruiker op het apparaat zelf. Zonder opslag is er niets terug te kijken en gaat alles verloren zodra het tabblad sluit. |
| `unlimitedStorage` | permissions | Een gesprek met veel webresultaten levert al snel honderden kilobytes aan zoekopdrachten, bron-URL's en antwoordtekst op. De standaardlimiet van 5 MB is na enkele tientallen gesprekken vol, waarna de gebruiker zonder waarschuwing data zou verliezen. |
| `sidePanel` | permissions | De kernfunctie is een zijpaneel dat meeloopt met het gesprek, zodat de gebruiker de zoekopdrachten ziet verschijnen zonder de pagina te verlaten. |
| `tabs` | permissions | Alleen om te bepalen welk van de ondersteunde tabbladen actief is wanneer de gebruiker op *Historie ophalen* klikt, zodat het juiste gesprek wordt opgehaald. `activeTab` volstaat hier niet: die werkt niet bij een klik in een zijpaneel. Er wordt geen browsergeschiedenis gelezen en er worden geen andere tabbladen benaderd. |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | host_permissions | Om mee te lezen met de antwoorden die de gebruiker zelf opvraagt en daaruit de uitgevoerde zoekopdrachten en geraadpleegde bronnen te halen. Ook nodig voor *Historie ophalen*, dat het eigen gesprek van de gebruiker bij ChatGPT opvraagt. |
| `https://www.perplexity.ai/*`, `https://perplexity.ai/*` | host_permissions | Zelfde functie voor Perplexity: de zoekopdrachten en bronnen uit het antwoord halen. Beide vormen zijn nodig omdat de site vanaf beide adressen werkt. |
| `https://gemini.google.com/*` | host_permissions | Zelfde functie voor Gemini. |

Er is bewust **geen** `<all_urls>`, `webRequest`, `cookies`, `history` of `identity`.
De extensie werkt op precies vijf adressen en nergens anders.

---

## Privacy & Data Use

### Data Collection

**Verzamelt de extensie gebruikersdata?**

**Nee** in de zin die de Chrome Web Store hanteert: er wordt niets van het apparaat
af verstuurd. Alles staat in `chrome.storage.local` en verlaat de computer niet.

Er wordt wél gevoelige inhoud *verwerkt* en lokaal *bewaard*. Onderstaande tabel is
daar expliciet over — bij twijfel is te veel disclosure altijd veiliger dan te weinig.

| Data Type | Verwerkt? | Off-device verstuurd? | Doel | Gedeeld met derden? |
|---|---|---|---|---|
| Personally identifiable info | Alleen als de gebruiker dit zelf in een vraag typt | Nee | — | Nee |
| Health info | Idem | Nee | — | Nee |
| Financial info | Idem | Nee | — | Nee |
| Authentication info | Ja, kortstondig | Nee | Het bestaande ChatGPT-sessietoken wordt alleen bij een klik op *Historie ophalen* gelezen en direct in de `Authorization`-header van die ene aanroep naar ChatGPT zelf gebruikt. Het wordt niet opgeslagen, gelogd of doorgegeven. | Nee |
| Personal communications | Ja | Nee | De vragen van de gebruiker en de antwoorden van de assistent vormen het overzicht. | Nee |
| Location | Nee | Nee | — | Nee |
| Web history | Nee | Nee | De browsergeschiedenis wordt niet gelezen. Wel worden de URL's bewaard die de assistent zelf aanhaalde. | Nee |
| User activity | Ja | Nee | Welke vraag wanneer is gesteld, om het overzicht chronologisch te tonen. | Nee |
| Website content | Ja | Nee | Titels, snippets en URL's van de bronnen die de assistent raadpleegde. | Nee |

### Data Use Certification

- [x] Data wordt NIET verkocht aan derden
- [x] Data wordt NIET gebruikt voor doelen buiten de kernfunctie
- [x] Data wordt NIET gebruikt voor kredietwaardigheid of leningen

### Uitgaande aanroepen — volledig

Twee, allebei same-origin naar ChatGPT, allebei alleen na een klik op
*Historie ophalen*:

| Aanroep | Waarvoor |
|---|---|
| `GET /api/auth/session` | het bestaande sessietoken van de gebruiker ophalen |
| `GET /backend-api/conversation/<id>` | het eigen gesprek van de gebruiker ophalen |

Verder niets. Geen analytics, geen telemetrie, geen foutrapportage, geen CDN.
`tools/check.js` dwingt dit machinaal af en faalt de build als er een aanroep
bijkomt.

---

## Privacy Policy

**Privacy Policy URL** — ✅ live

```
https://www.chapter42.com/privacybeleid-fanouts/
```

Geverifieerd op 27 juli 2026: HTTP 200, en alle secties uit de brontekst staan erop.

⚠️ **Eén punt om te regelen.** Cloudflare's e-mailverhulling maakt van het
contactadres letterlijk `[email protected]` in de HTML; pas JavaScript vult het echte
adres in. Een reviewer die de pagina in een browser bekijkt ziet het goed, maar wie
hem zonder JavaScript ophaalt leest een tekst die op een niet-ingevulde placeholder
lijkt — en "geen contactgegevens" is een afwijzingsgrond. Los dit op met één van:

- Cloudflare → Scrape Shield → *Email Address Obfuscation* uitzetten voor deze pagina
- het adres erbij zetten in een vorm die Cloudflare niet herschrijft (`roy [at] chapter42.com`)
- een gewone link naar `https://www.chapter42.com/contact/` toevoegen

De bronversie staat als [`store-assets/privacy.html`](store-assets/privacy.html):
één zelfstandig bestand zonder externe fonts, stylesheets of scripts.

De brontekst staat óók in [PRIVACY.md](PRIVACY.md), versiebeheerd naast de code zodat
hij niet uit de pas kan lopen met wat de extensie doet. **Wijzig je één, wijzig dan de
ander** — die twee moeten hetzelfde zeggen.

Een privacybeleid is hier verplicht: de extensie verwerkt persoonlijke communicatie.

**Controleer de link voordat je indient.** Een 404 is een automatische afwijzing.

---

## Distribution

**Visibility**: Public
**Regions**: Alle regio's

Overweeg **Unlisted** voor de eerste versie. Dan kun je met echte gebruikers testen
zonder dat een ruwe eerste indruk meteen in reviews belandt.

---

## Developer Info

| Veld | Waarde |
|---|---|
| Publisher Name | Chapter42 |
| Contact Email | roy@chapter42.com |
| Support URL | https://github.com/chapter42/fanouts/issues |
| Homepage URL | https://github.com/chapter42/fanouts |

Het contactadres is openbaar zichtbaar en Google stuurt er beleidswijzigingen en
takedown-meldingen naartoe. Houd het in de gaten.

---

## Version History

| Versie | Datum | Wijzigingen | Status |
|---|---|---|---|
| 0.3.4 | 2026-07-27 | Eerste voorbereiding voor de store: listing, privacybeleid, verpakkingsscript, vijf screenshots. Manifest-beschrijving ingekort tot binnen de limiet van 132 tekens. | Draft |

---

## Review Notes

*Niet gepubliceerd — voor eigen gebruik.*

### Pre-publish checklist

- [x] Manifest V3, geen V2-resten
- [x] Beschrijving ≤ 132 tekens (`check.js` bewaakt dit)
- [x] Naam identiek aan `manifest.json`
- [x] Minimale rechten, geen `<all_urls>`
- [x] Elke permissie heeft een specifieke onderbouwing
- [x] Geen remote code — alle JavaScript zit in het pakket
- [x] Geen obfuscatie
- [x] Store-icoon 128×128 aanwezig
- [x] Schone ZIP via `npm run package` (alleen `manifest.json`, `icons/`, `src/`, `LICENSE`)
- [x] Vijf screenshots op 1280×800 (`npm run screenshots`)
- [x] Privacybeleid live en geverifieerd (HTTP 200, inhoud compleet)
- [ ] **Contactadres leesbaar zonder JavaScript** — zie de waarschuwing hierboven
- [ ] Data-disclosure-formulier ingevuld conform de tabel hierboven
- [ ] Extensie uitgepakt getest op alle drie de assistenten, console schoon

### Known Issues / Limitations

Eerlijk melden is beter dan wachten tot een reviewer of gebruiker het vindt.

- **Gemini is het minst betrouwbaar.** Google codeert de antwoorden in
  positionele arrays zonder veldnamen. Verandert die codering, dan levert de
  extractie mínder op in plaats van een fout — lege Gemini-turns zijn het signaal.
- **Perplexity schuift het snelst.** Twee payloadvormen zijn gedekt, maar dit
  formaat verandert het vaakst van de drie.
- **Zoekopdracht → bron is niet 1-op-1.** Een assistent bundelt meerdere
  zoekopdrachten in één aanroep en krijgt daar één gecombineerde resultatenset op
  terug. De koppeling is per aanroep, niet per losse zoekopdracht. De interface
  benoemt dat expliciet.
- **Historie ophalen werkt alleen op ChatGPT.** Alleen daar bestaat een endpoint
  dat het volledige gesprek teruggeeft.
- **Lokale opslag is niet versleuteld.** Wie toegang heeft tot het Chrome-profiel
  kan de opgeslagen gesprekken lezen. Dit staat ook in het privacybeleid.

### Risico's bij de review

Twee dingen die vooraf een afweging vragen:

1. **Single purpose.** De extensie legt vast, analyseert én exporteert. Dat kan
   als drie functies worden gelezen. De onderbouwing: analyseren en exporteren zijn
   de manier waarop het vastgelegde bruikbaar wordt — zonder die twee levert het
   vastleggen niets op. Houd de *Single Purpose*-zin daarom smal en laat ze niet
   los van elkaar klinken.

2. **Voorwaarden van de assistenten.** De extensie leest alleen mee met verkeer dat
   de browser toch al ontvangt voor het eigen account van de gebruiker, en omzeilt
   geen authenticatie of limieten — vergelijkbaar met de netwerk-tab in DevTools.
   Of dat binnen de gebruiksvoorwaarden van OpenAI, Perplexity en Google valt, is
   een inschatting die jij moet maken; ik kan die niet voor je nemen. Reviewers
   kijken kritisch naar extensies die diep in de werking van grote diensten zitten.
   Een afwijzing op deze grond is geen technisch probleem en niet met een codewijziging
   op te lossen.

### Rejection History

*Nog niet ingediend.*
