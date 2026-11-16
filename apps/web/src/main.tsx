import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Self-hosted variable fonts (bundled by Vite and served from our own origin — the CSP allows no third-party fonts).
// Fraunces "soft" = weight + SOFT axes for warm, rounded headings; Nunito Sans = weight axis for body text.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito-sans/index.css';
import './styles/global.css';
import { applyTheme } from './lib/theme';

applyTheme(); // bright by default; "Dim" only if she chose it in this tab (lib/theme.ts)

// /inspector: the "Server view" (development and demo builds only; dev/Inspector.tsx). Everything else is the app,
// which uses an in-memory router and never changes the URL. A production build that is not a demo has no Server view:
// the condition below is a build-time `false` there, so this branch and the Server view's chunk are left out.
declare const __MATRA_DEMO__: boolean;
const Inspector = import.meta.env.DEV || __MATRA_DEMO__ === true ? lazy(() => import('./dev/Inspector').then((m) => ({ default: m.Inspector }))) : null;
const inspector = Inspector && window.location.pathname === '/inspector';
// /marker-preview: a developer page for the span-marker. Only in a development server started with MATRA_MARKER=on; a
// build-time false in every build, so the page and the marker code are left out (scripts/audit-web-build.mjs checks).
const MarkerPreview = import.meta.env.DEV && __MATRA_MARKER__ === true ? lazy(() => import('./dev/MarkerPreview').then((m) => ({ default: m.MarkerPreview }))) : null;
const markerPreview = MarkerPreview && window.location.pathname === '/marker-preview';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {markerPreview && MarkerPreview ? (
      <Suspense fallback={null}>
        <MarkerPreview />
      </Suspense>
    ) : inspector && Inspector ? (
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
