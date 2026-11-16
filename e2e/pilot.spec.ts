/**
 * The pilot build: sealed matching OFF (MATRA_MATCHING=off on the server and in the web build; playwright.pilot.config.ts).
 * A survivor writes, names the person with a phone number and a handle, seals and shares with an attorney, and at no
 * point is she asked about a sealed match or a phone confirmation, nor does the app call a matching route. The server
 * answers 404 matching_disabled on those routes. All data is fictional.
 */
import type { Page } from '@playwright/test';
import {
  ATTORNEY_PASS,
  RUN,
  SURVIVOR_PASS,
  addToStory,
  enough,
  expect,
  fill,
  chip,
  moreDetails,
  nav,
  openTopic,
  registerSurvivor,
  savePage,
  sealFromReview,
  shot,
  signIn,
  signOut,
  storyMap,
  storySafety,
  test,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const ALIAS = `wren-${RUN}`;
const ATTORNEY = 'attorney.nj1';
const ATTORNEY_NAME = 'Demo — Alex Rivera, Esq.';
const NARRATIVE = 'We were at a friend’s place. He would not let me leave the hallway.\n\nI said no, more than once.';
const MATCHING_ROUTE = /\/api\/(matching|escrow|counselor|report-requests|report-releases)(\/|\?|$)/;

/** Every API path this page asks for, from now on. */
function recordApi(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}

test('pilot 1. the server has no sealed matching: every matching route and counselor sign-up answers 404', async ({ request }) => {
  for (const p of ['/api/matching/config', '/api/matching/attestation?nonce=' + 'a'.repeat(64), '/api/escrow', '/api/counselor/groups', '/api/report-requests']) {
    const res = await request.get(p);
    expect([p, res.status()]).toEqual([p, 404]);
    expect(await res.json()).toEqual({ error: 'Sealed matching isn’t part of this service.', code: 'matching_disabled' });
  }
  const reg = await request.post('/api/auth/register', { data: { username: `loc-${RUN}`, role: 'counselor' } });
  expect(reg.status()).toBe(404);
  expect((await reg.json()).code).toBe('matching_disabled');
});

test('pilot 2. she writes, names him with a phone and a handle, seals and shares: no sealed-match question, no phone step, no matching call', async ({ page }) => {
  const api = recordApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  // no way into a counselor portal from the welcome page
  await expect(page.getByTestId('attorney-link')).toBeVisible();
  await expect(page.getByTestId('counselor-link')).toHaveCount(0);

  await registerSurvivor(page, ALIAS);
  await expect(page.getByTestId('home-escrow')).toHaveCount(0);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, NARRATIVE);
  await expect(page.getByTestId('vault-status')).toContainText('Saved to your private space', { timeout: 30_000 });

  // The person: a phone number and a handle — exactly what used to bring up the sealed-match choice.
  await openTopic(page, 'person');
  await fill(page, { 'Name, or what you call them': 'R.', 'How you know them': 'coworker' });
  await moreDetails(page);
  await fill(page, {
    'Their phone number': '(201) 555-0199',
    'Their social media name or handle': '@pilot_handle_123',
    'Which app or site?': { select: 'instagram' },
  });
  await expect(page.locator('[data-topic-panel]').getByText(/sealed match/i)).toHaveCount(0);
  await savePage(page);
  // the person topic ends here: no "Yes, seal it", no "how should a counselor reach you"
  await expect(page.getByText('That’s everything here. Thank you.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, seal it' })).toHaveCount(0);
  await expect(page.locator('[data-topic-panel]').getByText(/counselor/i)).toHaveCount(0);
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();
  if (await page.locator('[data-topic-panel]').count()) await enough(page);

  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await expect(page.getByRole('region', { name: 'Here is everything you shared' })).toBeVisible();
  await sealFromReview(page);
  await expect(page.getByTestId('phone-step-card')).toHaveCount(0);
  await expect(page.getByText(/sealed match/i)).toHaveCount(0);
  await shot(page, 'pilot-01-sealed', { mobile: false });

  await nav(page, 'Home');
  await expect(page.getByTestId('home-story').getByText('Current sealed version')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('home-escrow')).toHaveCount(0);
  await expect(page.getByText(/sealed match/i)).toHaveCount(0);
  await shot(page, 'pilot-02-home');

  // Share with an attorney: works as before.
  await nav(page, 'Sharing');
  const card = page.locator('li.card', { hasText: ATTORNEY_NAME });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Review and decide' }).click();
  await expect(page.locator('.consent-text')).toContainText('My written account is always shared.');
  await expect(page.locator('.consent-text')).not.toContainText(ALIAS); // a made-up label, never her username
  await page.getByLabel('I agree to the statement above.').check();
  await page.getByRole('button', { name: `Yes, share with ${ATTORNEY_NAME}` }).click();
  await expect(page.getByRole('heading', { name: `Shared with ${ATTORNEY_NAME}` })).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  // The survivor's whole session never asked for a matching route (a sealed match, a phone check, report requests).
  expect(api.filter((a) => MATCHING_ROUTE.test(a))).toEqual([]);
  expect(api).toEqual(expect.arrayContaining(['POST /api/vault/records', 'POST /api/shares']));
  // Her draft autosaved to its slot (saved over in place); the only new record was the seal.
  expect(api.filter((a) => a === 'POST /api/vault/records')).toHaveLength(1);
  expect(api.filter((a) => /^PUT \/api\/vault\/slots\/[0-9a-f]{64}$/.test(a)).length).toBeGreaterThan(0);
});

test('pilot 2b. she signs in again and adds to her sealed version: it opens where she left it, and only the seal is ledgered', async ({ page, request }) => {
  const head = async () => ((await (await request.get('/api/ledger/head')).json()) as { seq: number }).seq;
  const api = recordApi(page);
  await signIn(page, ALIAS, SURVIVOR_PASS);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  // her words are there (resumed from her draft slot, which sealing kept), and no safety question again
  await expect(page.locator('.space-journal .space-entry-text').first()).toHaveText(NARRATIVE);
  const before = await head();
  await addToStory(page, 'Later I remembered the music was very loud.');
  await expect(page.getByTestId('vault-status')).toContainText('Saved to your private space', { timeout: 30_000 });
  // an autosave is a slot write: no record, no ledger entry
  expect(await head()).toBe(before);
  expect(api.filter((a) => a === 'POST /api/vault/records')).toHaveLength(0);

  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await expect(page.getByTestId('notice-saved-versions')).toContainText('Sealed versions are kept');
  await sealFromReview(page);
  expect(await head()).toBe(before + 1);
  expect(api.filter((a) => a === 'POST /api/vault/records')).toHaveLength(1);
  await nav(page, 'Home');
  const acct = page.getByTestId('home-story');
  await expect(acct.getByTestId('sealed-current')).toBeVisible({ timeout: 60_000 });
  await expect(acct.getByTestId('sealed-earlier')).toHaveCount(1);
  await signOut(page);
});

test('pilot 2c. a seal never loses her words: no draft save, no seal; a seal whose follow-up save fails keeps trying', async ({ page, consoleProblems }) => {
  const alias = `wren-seal-${RUN}`;
  // The aborted slot writes below are deliberate: the browser reports each one; those reports (only) are expected.
  const dropExpectedAborts = () => {
    const kept = consoleProblems.filter((p) => !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(p));
    expect(consoleProblems.length - kept.length).toBeGreaterThan(0);
    consoleProblems.splice(0, consoleProblems.length, ...kept);
  };
  const journal = page.locator('.space-journal .space-entry-text');
  await registerSurvivor(page, alias);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, 'FIRST part, autosaved.');
  await expect(page.getByTestId('vault-status')).toContainText('Saved to your private space', { timeout: 30_000 });
  await addToStory(page, 'SECOND part, written in the last minute before sealing.');

  // 1. Her draft can't be saved (every slot write fails): nothing is sealed, and she is told.
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/vault/records') posts.push(r.url());
  });
  await page.route(/\/api\/vault\/slots\//, (route) => (route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue()));
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: 'Seal my account' }).click();
  await expect(page.getByRole('alert')).toContainText(/couldn’t save your draft just now, so nothing was sealed/, { timeout: 30_000 });
  expect(posts).toHaveLength(0);
  await page.unroute(/\/api\/vault\/slots\//);
  dropExpectedAborts();

  // 2. Sealed, but the save after it (marking the draft with the seal) fails: her page keeps the draft and says so.
  await page.route(/\/api\/vault\/slots\//, (route) =>
    route.request().method() === 'PUT' && posts.length > 0 ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Your account is sealed', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(posts).toHaveLength(1);
  const pending = page.getByTestId('seal-mark-pending');
  await expect(pending).toBeVisible();
  await page.unroute(/\/api\/vault\/slots\//);
  dropExpectedAborts();
  await pending.getByRole('button', { name: /Save now|Try again/ }).click();
  await expect(pending).toHaveCount(0, { timeout: 30_000 });
  await signOut(page);

  // 3. After signing in again: nothing missing, and Home doesn't claim a newer draft.
  await signIn(page, alias, SURVIVOR_PASS);
  await expect(page.getByTestId('tile-story')).toContainText('Sealed and safe', { timeout: 60_000 });
  await expect(page.getByTestId('tile-story')).not.toContainText('newer draft');
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await expect(journal).toHaveText(['FIRST part, autosaved.', 'SECOND part, written in the last minute before sealing.']);
  await addToStory(page, 'THIRD part, added later.');
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  const review = page.getByRole('region', { name: 'Here is everything you shared' });
  await expect(review.locator('.space-review-entry .space-verbatim')).toHaveText([
    'FIRST part, autosaved.',
    'SECOND part, written in the last minute before sealing.',
    'THIRD part, added later.',
  ]);
  await signOut(page);
});

test('pilot 2d. words she typed but did not add are still there after she seals and signs in again', async ({ page }) => {
  const alias = `wren-unsent-${RUN}`;
  await registerSurvivor(page, alias);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, 'An added part.');
  await expect(page.getByTestId('vault-status')).toContainText('Saved to your private space', { timeout: 30_000 });
  const box = page.getByLabel('What you would like to share');
  if (!(await box.count())) await page.getByRole('button', { name: /Add more/ }).click();
  await page.getByLabel('What you would like to share').fill('UNSENT words she typed but did not add.');
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);
  await signOut(page);
  await signIn(page, alias, SURVIVOR_PASS);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  if (!(await page.getByLabel('What you would like to share').count())) await page.getByRole('button', { name: /Add more/ }).click();
  await expect(page.getByLabel('What you would like to share')).toHaveValue('UNSENT words she typed but did not add.');
  await signOut(page);
});

test('pilot 2e. part of her space doesn’t match what she saved: she reads and keeps writing in her draft; sealing and sharing stay off', async ({ page }) => {
  const alias = `wren-mismatch-${RUN}`;
  const journal = page.locator('.space-journal .space-entry-text');
  await registerSurvivor(page, alias);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, 'BEFORE the seal.');
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/vault/records') posts.push(r.url());
  });

  // A. Her newest seal is gone from the list (as after restoring the main database from an older backup), while her
  //    draft still says it became that seal.
  let hidden: string | null = null;
  await page.route(/\/api\/vault\/records$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { records: Array<{ id: string; createdAt: string }> };
    hidden ??= [...body.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.id;
    await route.fulfill({ response: res, json: { records: body.records.filter((r) => r.id !== hidden) } });
  });
  await nav(page, 'Sharing');
  await expect(page.getByTestId('vault-stopped')).toContainText('doesn’t match what you saved', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Review and decide' })).toHaveCount(0);
  await nav(page, 'My story');
  await expect(page.getByTestId('vault-stopped')).toContainText('doesn’t match what you saved', { timeout: 60_000 });
  await expect(page.getByTestId('draft-words')).toContainText('BEFORE the seal.');
  await page.getByRole('button', { name: 'Keep writing in your draft' }).click();
  await expect(page.getByTestId('story-draft-only')).toBeVisible();
  await expect(journal).toHaveText(['BEFORE the seal.']);
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/vault\/slots\//.test(r.url()) && r.ok(), { timeout: 60_000 });
  await addToStory(page, 'AFTER, written while the seal was missing.');
  await saved;
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: 'Seal my account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sealing is off for now' })).toBeVisible({ timeout: 30_000 });
  expect(posts).toHaveLength(0);
  // Her save no longer names the lost seal, so her space opens cleanly again (still without that seal)
  await nav(page, 'Home');
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('vault-stopped')).toHaveCount(0);
  await expect(journal).toHaveText(['BEFORE the seal.', 'AFTER, written while the seal was missing.']);
  await page.unroute(/\/api\/vault\/records$/);

  // B. One byte of her sealed version was changed on the server.
  await page.route(/\/api\/vault\/records\/[^/]+$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { record: { envelope: { ct: string } } };
    const ct = body.record.envelope.ct;
    const i = Math.floor(ct.length / 2);
    body.record.envelope.ct = ct.slice(0, i) + (ct[i] === 'A' ? 'B' : 'A') + ct.slice(i + 1);
    await route.fulfill({ response: res, json: body });
  });
  await nav(page, 'Home');
  await nav(page, 'My story');
  await expect(page.getByTestId('vault-stopped')).toContainText('doesn’t match what you saved', { timeout: 60_000 });
  await expect(page.getByTestId('draft-words')).toContainText('AFTER, written while the seal was missing.');
  await page.getByRole('button', { name: 'Keep writing in your draft' }).click();
  await expect(journal).toHaveText(['BEFORE the seal.', 'AFTER, written while the seal was missing.']);
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: 'Seal my account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sealing is off for now' })).toBeVisible({ timeout: 30_000 });
  await nav(page, 'Sharing');
  await expect(page.getByTestId('vault-stopped')).toContainText('doesn’t match what you saved', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Review and decide' })).toHaveCount(0);
  expect(posts).toHaveLength(0);
  await page.unroute(/\/api\/vault\/records\/[^/]+$/);
  await signOut(page);
});

test('pilot 2f. she changes her passphrase: her other device is signed out, the old one stops working, her draft and sealed version still open', async ({ page, browser }, testInfo) => {
  const alias = `wren-newpass-${RUN}`;
  await registerSurvivor(page, alias);
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  await storySafety(page, 'Yes');
  await addToStory(page, 'SEALED before the change.');
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);

  // the same account open on a second device
  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page2 = await other.newPage();
  await signIn(page2, alias, SURVIVOR_PASS);

  // Home → Your data → Passphrase and devices
  await nav(page, 'Home');
  await page.getByTestId('passphrase-link').click();
  await expect(page.getByTestId('passphrase-title')).toHaveText('Passphrase and devices');
  await expect(page.getByTestId('session-list').locator('li')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId('change-caveat')).toContainText('may have kept a copy of the key that unlocks it');
  await page.getByTestId('change-current').fill(SURVIVOR_PASS);
  await page.getByRole('button', { name: 'Use this passphrase' }).click();
  const newPass = await page.getByTestId('change-new').inputValue();
  expect(newPass.split('-')).toHaveLength(6);
  await page.getByTestId('change-new-again').fill(newPass);
  await page.getByTestId('change-submit').click();
  await expect(page.getByTestId('change-done')).toContainText('1 other session was signed out', { timeout: 90_000 });
  await expect(page.getByTestId('session-list').locator('li')).toHaveCount(1);

  // the other device: its next request is refused, and it forgets everything and says why
  await nav(page2, 'My story');
  await expect(page2.getByTestId('signin-ended')).toBeVisible({ timeout: 60_000 });
  await other.close();

  // the old passphrase no longer opens it; the new one does, to the same draft and seal
  await signOut(page);
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await page.getByLabel('Alias').fill(alias);
  await page.getByLabel('Passphrase').fill(SURVIVOR_PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('That alias and passphrase don’t match. Check for typos and try again.', { timeout: 60_000 });
  await signIn(page, alias, newPass);
  await expect(page.getByTestId('tile-story')).toContainText('Sealed and safe', { timeout: 60_000 });
  await expect(page.getByTestId('home-activity')).toContainText('You changed your passphrase');
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
  // her draft slot (opaque name from the unchanged account secret) still opens, at the sealed version
  await expect(page.locator('.space-journal .space-entry-text')).toHaveText(['SEALED before the change.']);
  await signOut(page);
});

test('pilot 3. the attorney opens and verifies what she shared', async ({ page }) => {
  const api = recordApi(page);
  await signIn(page, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByRole('heading', { name: /^Client [BCDFGHJKLMNPQRSTVWXZ2-9]{5}$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('main')).not.toContainText(ALIAS);
  await expect(page.getByTestId('case-verification').getByText('Verified ✓')).toBeVisible();
  await expect(page.getByTestId('case-checks').locator('[data-check="account"]')).toHaveAttribute('data-tone', 'ok');
  expect(await page.locator('.brief-verbatim-text').allTextContents()).toContain(NARRATIVE);
  await shot(page, 'pilot-03-attorney-case', { mobile: false });
  await signOut(page);
  expect(api.filter((a) => MATCHING_ROUTE.test(a))).toEqual([]);
});
