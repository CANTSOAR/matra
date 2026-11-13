import { useState } from 'react';

/**
 * Matra is bright by default, whatever the device's dark-mode setting: a warm, light room feels safer than a dark
 * one. "Dim" is an opt-in for late at night or a darker room (styles/global.css `:root[data-theme='dim']`).
 *
 * The choice lives in sessionStorage only, so it ends with the tab and leaves nothing on a shared device that says
 * Matra was used. Storage can be unavailable (private windows, blocked site data): then the default simply applies.
 */
const KEY = 'm.dim';

export function isDim(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function applyTheme(dim: boolean = isDim()): void {
  if (dim) document.documentElement.dataset.theme = 'dim';
  else delete document.documentElement.dataset.theme;
}

export function setDim(dim: boolean): void {
  try {
    if (dim) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the change still applies for this page */
  }
  applyTheme(dim);
}

export function useDim(): [boolean, (dim: boolean) => void] {
  const [dim, set] = useState(isDim);
  return [dim, (d) => (setDim(d), set(d))];
}
