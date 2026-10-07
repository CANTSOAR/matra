/** Counselor route guards and sign-in: kept apart from the portal so the portal itself can load on demand. */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SignInForm } from '../components/AuthForms';
import { PageTitle } from '../components/common';
import { useSession } from '../lib/session';

/** A counselor session only ever sees the counselor portal (pathless guard around the app's routes). */
export function CounselorGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { pathname } = useLocation();
  if (session?.user.role === 'counselor' && !pathname.startsWith('/counselor')) return <Navigate to="/counselor/matches" replace />;
  return <>{children}</>;
}

export function RequireCounselor({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/counselor" replace />;
  if (session.user.role !== 'counselor') return <Navigate to={session.user.role === 'attorney' ? '/attorney/cases' : '/vault'} replace />;
  return <>{children}</>;
}

export function CounselorSignIn() {
  return (
    <div className="stack-lg">
      <PageTitle eyebrow="Legal options counselors" lead="For counselors Matra has verified and contracted.">
        Counselor sign in
      </PageTitle>
      <SignInForm role="attorney" />
    </div>
  );
}
