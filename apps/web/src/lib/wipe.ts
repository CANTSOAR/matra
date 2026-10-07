/**
 * Registry of "forget everything" handlers. The session provider registers one that
 * drops keys, token and decrypted state from memory. Quick exit and auto-lock call wipeAll().
 */
type Handler = () => void;
const handlers = new Set<Handler>();

export function onWipe(fn: Handler): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

export function wipeAll(): void {
  for (const h of Array.from(handlers)) {
    try {
      h();
    } catch {
      /* a failing handler must never block the others */
    }
  }
}
