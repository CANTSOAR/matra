import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './components/common';
import { Layout, RequireSession } from './components/Layout';
import { CounselorGate, CounselorSignIn, RequireCounselor } from './counselor/guards';
import { SessionProvider } from './lib/session';
import {
  AttorneyLanding,
  AttorneyRegisterScreen,
  AttorneySignInScreen,
  SafetyTips,
  SignInScreen,
  StartScreen,
  Welcome,
} from './screens/Public';

/**
 * Code splitting: the welcome page and sign-in ship in the first, small bundle (people may be on a phone, on a slow
 * or metered connection). Everything behind a sign-in loads on demand, in its own chunk: the story space with its
 * on-device understanding engine (compromise + chrono-node) and voice capture, the PDF brief (pdf-lib), the data
 * export, and the attorney and counselor portals. All chunks are same-origin files, so the CSP is unchanged.
 */
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}
const Dashboard = page(() => import('./screens/Dashboard'), 'Dashboard');
const Story = page(() => import('./screens/Story'), 'Story');
const Evidence = page(() => import('./screens/Evidence'), 'Evidence');
const Brief = page(() => import('./screens/Brief'), 'Brief');
const Share = page(() => import('./screens/Share'), 'Share');
const DeleteAccount = page(() => import('./screens/DeleteAccount'), 'DeleteAccount');
const RecoverySettings = page(() => import('./screens/Recovery'), 'RecoverySettings');
const ChangePassphrase = page(() => import('./screens/ChangePassphrase'), 'ChangePassphrase');
const RecoverScreen = page(() => import('./screens/Recovery'), 'RecoverScreen');
const AttorneyCases = page(() => import('./attorney/Attorney'), 'AttorneyCases');
const AttorneyCase = page(() => import('./attorney/Attorney'), 'AttorneyCase');
// Sealed matching and the counselor portal exist only in a build with MATRA_MATCHING=on. In any other build these are
// null and their routes below are not registered, so the screens, their copy and their API calls are not in the bundle.
const SurvivorMatching = __MATRA_MATCHING__ ? page(() => import('./counselor/SurvivorMatching'), 'SurvivorMatching') : null;
const PhoneVerify = __MATRA_MATCHING__ ? page(() => import('./counselor/PhoneVerify'), 'PhoneVerify') : null;
const CounselorPortal = __MATRA_MATCHING__ ? page(() => import('./counselor/Counselor'), 'CounselorPortal') : null;
const CounselorReport = __MATRA_MATCHING__ ? page(() => import('./counselor/CounselorReport'), 'CounselorReport') : null;
const ReportRequest = __MATRA_MATCHING__ ? page(() => import('./counselor/ReportRequest'), 'ReportRequest') : null;
const VerifyPage = page(() => import('./verify/VerifyPage'), 'VerifyPage');

/** A calm placeholder while a screen's code arrives. */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading label="Opening…" />}>{children}</Suspense>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={__MATRA_MATCHING__ ? <CounselorGate><Layout /></CounselorGate> : <Layout />}>
        <Route index element={<Welcome />} />
        <Route path="safety" element={<SafetyTips />} />
        <Route path="start" element={<StartScreen />} />
        <Route path="signin" element={<SignInScreen />} />
        <Route path="recover" element={<Lazy><RecoverScreen /></Lazy>} />
        <Route path="verify" element={<Lazy><VerifyPage /></Lazy>} />

        <Route path="vault" element={<RequireSession role="survivor"><Lazy><Dashboard /></Lazy></RequireSession>} />
        <Route path="vault/story" element={<RequireSession role="survivor"><Lazy><Story /></Lazy></RequireSession>} />
        <Route path="vault/evidence" element={<RequireSession role="survivor"><Lazy><Evidence /></Lazy></RequireSession>} />
        <Route path="vault/brief" element={<RequireSession role="survivor"><Lazy><Brief /></Lazy></RequireSession>} />
        <Route path="vault/share" element={<RequireSession role="survivor"><Lazy><Share /></Lazy></RequireSession>} />
        {__MATRA_MATCHING__ && SurvivorMatching && PhoneVerify && ReportRequest && (
          <>
            <Route path="vault/matching" element={<RequireSession role="survivor"><Lazy><SurvivorMatching /></Lazy></RequireSession>} />
            <Route path="vault/matching/verify" element={<RequireSession role="survivor"><Lazy><PhoneVerify /></Lazy></RequireSession>} />
            <Route path="vault/requests/:id" element={<RequireSession role="survivor"><Lazy><ReportRequest /></Lazy></RequireSession>} />
          </>
        )}
        <Route path="vault/delete" element={<RequireSession role="survivor"><Lazy><DeleteAccount /></Lazy></RequireSession>} />
        <Route path="vault/recovery" element={<RequireSession role="survivor"><Lazy><RecoverySettings /></Lazy></RequireSession>} />
        <Route path="vault/passphrase" element={<RequireSession role="survivor"><Lazy><ChangePassphrase /></Lazy></RequireSession>} />

        <Route path="attorney" element={<AttorneyLanding />} />
        <Route path="attorney/register" element={<AttorneyRegisterScreen />} />
        <Route path="attorney/signin" element={<AttorneySignInScreen />} />
        <Route path="attorney/cases" element={<RequireSession role="attorney"><Lazy><AttorneyCases /></Lazy></RequireSession>} />
        <Route path="attorney/cases/:id" element={<RequireSession role="attorney"><Lazy><AttorneyCase /></Lazy></RequireSession>} />
        <Route path="attorney/passphrase" element={<RequireSession role="attorney"><Lazy><ChangePassphrase /></Lazy></RequireSession>} />

        {__MATRA_MATCHING__ && CounselorPortal && CounselorReport && (
          <>
            <Route path="counselor" element={<CounselorSignIn />} />
            <Route path="counselor/matches" element={<RequireCounselor><Lazy><CounselorPortal /></Lazy></RequireCounselor>} />
            <Route path="counselor/reports/:id" element={<RequireCounselor><Lazy><CounselorReport /></Lazy></RequireCounselor>} />
          </>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * The one deep link: the incident summary PDF prints "<app>/verify" (the file checker, public). Read once at start-up;
 * the address bar then goes back to "/" like every other page.
 */
function startPath(): string {
  if (typeof window === 'undefined' || window.location.pathname !== '/verify') return '/';
  window.history.replaceState(null, '', '/');
  return '/verify';
}
const START = startPath();

/**
 * MemoryRouter on purpose: in-app navigation never touches the browser URL or history,
 * so the address bar stays neutral and Quick exit's location.replace() leaves no
 * back-button trail into the app.
 */
export default function App() {
  return (
    <SessionProvider>
      <MemoryRouter initialEntries={[START]}>
        <AppRoutes />
      </MemoryRouter>
    </SessionProvider>
  );
}
