import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@matra/shared';
import { NEUTRAL_TITLE, QuickExitButton } from '../lib/quickExit';
import { useSession } from '../lib/session';

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
            <NavLink to="/vault/brief">Brief</NavLink>
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
          <button type="button" className="btn btn-quiet btn-small" onClick={() => void logout()}>
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
