// Injected on demand by the service worker (keyboard shortcut or toolbar click). Running it again in the
// same tab just refocuses the existing bar: the isolated world's `window` persists between injections.
import { createController, type Controller } from './controller.ts';

declare global {
  interface Window {
    __regexFind?: Controller;
  }
}

if (window.__regexFind) {
  window.__regexFind.focus();
} else {
  window.__regexFind = createController(() => {
    delete window.__regexFind;
  });
}
