import type { ReactNode } from 'react';
import { SessionProvider, useSession } from '../lib/session';

export let current: ReturnType<typeof useSession> | null = null;

function Probe() {
  current = useSession();
  return <div data-testid="state">{current.session ? `in:${current.session.user.username}` : 'out'}</div>;
}

export function Harness({ fetchImpl, children }: { fetchImpl: typeof fetch; children?: ReactNode }) {
  return (
    <SessionProvider fetchImpl={fetchImpl}>
      <Probe />
      {children}
    </SessionProvider>
  );
}
