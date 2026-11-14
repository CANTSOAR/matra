import { unreadableNotice } from '../lib/vault';

/**
 * Shown wherever her space is resumed, summarized, shared or exported: some saved versions couldn't be opened, so the
 * "latest" one here may be older than her newest save (lib/vault.ts loadVault `unreadable`). Renders nothing for 0.
 */
export function UnreadableNote({ count }: { count: number | undefined }) {
  const text = unreadableNotice(count ?? 0);
  if (!text) return null;
  return (
    <p className="card warn small" role="status" data-testid="vault-unreadable">
      {text}
    </p>
  );
}
