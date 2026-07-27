/*
 * Fanouts — service worker.
 * Houdt het zijpaneel gekoppeld aan de actieknop en zorgt voor default-settings.
 */

const KEY_SETTINGS = 'fanout:settings';

const DEFAULTS = {
  myDomains: [],
  maxTurns: 800,
  capturePaused: false,
  theme: 'light'
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  const merged = Object.assign({}, DEFAULTS, stored[KEY_SETTINGS] || {});
  await chrome.storage.local.set({ [KEY_SETTINGS]: merged });
});

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'fanout:open-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'fanout:resync-active') {
    chrome.tabs.query({
      url: ['https://chatgpt.com/*', 'https://chat.openai.com/*',
            'https://www.perplexity.ai/*', 'https://perplexity.ai/*',
            'https://gemini.google.com/*']
    }, (tabs) => {
      const tab = tabs.find((t) => t.active) || tabs[0];
      if (!tab) { sendResponse({ ok: false, error: 'Geen ChatGPT-, Perplexity- of Gemini-tab gevonden' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'fanout:resync' }, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(res || { ok: false, error: 'Geen antwoord' });
      });
    });
    return true;
  }
});
