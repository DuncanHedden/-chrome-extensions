import { createStore } from '@ext/shared/storage';
import { createLock, isLockedOut, isValidPin, NO_ATTEMPTS, recordAttempt, verifyPin, type Attempts } from '../lock.ts';
import type { Ctx } from './context.ts';
import { $, flashSaved, sendToBackground } from './ui.ts';

// Persisted, so reloading the page doesn't reset the wrong-PIN count.
const attemptsStore = createStore<Attempts>('local', 'lockAttempts', NO_ATTEMPTS);

/** The lock gate on page load, plus the lock settings section. Returns a render function. */
export function initLock(ctx: Ctx, onUnlocked: () => void): () => void {
  const isLocked = () => ctx.settings.lock.enabled; // already gated by license in options.ts
  const markUnlocked = () => {
    document.body.classList.remove('locked');
    // The engine holds rotation only on an *unlocked* settings page (see reconcile).
    history.replaceState(null, '', '#unlocked');
    onUnlocked();
  };
  const relock = () => {
    history.replaceState(null, '', location.pathname);
    document.body.classList.add('locked');
    $('#lock-gate').hidden = false;
    $<HTMLInputElement>('#unlock-pin').value = '';
  };

  $('#unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('#unlock-pin');
    const error = $('#unlock-error');
    const now = Date.now();
    let attempts = await attemptsStore.get();
    if (isLockedOut(attempts, now)) {
      error.textContent = `Too many wrong PINs. Try again in ${Math.ceil((attempts.lockedUntil - now) / 1000)} s.`;
      return;
    }
    const ok = await verifyPin(ctx.settings.lock, input.value);
    attempts = recordAttempt(attempts, ok, now);
    await attemptsStore.set(attempts);
    input.value = '';
    if (ok) {
      error.textContent = '';
      $('#lock-gate').hidden = true;
      markUnlocked();
    } else {
      error.textContent = isLockedOut(attempts, now) ? 'Too many wrong PINs. Locked for a while.' : 'Wrong PIN.';
      void sendToBackground('log', { entry: { at: now, level: 'warn', code: 'lock-failed', message: 'Wrong settings PIN entered.' } });
    }
  });

  $('#set-pin').addEventListener('click', async () => {
    const pin = $<HTMLInputElement>('#new-pin').value;
    const confirmPin = $<HTMLInputElement>('#confirm-pin').value;
    const error = $('#lock-error');
    if (!isValidPin(pin)) return void (error.textContent = 'Use 4–8 digits.');
    if (pin !== confirmPin) return void (error.textContent = 'The PINs don’t match.');
    error.textContent = '';
    await ctx.save({ lock: await createLock(pin) });
    $<HTMLInputElement>('#new-pin').value = $<HTMLInputElement>('#confirm-pin').value = '';
    history.replaceState(null, '', '#unlocked');
    flashSaved('Lock is on');
    render();
  });
  $('#lock-now').addEventListener('click', relock);
  $('#remove-lock').addEventListener('click', async () => {
    await ctx.save({ lock: { enabled: false, salt: '', hash: '' } });
    history.replaceState(null, '', location.pathname);
    render();
  });

  function render() {
    $('#lock-on').hidden = !isLocked();
    $('#lock-off').hidden = isLocked();
  }

  // On load: locked pages start at the PIN prompt, whatever the URL says.
  if (isLocked()) relock();
  else history.replaceState(null, '', location.pathname);
  render();
  return render;
}
