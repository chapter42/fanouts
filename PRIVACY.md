# Privacybeleid — Fanouts

_Laatst bijgewerkt: 27 juli 2026 · geldt vanaf versie 0.3.4_

Fanouts leest mee met je gesprekken op ChatGPT, Perplexity en Gemini. Dat is
gevoelige informatie, dus hieronder staat precies wat er met welke gegevens
gebeurt.

**De korte versie: alles blijft op je eigen computer.** Er is geen server, geen
account, geen analytics en geen telemetrie.

## Welke gegevens worden verwerkt

Bij een vraag waarvoor de assistent het web raadpleegt, legt Fanouts vast:

| Gegeven | Waarvoor |
| --- | --- |
| Je vraag | om het overzicht per gesprek te kunnen tonen |
| De zoekopdrachten van de assistent | de kernfunctie van de extensie |
| De geraadpleegde en geciteerde bronnen (URL, titel, fragment) | om te tonen waar het antwoord vandaan komt |
| De antwoordtekst | om te kunnen doorzoeken en analyseren wat er is gezegd |
| Titel en id van het gesprek, tijdstip en modelnaam | om het overzicht te ordenen |
| Je instellingen (eigen domeinen, thema, bewaarlimiet) | om je voorkeuren te onthouden |

Bevat je vraag persoonlijke gegevens, dan komen die in het overzicht terecht,
net als in het gesprek zelf. Fanouts filtert of herkent dat niet.

**Niet verwerkt:** je browsergeschiedenis, andere tabbladen, cookies, opgeslagen
wachtwoorden en de inhoud van andere websites. De extensie is uitsluitend actief
op chatgpt.com, chat.openai.com, perplexity.ai en gemini.google.com.

## Waar de gegevens staan

In `chrome.storage.local`: opslag op je eigen schijf, binnen je Chrome-profiel.

Uitdrukkelijk **niet** in `chrome.storage.sync` — dat zou de gegevens naar je
Google-account en je andere apparaten kopiëren.

Deze opslag is **niet versleuteld**. Wie toegang heeft tot je Chrome-profiel kan
de bewaarde gesprekken lezen. Dat geldt voor elke extensie die lokale opslag
gebruikt, maar het is hier extra relevant omdat het om gespreksinhoud gaat.

## Wat er de deur uit gaat

Vrijwel niets. Het meelezen doet zelf **geen enkele** netwerkaanroep: er wordt
alleen een kopie gelezen van antwoorden die je browser toch al ontving.

Er is één uitzondering, en die komt alleen in actie als je er zelf op klikt. De
knop **Historie ophalen** doet twee aanroepen naar ChatGPT:

| Aanroep | Waarvoor |
| --- | --- |
| `GET /api/auth/session` | je bestaande sessietoken ophalen |
| `GET /backend-api/conversation/<id>` | jouw eigen gesprek ophalen |

Beide gaan naar ChatGPT zelf, met de sessie die je toch al hebt. Het token wordt
alleen in die ene aanroep gebruikt en nergens opgeslagen of gelogd. Dit is een
*download* naar je eigen schijf — er wordt niets van je verstuurd.

Er zijn geen andere bestemmingen. De extensie heeft alleen toegangsrechten voor
de vijf adressen hierboven en kan technisch nergens anders heen.

## Delen met derden

Nooit. Je gegevens worden niet verkocht, verhuurd, gedeeld of voor advertenties
gebruikt. Er zijn geen externe diensten, bibliotheken of trackers in de extensie.

## Bewaren en verwijderen

Gegevens blijven staan tot je ze verwijdert. Standaard worden de laatste 800
gesprekken bewaard; daarboven verdwijnen de oudste automatisch. Die grens kun je
zelf aanpassen.

Je hebt volledige controle:

- **Pauzeren** — met de knop in het zijpaneel stopt het vastleggen direct
- **Eén gesprek wissen** — via *Verwijderen* op de betreffende kaart
- **Alles wissen** — via Instellingen → *Alles wissen*
- **Exporteren** — naar JSON, CSV of Markdown, naar je eigen downloadmap
- **Verwijderen van de extensie** — Chrome wist dan alle bijbehorende opslag

## Exports

Een export bevat je vragen, de volledige antwoorden en de geciteerde bronnen.
Die bestanden staan daarna op je eigen computer en vallen buiten dit beleid.
Behandel ze als vertrouwelijk, zeker als je klantvragen of interne informatie in
je prompts zet.

## Kinderen

Fanouts is bedoeld voor professioneel gebruik en richt zich niet op kinderen
onder de 13. Er worden bewust geen leeftijdsgegevens verzameld.

## Wijzigingen

Wordt dit beleid aangepast, dan verandert de datum bovenaan en staat de
wijziging in de [changelog](CHANGELOG.md). Omdat dit bestand naast de code in
dezelfde repository staat, is elke wijziging publiek terug te zien in de
git-historie.

## Verifiëren

Je hoeft dit niet op mijn woord te geloven. De volledige broncode is openbaar op
[github.com/chapter42/fanouts](https://github.com/chapter42/fanouts), en er
draait een geautomatiseerde controle die de build laat falen zodra er een
netwerkaanroep bijkomt, `chrome.storage.sync` wordt gebruikt of er een
toegangsrecht wordt toegevoegd. Zie [`tools/check.js`](tools/check.js).

## Contact

Vragen over privacy, of iets gevonden dat niet klopt:

**roy@chapter42.com**

Voor beveiligingsproblemen: zie [SECURITY.md](SECURITY.md) — meld die alsjeblieft
niet via een openbaar issue.
