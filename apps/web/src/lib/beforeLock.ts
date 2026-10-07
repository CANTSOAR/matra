/**
 * Work to finish before a calm "Lock & sign out" (e.g. saving her draft to the vault).
 * Quick exit and auto-lock never wait for these: they wipe immediately.
 */
type Task = () => Promise<void>;
const tasks = new Set<Task>();

export function onBeforeLock(fn: Task): () => void {
  tasks.add(fn);
  return () => {
    tasks.delete(fn);
  };
}

/** Run every task, but never hold her up for more than `timeoutMs`. Failures are ignored. */
export async function runBeforeLock(timeoutMs = 2500): Promise<void> {
  if (!tasks.size) return;
  const all = Promise.allSettled(Array.from(tasks, (t) => t()));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}
