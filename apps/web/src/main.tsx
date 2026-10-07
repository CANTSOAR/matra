import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Self-hosted variable fonts (bundled by Vite and served from our own origin — the CSP allows no third-party fonts).
// Fraunces "soft" = weight + SOFT axes for warm, rounded headings; Nunito Sans = weight axis for body text.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito-sans/index.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
