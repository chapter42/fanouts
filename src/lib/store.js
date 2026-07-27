/*
 * Fanouts — opslaglaag voor UI-contexten (paneel en dashboard).
 *
 * Elke functie geeft een promise terug; fouten worden hier niet opgevangen maar
 * doorgegeven, zodat de aanroeper kan beslissen of de gebruiker iets moet zien.
 */
;(function (root) {
  'use strict';

  const KEY_INDEX = 'fanout:index';
  const KEY_ACTIVE = 'fanout:active';
  const KEY_SETTINGS = 'fanout:settings';
  const TURN_PREFIX = 'fanout:turn:';

  const DEFAULT_SETTINGS = { myDomains: [], maxTurns: 800, capturePaused: false, theme: 'light' };

  async function getSettings() {
    const r = await chrome.storage.local.get(KEY_SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, r[KEY_SETTINGS] || {});
  }

  async function setSettings(patch) {
    const next = Object.assign({}, await getSettings(), patch);
    await chrome.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  }

  async function getActive() {
    const r = await chrome.storage.local.get(KEY_ACTIVE);
    return r[KEY_ACTIVE] || null;
  }

  async function getIndex() {
    const r = await chrome.storage.local.get(KEY_INDEX);
    return Array.isArray(r[KEY_INDEX]) ? r[KEY_INDEX] : [];
  }

  async function getTurns() {
    const index = await getIndex();
    if (!index.length) return [];

    const all = await chrome.storage.local.get(index.map((id) => TURN_PREFIX + id));
    const out = [];
    index.forEach((id) => {
      const turn = all[TURN_PREFIX + id];
      if (turn) out.push(turn);
    });
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
  }

  async function deleteTurn(id) {
    const index = (await getIndex()).filter((x) => x !== id);
    await chrome.storage.local.set({ [KEY_INDEX]: index });
    await chrome.storage.local.remove(TURN_PREFIX + id);
  }

  async function clearAll() {
    const keys = (await getIndex()).map((id) => TURN_PREFIX + id);
    await chrome.storage.local.set({ [KEY_INDEX]: [] });
    if (keys.length) await chrome.storage.local.remove(keys);
  }

  async function clearConversation(conversationId) {
    const turns = await getTurns();
    const drop = turns.filter((t) => t.conversationId === conversationId).map((t) => t.id);
    if (!drop.length) return 0;

    const index = (await getIndex()).filter((x) => drop.indexOf(x) === -1);
    await chrome.storage.local.set({ [KEY_INDEX]: index });
    await chrome.storage.local.remove(drop.map((id) => TURN_PREFIX + id));
    return drop.length;
  }

  /* Her-analyseert alle turns, bv. na wijziging van "mijn domeinen". */
  async function reanalyseAll() {
    const [turns, settings] = await Promise.all([getTurns(), getSettings()]);
    const patch = {};
    turns.forEach((t) => {
      root.FanoutAnalysis.analyseTurn(t, settings);
      patch[TURN_PREFIX + t.id] = t;
    });
    if (turns.length) await chrome.storage.local.set(patch);
    return turns;
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const relevant = Object.keys(changes).some(
        (k) => k === KEY_INDEX || k === KEY_ACTIVE || k.indexOf(TURN_PREFIX) === 0
      );
      if (relevant) cb(changes);
    });
  }

  async function usage() {
    if (!chrome.storage.local.getBytesInUse) return null;
    return chrome.storage.local.getBytesInUse(null);
  }

  /* Zet het thema op <html>; licht is de standaard. */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }

  root.FanoutStore = {
    applyTheme,
    DEFAULT_SETTINGS,
    getTurns,
    getActive,
    getSettings,
    setSettings,
    deleteTurn,
    clearAll,
    clearConversation,
    reanalyseAll,
    onChange,
    usage,
    KEY_INDEX,
    TURN_PREFIX
  };
})(typeof self !== 'undefined' ? self : this);
