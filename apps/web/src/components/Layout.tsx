import { useEffect, type ReactNode } from 'react';
import { runBeforeLock } from '../lib/beforeLock';
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
      <strong>DEMO — please don’t enter real information.</strong> This is a demonstration server for partners and
      funders. Use made-up details only. Anything entered here may be deleted at any time.
    </div>
  );
}

/** Moves focus to the page heading on navigation (screen-reader friendly SPA nav). */
function useFocusOnNavigate() {
  const loc = useLocation();
  useEffect(() => {
    const find = () => document.querySelector<HTMLElement>('main [data-autofocus]');
    const h = find();
    if (h) {
      h.focus({ preventScroll: false });
      return;
    }
    // Screens behind a sign-in load on demand: focus their heading once it arrives (unless she has moved on).
    const main = document.getElementById('main');
    if (!main || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => {
      const el = find();
      if (!el) return;
      obs.disconnect();
      const a = document.activeElement;
      if (!a || a === document.body || a === main) el.focus({ preventScroll: false });
    });
    obs.observe(main, { childList: true, subtree: true });
    const t = setTimeout(() => obs.disconnect(), 5000);
    return () => {
      obs.disconnect();
      clearTimeout(t);
    };
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
        <div className="app-header-inner">
          <Link className="brand" to={role === 'attorney' ? '/attorney/cases' : session ? '/vault' : '/'}>
            <span className="brand-mark" aria-hidden="true" />
            Matra
          </Link>
          {role === 'survivor' && (
            <nav className="nav" aria-label="Main">
              <NavLink to="/vault" end data-testid="nav-home">Home</NavLink>
              <NavLink to="/vault/story" data-testid="nav-story">My story</NavLink>
              <NavLink to="/vault/evidence" data-testid="nav-evidence">Evidence</NavLink>
              <NavLink to="/vault/brief" data-testid="nav-summary">Summary</NavLink>
              <NavLink to="/vault/share" data-testid="nav-sharing">Sharing</NavLink>
            </nav>
          )}
          {role === 'attorney' && (
            <nav className="nav" aria-label="Main">
              <NavLink to="/attorney/cases" data-testid="nav-cases">Shared with you</NavLink>
            </nav>
          )}
          <span className="header-spacer" />
          {session && (
            <button
              type="button"
              className="btn btn-quiet btn-small lock-btn"
              data-testid="lock-signout"
              aria-label="Lock & sign out"
              title="Lock your space and sign out"
              onClick={async () => {
                // finish a quick save of her draft first (bounded), then lock
                await runBeforeLock();
                // land on a neutral page, not a "Welcome back" sign-in form that shows this device has an account
                navigate(role === 'attorney' ? '/attorney' : '/', { replace: true });
                void logout();
              }}
            >
              <span>Lock</span>
              <span className="lock-long"> &amp; sign out</span>
            </button>
          )}
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        {role === 'attorney' ? (
          <p className="footer-lead">Resources you can share with clients</p>
        ) : (
          <p className="footer-lead">You don’t have to go through this alone.</p>
        )}
        <p>
          In danger right now? Call <a href="tel:911">911</a> · Free, private support 24/7:{' '}
          <a href="tel:18006564673" style={{ whiteSpace: 'nowrap' }}>1-800-656-4673</a> or{' '}
          <a href="https://online.rainn.org" target="_blank" rel="noreferrer noopener">online.rainn.org</a> ·{' '}
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
