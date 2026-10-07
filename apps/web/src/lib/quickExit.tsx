import { useEffect } from 'react';
import { wipeAll } from './wipe';

export const QUICK_EXIT_URL = 'https://www.google.com/search?q=weather';
export const NEUTRAL_TITLE = 'Notes';

/** Indirection so tests can observe navigation (jsdom's `location` is not configurable). */
export const exitDeps = {
  replace(url: string) {
    window.location.replace(url);
  },
};

/**
 * Leave immediately: wipe in-memory keys and state, blank the page, and replace the
 * current history entry so the back button does not return here.
 * (The app uses an in-memory router, so this is the only history entry the app ever creates.)
 */
export function quickExit(): void {
  wipeAll();
  try {
    document.title = NEUTRAL_TITLE;
    document.body.style.visibility = 'hidden';
    const root = document.getElementById('root');
    if (root) root.setAttribute('aria-hidden', 'true');
  } catch {
    /* ignore */
  }
  exitDeps.replace(QUICK_EXIT_URL);
}

/** Pressing Escape `count` times within `windowMs` triggers quick exit. */
export function useTripleEscape(onTrigger: () => void = quickExit, count = 3, windowMs = 1200): void {
  useEffect(() => {
    let presses: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const now = Date.now();
      presses = presses.filter((t) => now - t < windowMs);
      presses.push(now);
      if (presses.length >= count) {
        presses = [];
        onTrigger();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onTrigger, count, windowMs]);
}

export function QuickExitButton() {
  useTripleEscape();
  return (
    <button
      type="button"
      className="quick-exit"
      onClick={quickExit}
      aria-label="Quick exit: leave this site now. Shortcut: press Escape three times."
      title="Leave now (or press Esc 3 times)"
    >
      Quick exit <span className="quick-exit-hint" aria-hidden="true">Esc ×3</span>
    </button>
  );
}
