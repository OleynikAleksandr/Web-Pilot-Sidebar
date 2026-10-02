// Starts the panel inside an extension page: the browser side panel,
// the iframe on the provider page, or a plain tab (for pairing and tests).
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const declared = document.body.dataset.host;
  const host = declared === 'sidepanel' ? 'sidepanel' : window.top === window ? 'tab' : 'inline-iframe';
  globalThis.WPSPanel.mount(document.getElementById('app'), { host });
  if (host === 'inline-iframe') {
    try { api.runtime.sendMessage({ channel: 'wps', op: 'panel-ready' })?.catch?.(() => {}); } catch { /* background asleep: content script falls back */ }
  }
})();
