// Relays between the service worker and the timer worker. Holds no rotation state.
const worker = new Worker('timer-worker.js');

worker.onmessage = () => {
  // A rejected send just means the service worker is restarting; the watchdog alarm covers it.
  chrome.runtime.sendMessage({ target: 'background', type: 'wake' }).catch(() => {});
};

chrome.runtime.onMessage.addListener((message: { target?: string; type?: string; at?: number }) => {
  if (message.target === 'offscreen' && message.type === 'schedule') worker.postMessage(message.at);
});
