// This file registers the DevTools panel.
// It runs in the context of the DevTools page (not a panel).
chrome.devtools.panels.create(
  'Response Mock',
  'assets/icon16.png',
  'devtools-panel/panel.html',
  (panel) => {
    // Panel created successfully
  }
);
