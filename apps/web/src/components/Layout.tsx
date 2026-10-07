import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '@matra/shared';
import { NEUTRAL_TITLE, QuickExitButton } from '../lib/quickExit';
import { useSession } from '../lib/session';

/**
 * Demo instances show a permanent banner. The production server adds <meta name="matra-demo-banner" content="1">
 * when MATRA_DEMO_BANNER=1 (a meta tag, because the CSP forbids inline scripts); VITE_MATRA_DEMO_BANNER=1 does the
 * same for a dev build.
 */
export function isDemoInstance(): boolean {
  if (import.meta.env.VITE_MATRA_DEMO_BANNER === '1') return true;
  return typeof document !== 'undefined' && document.querySelector('meta[name="matra-demo-banner"]')?.getAttribute('content') === '1';
}

export function DemoBanner() {
  if (!isDemoInstance()) return null;
  return (
    <div className="demo-banner" role="note" aria-label="Demo notice">
      <strong>DEMO — do not enter real information.</strong> This is a demonstration server for partners and funders.
      Use made-up details only; anything entered here may be deleted at any time.
    </div>
  );
}

/** Moves focus to the page heading on navigation (screen-reader friendly SPA nav). */
function useFocusOnNavigate() {
  const loc = useLocation();
  useEffect(() => {
    const h = document.querySelector<HTMLElement>('main [data-autofocus]');
    h?.focus({ preventScroll: false });
  }, [loc.pathname]);
}

export function Layout() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  useFocusOnNavigate();
  useEffect(() => {
    document.title = NEUTRAL_TITLE; // tab title stays neutral on every screen
  });
  const role = session?.user.role;
  return (
    <>
      {/* no hash navigation: it would add a browser history entry that survives Quick exit */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <QuickExitButton />
      <DemoBanner />
      <header className="app-header">
        <Link className="brand" to={role === 'attorney' ? '/attorney/cases' : session ? '/vault' : '/'}>
          <span className="brand-mark" aria-hidden="true" />
          Matra
        </Link>
        {role === 'survivor' && (
          <nav className="nav" aria-label="Main">
            <NavLink to="/vault" end>Your vault</NavLink>
            <NavLink to="/vault/story">Your account</NavLink>
            <NavLink to="/vault/evidence">Evidence</NavLink>
            <NavLink to="/vault/brief">Incident summary</NavLink>
            <NavLink to="/vault/share">Legal shield</NavLink>
          </nav>
        )}
        {role === 'attorney' && (
          <nav className="nav" aria-label="Main">
            <NavLink to="/attorney/cases">Shared with you</NavLink>
          </nav>
        )}
        <span className="header-spacer" />
        {session && (
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => {
              // land on a neutral page, not a "Welcome back" sign-in form that shows this device has an account
              navigate(role === 'attorney' ? '/attorney' : '/', { replace: true });
              void logout();
            }}
          >
            Lock &amp; sign out
          </button>
        )}
      </header>
      <main id="main" className="page" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        <p>
          Need help now? Call <a href="tel:911">911</a> · National Sexual Assault Hotline{' '}
          <a href="tel:18006564673">1-800-656-4673</a> · <a href="https://online.rainn.org" target="_blank" rel="noreferrer noopener">online.rainn.org</a> ·{' '}
          <Link to="/safety">Safety tips</Link>
        </p>
      </footer>
    </>
  );
}

export function RequireSession({ role, children }: { role?: Role; children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to={role === 'attorney' ? '/attorney/signin' : '/signin'} replace />;
  if (role && session.user.role !== role) {
    return <Navigate to={session.user.role === 'attorney' ? '/attorney/cases' : '/vault'} replace />;
  }
  return <>{children}</>;
}
