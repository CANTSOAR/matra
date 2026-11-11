/**
 * The whole demo path on the demo stack (`npm run demo`; playwright.demo.config.ts, docs/DEMO_SCRIPT.md): seeded
 * fictional accounts, three key holders, the separate matcher, and the Server view next to the app. All data is
 * fictional. Tests run in order on one freshly reset stack.
 */
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import type { InspectorSnapshot } from '@matra/shared';
import { addToStory, chip, expect, fill, moreDetails, nav, openTopic, savePage, sealFromReview, signIn, signOut, storyMap, storySafety, test, verifyPhone } from './helpers';

test.describe.configure({ mode: 'serial' });

const SURVIVOR_PASS = 'demo-survivor-passphrase';
const ATTORNEY_PASS = 'demo-attorney-passphrase';
const COUNSELOR_PASS = 'demo-counselor-passphrase';
// What Jane types live. None of it may ever be found in what a server holds.
const JANE_STORY = 'We met at the lighthouse cafe after the concert. He kept my phone so I could not call anyone.';
const JANE_PHONE = '(201) 555-0113';
const JANE_CONTACT = '(555) 010-0213';

async function counselorSignIn(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('link', { name: 'I’m an attorney' }).click();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Passphrase').fill(COUNSELOR_PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Matched sealed reports' })).toBeVisible({ timeout: 90_000 });
}

/** The Server view's "look for something she typed": where the app server's database (full values) and the others hold it. */
async function look(inspector: Page, text: string) {
  await inspector.getByLabel('Look for something she typed').fill(text);
  await inspector.getByRole('button', { name: 'Look' }).click();
  const found = inspector.getByTestId('insp-found');
  await expect(found).toContainText(`“${text}”`, { timeout: 15_000 });
  return found;
}
const nowhere = 'is not in any column of any table in the app server’s database, and not in what the key holders or the matcher hold.';

test('1. Server view: every process of the seeded stack, and nothing anyone wrote is readable on any server', async ({ page, request }) => {
  await page.goto('/inspector');
  await expect(page.getByRole('heading', { name: 'Server view' })).toBeVisible();
  const procs = page.getByTestId('insp-process');
  await expect(procs).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator('[data-testid="insp-process"][data-role="holder"]')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Key holder 3' })).toContainText('Holds ONE share of the matching key');
  // The matcher: Sam's and Morgan's entries with the states it opened, the group given to one counselor, a SIMULATED attestation.
  const matcher = page.getByRole('region', { name: 'Matcher' });
  await expect(matcher).toContainText('SIMULATED');
  await expect(matcher.locator('[data-table="matcher_entries"] .insp-count')).toHaveText('2');
  await expect(matcher.locator('[data-table="matcher_assignments"]')).toContainText('incident_state:NY');
  // The app server: phone tokens are a hash and a count; sealed entries are ciphertext.
  const app = page.getByRole('region', { name: 'App server' });
  await expect(app.locator('[data-table="phone_tokens"] .insp-count')).toHaveText('2');
  await expect(app.locator('[data-table="match_entries"] .insp-readable')).toHaveCount(0);

  // Search the full values of every column: the handle three survivors named, words from the seeded stories, the
  // seeded contact details. Nowhere. (And the search does work: the alias is there.)
  for (const text of ['demo_handle_123', 'rooftop party', 'record shop', 'landlord', '555-0201', 'm.reyes@example.com'])
    await expect(await look(page, text)).toContainText(nowhere);
  await expect(await look(page, 'taylor.demo')).toContainText('app server users.username');

  // The raw endpoint: no client IP anywhere, and redaction of what is never stored.
  const raw = await (await request.get('/api/dev/inspector')).text();
  expect(raw).not.toMatch(/127\.0\.0\.1|::1|::ffff:/);
  expect(raw).not.toContain('demo_handle');
});

test('2. the attorney opens the story Riley shared with them (seeded), decrypted on the attorney’s device, and the browser verifies it; the PDF and files check out on /verify', async ({ page }) => {
  await signIn(page, 'attorney.nj1', ATTORNEY_PASS, 'attorney');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByRole('heading', { name: 'Client: riley.demo' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('main')).toContainText('He was my landlord.');
  const checks = page.getByTestId('case-checks');
  await expect(checks.locator('[data-check="account"]')).toContainText('This account has not changed since it was sealed on');
  await expect(checks.locator('[data-check="chain"]')).toContainText(/Ledger chain intact through entry \d+\./);
  await page.getByRole('button', { name: 'Check all 3 evidence files' }).click();
  await expect(checks.locator('[data-check="evidence"]')).toContainText('3 of 3 evidence files match.', { timeout: 30_000 });
  await expect(checks.locator('[data-tone="bad"]')).toHaveCount(0);

  // The files and the summary PDF, as they would be emailed on, checked in the browser on /verify
  const files: Array<{ name: string; mimeType: string; buffer: Buffer }> = [];
  for (const link of await page.getByRole('link', { name: 'Download (verified ✓)' }).all()) {
    const dl = page.waitForEvent('download');
    await link.click();
    const d = await dl;
    files.push({ name: d.suggestedFilename(), mimeType: 'text/plain', buffer: fs.readFileSync((await d.path())!) });
  }
  expect(files).toHaveLength(3);
  const pdfDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download incident summary (PDF)' }).click();
  const pdf = fs.readFileSync((await (await pdfDl).path())!);
  await page.getByRole('link', { name: '← All files' }).click();
  await page.getByRole('link', { name: 'Check a file' }).click();
  await page.getByLabel('Choose files to check').setInputFiles([{ name: 'riley-summary.pdf', mimeType: 'application/pdf', buffer: pdf }, ...files]);
  const result = page.getByTestId('verify-result');
  await expect(result).toHaveAttribute('data-tone', 'ok', { timeout: 30_000 });
  await expect(result).toContainText('3 of 3 evidence files match.');
  await expect(result).toContainText(/Ledger chain intact through entry \d+\./);
  await page.getByTestId('lock-signout').click();
  await expect(page.getByRole('heading', { name: 'For attorneys' })).toBeVisible();
});

test('3. Jane, live: confirms a phone, tells her story naming the same profile, seals; the Server view shows what she typed on her device only', async ({ page, context }) => {
  const inspector = await context.newPage();
  await inspector.goto('/inspector');
  await expect(inspector.getByTestId('insp-device')).toBeVisible({ timeout: 30_000 });

  await signIn(page, 'jane.demo', SURVIVOR_PASS);
  await page.getByTestId('home-matching-link').click();
  await verifyPhone(page, JANE_PHONE);
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, JANE_STORY);
  await openTopic(page, 'person');
  await fill(page, { 'Name, or what you call them': 'D.', 'How you know them': 'met at a concert' });
  await chip(page, 'Did you know this person before?', 'No');
  await moreDetails(page);
  await fill(page, { 'Their social media name or handle': '@demo_handle_123', 'Which app or site?': { select: 'instagram' } });
  await savePage(page);
  await chip(page, 'D.', 'Yes, seal it');
  await savePage(page);
  await chip(page, 'Best way to reach you', 'Text message');
  await fill(page, { 'Phone number or email to use': JANE_CONTACT });
  await savePage(page);
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();
  await openTopic(page, 'whenWhere');
  await savePage(page);
  await expect(page.locator('[data-topic-panel]').getByLabel('Where did it happen? Describe it any way you can.')).toBeVisible();
  await savePage(page);
  await fill(page, { State: { select: 'NY' } });
  await savePage(page);
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);
  await expect(page.getByText(/sealed match could not be set up/)).toHaveCount(0);
  await nav(page, 'Home');
  await expect(page.getByTestId('home-escrow').locator('.badge')).toHaveText(['Sealed']);
  await signOut(page);

  // Her device column has what she typed (same browser, never a server)…
  const device = inspector.getByTestId('insp-device');
  await expect(device).toContainText('lighthouse cafe');
  await expect(device).toContainText('instagram:demo_handle_123 · happened in NY');
  await expect(device).toContainText(JANE_PHONE);
  // …and none of it is anywhere a server keeps things.
  for (const text of ['lighthouse cafe', 'demo_handle_123', '555-0113', '555-0213']) await expect(await look(inspector, text)).toContainText(nowhere);
  // The requests the app server received: the phone number and code redacted with the reason, the story as ciphertext.
  const snap = (await (await inspector.request.get('/api/dev/inspector')).json()) as InspectorSnapshot;
  const received = snap.processes.find((p) => p.role === 'app')!.requests!;
  const phoneStart = received.find((r) => r.route === '/api/matching/verification/start')!;
  expect((phoneStart.body as Record<string, string>).phone).toMatch(/^\[redacted: never stored: the number is checked with the SMS provider/);
  const check = received.find((r) => r.route === '/api/matching/verification/check')!;
  expect((check.body as Record<string, string>).code).toMatch(/^\[redacted: never stored/);
  const story = received.find((r) => r.method === 'POST' && r.route === '/api/vault/records')!;
  expect(JSON.stringify(story.body)).toContain('"alg":"A256GCM"');
  // Each key holder evaluated blinded elements for her (2 of 3 suffice; all 3 are up).
  for (const i of [1, 2, 3])
    await expect(inspector.getByRole('region', { name: `Key holder ${i}` }).locator('[data-table="evaluations (memory, demo only)"] .insp-row').first()).toBeVisible();
  // The matcher now has three entries on the same tag; the group stays with the counselor licensed in NY.
  const matcher = inspector.getByRole('region', { name: 'Matcher' });
  await expect(matcher.locator('[data-table="matcher_entries"] .insp-count')).toHaveText('3', { timeout: 30_000 });
  await inspector.close();
});

test('4. routing on both states: counselor.ny gets the group of three (it happened in NY); counselor.nj (where Sam lives) and counselor.pa see nothing; Taylor said no to matching and is in no group', async ({ page }) => {
  for (const other of ['counselor.nj', 'counselor.pa']) {
    await counselorSignIn(page, other);
    await expect(page.getByText('No matches right now.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('counselor-group')).toHaveCount(0);
    await page.getByTestId('lock-signout').click();
  }

  await counselorSignIn(page, 'counselor.ny');
  const groups = page.getByTestId('counselor-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.getByTestId('counselor-assignment')).toContainText('this happened in New York, where you’re licensed');
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  await expect(groups.getByTestId('counselor-canonical')).toHaveText(['instagram:demo_handle_123', 'instagram:demo_handle_123', 'instagram:demo_handle_123'], { timeout: 30_000 });
  const people = groups.getByTestId('counselor-survivor');
  await expect(people).toHaveCount(3);
  // Stage 1: how each wants to be reached, no numbers or addresses until her conflict check.
  await expect(people.getByTestId('counselor-contact-hidden')).toHaveCount(3);
  await expect(groups).not.toContainText('(555) 010-0201');
  await expect(groups).not.toContainText('m.reyes@example.com');
  const conflict = groups.getByTestId('counselor-conflict-check');
  await expect(conflict).toContainText('New York');
  await conflict.getByRole('button', { name: 'I have no conflict' }).click();
  await expect(groups.getByTestId('counselor-conflict-done')).toBeVisible({ timeout: 30_000 });
  // Three separate contact bundles: Sam by text, Morgan by email, Jane by text. No account names.
  await expect(people.filter({ hasText: '(555) 010-0201' })).toHaveCount(1, { timeout: 30_000 });
  await expect(people.filter({ hasText: 'm.reyes@example.com' })).toHaveCount(1);
  await expect(people.filter({ hasText: JANE_CONTACT })).toHaveCount(1);
  for (const alias of ['sam.demo', 'morgan.demo', 'jane.demo', 'taylor.demo']) await expect(groups).not.toContainText(alias);
  await page.getByTestId('lock-signout').click();
});

test('5. staged release with one survivor who says no: the counselor asks Jane and Morgan for their full reports; Jane agrees, Morgan does not; only Jane’s report opens, and the server holds a wrapped key, never the report', async ({ page }) => {
  await counselorSignIn(page, 'counselor.ny');
  const groups = page.getByTestId('counselor-group');
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  const people = groups.getByTestId('counselor-survivor');
  const jane = people.filter({ hasText: JANE_CONTACT });
  const morgan = people.filter({ hasText: 'm.reyes@example.com' });
  await expect(jane).toHaveCount(1, { timeout: 30_000 });
  for (const person of [jane, morgan]) {
    await person.getByLabel('I’ve spoken with this person and they expect this request.').check();
    await person.getByRole('button', { name: 'Ask for their full report' }).click();
    await expect(person.getByTestId('counselor-report-request')).toContainText('They haven’t decided', { timeout: 30_000 });
  }
  await page.getByTestId('lock-signout').click();

  await signIn(page, 'jane.demo', SURVIVOR_PASS);
  await page.getByTestId('home-report-request').getByRole('link', { name: 'See the request' }).click();
  await expect(page.getByTestId('report-request-title')).toBeVisible({ timeout: 30_000 });
  // the counselor's key is on the organization-signed roster this build pins: nothing for her to compare by hand
  await expect(page.getByText('This key is on the counselor list signed by Matra’s organization, so it has been checked for you.')).toBeVisible();
  await page.getByLabel('I agree to the statement above.').check();
  await page.getByRole('button', { name: 'Yes, share my report' }).click();
  await expect(page.getByTestId('report-request-shared')).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  await signIn(page, 'morgan.demo', SURVIVOR_PASS);
  await page.getByTestId('home-report-request').getByRole('link', { name: 'See the request' }).click();
  await expect(page.getByTestId('report-request-title')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'No, don’t share' }).click();
  await expect(page.getByTestId('report-request-declined')).toBeVisible({ timeout: 30_000 });
  await signOut(page);

  await counselorSignIn(page, 'counselor.ny');
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  await expect(morgan.getByTestId('counselor-report-request')).toContainText('They decided not to share their report.', { timeout: 30_000 });
  await expect(morgan.getByRole('link', { name: 'Open their report' })).toHaveCount(0);
  await jane.getByRole('link', { name: 'Open their report' }).click();
  await expect(page.getByTestId('counselor-report-title')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.brief-verbatim-text').first()).toContainText('lighthouse cafe');
  await page.getByRole('link', { name: '← Matched sealed reports' }).click();
  await page.getByTestId('lock-signout').click();

  // The server holds one release: Jane's content key wrapped to the counselor's public key. Her story is still nowhere.
  await page.goto('/inspector');
  const app = page.getByRole('region', { name: 'App server' });
  await expect(app.locator('[data-table="report_releases"] .insp-count')).toHaveText('1', { timeout: 30_000 });
  await expect(app.locator('[data-table="report_requests"] .insp-count')).toHaveText('2');
  await expect(await look(page, 'lighthouse cafe')).toContainText(nowhere);
});
