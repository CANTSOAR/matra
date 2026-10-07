import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

export const SURVIVOR_PASS = 'e2e quiet harbor maple lantern seven';
export const ATTORNEY_PASS = 'demo-attorney-passphrase';
export const QUICK_EXIT_HOST = 'www.google.com';

/** Unique per run so the suite is repeatable even against a reused DB. */
export const RUN = Date.now().toString(36).slice(-6);

const SCREENS = process.env.MATRA_E2E_SCREENS || path.resolve('e2e/.screens');

/**
 * `page` that records console errors/warnings and uncaught exceptions, and fails the test if any appear.
 * Quick exit navigates to google; that host is stubbed so no real network request is made.
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: async ({}, use) => {
    await use([]);
  },
  page: async ({ page, consoleProblems }, use, testInfo) => {
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      const text = m.text();
      // A 401 for a deliberately wrong passphrase is expected network noise, not an app error.
      if (/Failed to load resource: the server responded with a status of 401/.test(text)) return;
      // React DevTools hint (dev builds only).
      if (/Download the React DevTools/.test(text)) return;
      consoleProblems.push(`[${m.type()}] ${text}`);
    });
    page.on('pageerror', (e) => consoleProblems.push(`[pageerror] ${e.message}`));
    await page.route(`https://${QUICK_EXIT_HOST}/**`, (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title><p>weather</p>' }),
    );
    await use(page);
    if (consoleProblems.length) {
      await testInfo.attach('console', { body: consoleProblems.join('\n'), contentType: 'text/plain' });
    }
    expect(consoleProblems, 'browser console errors/warnings').toEqual([]);
  },
});
export { expect };

/** Full-page screenshot at desktop width, plus a 390px mobile one when `mobile` is set. */
export async function shot(page: Page, name: string, { mobile = true } = {}) {
  fs.mkdirSync(SCREENS, { recursive: true });
  // scroll to the top so sticky/fixed elements are drawn where they belong in a full-page capture
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SCREENS, `${name}-desktop.png`), fullPage: true });
  if (mobile) {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    // no horizontal page scroll at phone width
    const wide = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth) return [];
      const W = window.innerWidth + 0.5;
      // report the outermost elements that stick out past the right edge
      return Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.getBoundingClientRect().right > W && !(el.parentElement && el.parentElement.getBoundingClientRect().right > W))
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} (${Math.round(el.getBoundingClientRect().right)}px)`);
    });
    expect(wide, `${name}: elements wider than 390px`).toEqual([]);
    await page.screenshot({ path: path.join(SCREENS, `${name}-mobile.png`), fullPage: true });
    await page.setViewportSize(vp);
    await page.waitForTimeout(100);
  }
}

// ───────────── accounts ─────────────

export async function registerSurvivor(page: Page, alias: string, pass = SURVIVOR_PASS) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).click();
  await page.getByLabel('Choose an alias').fill(alias);
  await page.getByLabel('Passphrase', { exact: true }).fill(pass);
  await page.getByLabel('Type it again').fill(pass);
  await page.getByLabel(/written my passphrase down/).check();
  await page.getByLabel(/I am 18 or older/).check();
  await page.getByRole('button', { name: 'Create my private vault' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault' })).toBeVisible({ timeout: 90_000 });
}

export async function signIn(page: Page, user: string, pass: string, role: 'survivor' | 'attorney' = 'survivor') {
  await page.goto('/');
  if (role === 'attorney') {
    await page.getByRole('link', { name: 'I’m an attorney' }).click();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Username').fill(user);
  } else {
    await page.getByRole('link', { name: 'Sign in' }).first().click();
    await page.getByLabel('Alias').fill(user);
  }
  await page.getByLabel('Passphrase').fill(pass);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: role === 'attorney' ? 'Shared with you' : 'Your vault' })).toBeVisible({
    timeout: 90_000,
  });
}

export async function signOut(page: Page) {
  const attorney = await page.getByRole('link', { name: 'Shared with you' }).count();
  await page.getByRole('button', { name: 'Lock & sign out' }).click();
  await expect(page.getByRole('heading', { name: attorney ? 'For attorneys' : /Tell it once/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock & sign out' })).toHaveCount(0);
}

export async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

// ───────────── intake driver ─────────────

export type Act = (page: Page) => Promise<void>;
const area = (page: Page) => page.locator('.intake-answer-area');

export const click = (name: string | RegExp): Act => async (page) => {
  await area(page).getByRole('button', { name, exact: typeof name === 'string' }).click();
};
export const skip: Act = click('Skip for now');
export const primary: Act = async (page) => {
  await area(page).locator('.intake-btn-primary').first().click();
};
export const type = (text: string): Act => async (page) => {
  await area(page).locator('input:not([type=checkbox]), textarea').first().fill(text);
  await primary(page);
};
/** Fill labelled fields (inputs/textareas/selects) and chip groups, then submit. */
export const fields = (values: Record<string, string | { select: string } | { chip: string }>, submit = true): Act => async (page) => {
  const a = area(page);
  for (const [label, v] of Object.entries(values)) {
    if (typeof v === 'string') await a.getByLabel(label, { exact: true }).fill(v);
    else if ('select' in v) await a.getByLabel(label, { exact: true }).selectOption(v.select);
    else await a.getByRole('group', { name: label }).getByRole('button', { name: v.chip, exact: true }).click();
  }
  if (submit) await primary(page);
};

/**
 * Walks the intake one step at a time, answering from `plan` (keyed by step id).
 * Unlisted steps: info → its primary button, evidence → "Maybe later", everything else → "Skip for now".
 * `before` hooks run before a step is answered (e.g. take a break, screenshot).
 */
export async function runIntake(page: Page, plan: Record<string, Act>, before: Record<string, Act> = {}) {
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    const a = area(page);
    await expect(a).toBeVisible();
    const id = (await a.getAttribute('data-step-id'))!;
    const kind = (await a.getAttribute('data-step-kind'))!;
    if (kind === 'review') return seen;
    if (seen.includes(id)) throw new Error(`intake looped back to ${id}`);
    seen.push(id);
    if (before[id]) await before[id](page);
    const act = plan[id] ?? (kind === 'info' ? primary : kind === 'evidence' ? click('Maybe later') : skip);
    await act(page);
    await expect(a).not.toHaveAttribute('data-step-id', id);
  }
  throw new Error('intake did not reach review');
}

export async function sealFromReview(page: Page) {
  await page.getByRole('button', { name: 'Seal my account' }).click();
  // (the intake's own "Your account is sealed." shows first; wait for the shell's confirmation with the ledger entry)
  await expect(page.getByRole('heading', { name: 'Your account is sealed', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/ledger entry #\d+/)).toBeVisible();
}

// ───────────── fixtures ─────────────

/** A real JPEG drawn by the browser, with an EXIF APP1 segment carrying GPS coordinates spliced in. */
export async function jpegWithGps(page: Page): Promise<Buffer> {
  const b64: string = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#7a9cc6';
    ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#f4d35e';
    ctx.fillRect(8, 8, 24, 24);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  const jpeg = Buffer.from(b64, 'base64');
  return Buffer.concat([jpeg.subarray(0, 2), exifGpsApp1(), jpeg.subarray(2)]);
}

/** Minimal little-endian EXIF: IFD0 → GPS IFD with N 40°29'10" / W 74°26'50" (New Brunswick, NJ — fictional). */
function exifGpsApp1(): Buffer {
  const tiff: number[] = [];
  const u16 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  // header
  tiff.push(0x49, 0x49); u16(42); u32(8);
  // IFD0 @8: 1 entry (GPSInfo pointer) + next=0  → 2 + 12 + 4 = 18 bytes, GPS IFD @26
  u16(1); u16(0x8825); u16(4); u32(1); u32(26); u32(0);
  // GPS IFD @26: 4 entries → 2 + 48 + 4 = 54 bytes, rationals @80
  u16(4);
  u16(1); u16(2); u32(2); tiff.push(0x4e, 0, 0, 0); // GPSLatitudeRef 'N'
  u16(2); u16(5); u32(3); u32(80); //                 GPSLatitude → @80
  u16(3); u16(2); u32(2); tiff.push(0x57, 0, 0, 0); // GPSLongitudeRef 'W'
  u16(4); u16(5); u32(3); u32(104); //                GPSLongitude → @104
  u32(0);
  for (const [n, d] of [[40, 1], [29, 1], [10, 1], [74, 1], [26, 1], [50, 1]]) {
    u32(n);
    u32(d);
  }
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from(tiff)]);
  const len = body.length + 2;
  return Buffer.concat([Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]), body]);
}

export function hasExifGps(buf: Buffer): boolean {
  return buf.includes(Buffer.from('Exif\0\0', 'binary'));
}

export function tinyPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</Author(Demo Author)/Producer(Demo)>>endobj\n' +
      'trailer<</Root 1 0 R/Info 4 0 R>>\n%%EOF\n',
  );
}
