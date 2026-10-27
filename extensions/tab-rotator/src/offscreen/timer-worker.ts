// One pending timeout at a time; each new schedule replaces it.
let timer: ReturnType<typeof setTimeout> | undefined;

self.onmessage = (event: MessageEvent<number>) => {
  clearTimeout(timer);
  timer = setTimeout(() => self.postMessage('wake'), Math.max(0, event.data - Date.now()));
};
