import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AttorneyCase, AttorneyCases } from './attorney/Attorney';
import { Layout, RequireSession } from './components/Layout';
import { SessionProvider } from './lib/session';
import { Brief } from './screens/Brief';
import { Dashboard } from './screens/Dashboard';
import { Evidence } from './screens/Evidence';
import {
  AttorneyLanding,
  AttorneyRegisterScreen,
  AttorneySignInScreen,
  SafetyTips,
  SignInScreen,
  StartScreen,
  Welcome,
} from './screens/Public';
import { Share } from './screens/Share';
import { Story } from './screens/Story';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Welcome />} />
        <Route path="safety" element={<SafetyTips />} />
        <Route path="start" element={<StartScreen />} />
        <Route path="signin" element={<SignInScreen />} />

        <Route path="vault" element={<RequireSession role="survivor"><Dashboard /></RequireSession>} />
        <Route path="vault/story" element={<RequireSession role="survivor"><Story /></RequireSession>} />
        <Route path="vault/evidence" element={<RequireSession role="survivor"><Evidence /></RequireSession>} />
        <Route path="vault/brief" element={<RequireSession role="survivor"><Brief /></RequireSession>} />
        <Route path="vault/share" element={<RequireSession role="survivor"><Share /></RequireSession>} />

        <Route path="attorney" element={<AttorneyLanding />} />
        <Route path="attorney/register" element={<AttorneyRegisterScreen />} />
        <Route path="attorney/signin" element={<AttorneySignInScreen />} />
        <Route path="attorney/cases" element={<RequireSession role="attorney"><AttorneyCases /></RequireSession>} />
        <Route path="attorney/cases/:id" element={<RequireSession role="attorney"><AttorneyCase /></RequireSession>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * MemoryRouter on purpose: in-app navigation never touches the browser URL or history,
 * so the address bar stays neutral and Quick exit's location.replace() leaves no
 * back-button trail into the app.
 */
export default function App() {
  return (
    <SessionProvider>
      <MemoryRouter>
        <AppRoutes />
      </MemoryRouter>
    </SessionProvider>
  );
}
