import { t } from '@ext/shared/i18n';

const OPEN_COMMAND = 'open-find-bar';

/**
 * Injects the find bar into the active tab. Both triggers (shortcut, toolbar click) grant `activeTab`,
 * which is what lets us inject without any host permissions.
 */
async function openFindBar(tab: chrome.tabs.Tab | undefined) {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (error) {
    // chrome://, the Web Store, the PDF viewer, and file:// (unless allowed) can't be scripted.
    console.warn('Regex Find cannot run on this page:', error);
    await flagUnsupported(tab.id);
  }
}

async function flagUnsupported(tabId: number) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  await chrome.action.setBadgeText({ tabId, text: '!' });
  await chrome.action.setTitle({ tabId, title: t('unsupportedPage', undefined, "Regex Find can't run on this page") });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: '' });
    void chrome.action.setTitle({ tabId, title: '' });
  }, 4000);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_COMMAND) void openFindBar(tab);
});
chrome.action.onClicked.addListener((tab) => void openFindBar(tab));

// Playwright can't press browser-level shortcuts, so e2e tests call the handler directly. The service
// worker's global scope is private to the extension, so this exposes nothing to web pages.
declare global {
  var openFindBar: (tab: chrome.tabs.Tab | undefined) => Promise<void>;
}
globalThis.openFindBar = openFindBar;
