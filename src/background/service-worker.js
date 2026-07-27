/*
 * Fanouts — service worker.
 * Opent het zijpaneel vanaf de actieknop en zorgt voor default-settings.
 */

const KEY_SETTINGS = 'fanout:settings';

const AI_HOSTS = [
  'https://chatgpt.com/*', 'https://chat.openai.com/*',
  'https://www.perplexity.ai/*', 'https://perplexity.ai/*',
  'https://gemini.google.com/*'
];

const DEFAULTS = {
  myDomains: [],
  maxTurns: 800,
  capturePaused: false,
  theme: 'light'
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(KEY_SETTINGS);
    const merged = Object.assign({}, DEFAULTS, stored[KEY_SETTINGS] || {});
    await chrome.storage.local.set({ [KEY_SETTINGS]: merged });
  } catch (err) {
    console.error('[Fanouts] kon de standaardinstellingen niet wegschrijven', err);
  }
});

/*
 * Twee routes naar het zijpaneel, want er is er maar één zichtbaar voor de
 * gebruiker: de actieknop.
 *
 * setPanelBehavior laat Chrome het paneel zélf openen bij een klik. Faalt die
 * aanroep, dan vangt onClicked het op. Beide registreren mag: zolang
 * openPanelOnActionClick actief is vuurt onClicked niet, dus ze bijten elkaar
 * niet. Zonder dit vangnet zou een mislukte setPanelBehavior betekenen dat het
 * paneel helemaal niet meer te openen is — en de lege catch die er eerst stond
 * maakte dat ook nog eens onzichtbaar.
 */
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[Fanouts] setPanelBehavior faalde; onClicked neemt het over', err);
  });
}

// Moet synchroon op topniveau geregistreerd worden: een service worker die zich
// pas na een await abonneert, mist events na een herstart.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error('[Fanouts] kon het zijpaneel niet openen', err);
  }
});

/* --------------------------------------------------------------------- */

async function resyncActiveTab() {
  const tabs = await chrome.tabs.query({ url: AI_HOSTS });
  const tab = tabs.find((t) => t.active) || tabs[0];
  if (!tab) return { ok: false, error: 'Geen ChatGPT-, Perplexity- of Gemini-tab gevonden' };

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'fanout:resync' });
    return res || { ok: false, error: 'Geen antwoord van de pagina' };
  } catch (err) {
    // Gooit als het content script niet draait — bijvoorbeeld omdat het tabblad
    // nog niet is ververst na het (her)laden van de extensie.
    return { ok: false, error: (err && err.message) || 'Content script niet bereikbaar — ververs het tabblad' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'fanout:open-dashboard') {
    (async () => {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (msg.type === 'fanout:resync-active') {
    (async () => {
      try {
        sendResponse(await resyncActiveTab());
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }
});
