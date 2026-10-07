/**
 * The live demo path (docs/DEMO_SCRIPT.md), end to end, in a real browser. All data is fictional.
 * Tests run in order and share the survivor accounts they create.
 */
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import {
  ATTORNEY_PASS,
  QUICK_EXIT_HOST,
  RUN,
  SURVIVOR_PASS,
  click,
  expect,
  fields,
  hasExifGps,
  jpegWithGps,
  nav,
  primary,
  registerSurvivor,
  runIntake,
  sealFromReview,
  shot,
  signIn,
  signOut,
  skip,
  test,
  tinyPdf,
  type,
  type Act,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const ALIAS_A = `bluebird-${RUN}`;
const ALIAS_B = `sparrow-${RUN}`;
const ATTORNEY = 'attorney.nj1';
const ATTORNEY_NAME = 'Demo — Alex Rivera, Esq.';

const NARRATIVE =
  "We were at a party at a coworker's apartment. I remember the music was too loud and the hallway smelled like cologne.\n\n" +
  'He said he\'d walk me to my car… I said "no thanks, I\'m fine" — twice.\nI don\'t remember the drive home clearly.';

const PERSON = (handle: string, name = 'R.'): Act =>
  fields({
    'Name, or what you call them': name,
    'Did you know this person before?': { chip: 'Yes' },
    'How you know them': 'coworker',
    'Their phone number': '(555) 010-0199',
    'Their social media name or handle': handle,
    'Which app or site?': { select: 'instagram' },
  });

const sealYes: Act = async (page) => {
  await page.locator('.intake-answer-area').getByRole('button', { name: 'Yes, seal it' }).click();
  await primary(page);
};

const FULL_PLAN: Record<string, Act> = {
  'safety.now': click("Yes, I'm safe"),
  'about.name': type('J.'),
  'about.pronouns': type('she/her'),
  'about.language': type('English'),
  'about.contactMethods': async (page) => {
    await page.locator('.intake-answer-area').getByRole('button', { name: 'Text message' }).click();
    await primary(page);
  },
  'about.phone': type('(555) 010-0100'),
  'about.home': fields({ State: { select: 'NJ' }, County: 'Middlesex' }),
  'when.date': async (page) => {
    const a = page.locator('.intake-answer-area');
    await a.getByRole('button', { name: 'Describe it in words' }).click();
    await a.getByLabel('Describe when, in your own words').fill('around March 14, not sure of the exact day');
    await primary(page);
  },
  'when.repeated': click('No'),
  'when.time': type('late at night'),
  'where.place': type("A party at a coworker's apartment"),
  'where.area': fields({ 'City or town': 'New Brunswick', County: 'Middlesex', State: { select: 'NJ' } }),
  'story.freeRecall': type(NARRATIVE),
  'recall.sight': type('A dim hallway with a blue rug.'),
  'recall.sound': type('The music was too loud.'),
  'recall.smell': type('The hallway smelled like cologne.'),
  'context.before': type('I was at the party with my roommate M.'),
  'context.after': type('I got home and went to sleep. I texted M. the next morning.'),
  'details.force': async (page) => {
    await page.locator('.intake-answer-area').getByRole('button', { name: 'Being held, tied, or blocked from leaving' }).click();
    await primary(page);
  },
  'details.forceWords': type('He stood in the doorway so I could not leave.'),
  'details.strangulation': click("I'm not sure"),
  'details.substances': async (page) => {
    await page.locator('.intake-answer-area').getByRole('button', { name: 'I had been drinking' }).click();
    await primary(page);
  },
  'details.incapacitated': click('No'),
  'person.list': PERSON('@demo_handle_123'),
  'person.escrow': sealYes,
  'people.told': fields({
    'Who you told': 'M. (roommate)',
    'About when': 'the next morning',
    'How you told them': { select: 'text' },
    'What you remember saying': 'something bad happened last night',
  }),
  'medical.care': click('No'),
  'prior.any': click('Yes'),
  'prior.list': fields({
    'Who you reported to': 'HR at my job',
    'What kind of place was it?': { select: 'employer' },
    'About when': 'a week later',
  }),
  'safety.access': click('Yes'),
  'safety.protective': click("I'm not sure"),
  'costs.intro': click('Skip this part'),
  'goals.police': click("I'm not sure"),
  'goals.attorney': click('Yes'),
  'goals.compensation': click('Yes'),
  'comp.mailing': fields({ 'City or town': 'New Brunswick', State: { select: 'NJ' }, 'ZIP code': '08901' }),
  'comp.claimant': click('Yes, for myself'),
  'goals.protective': click("I'm not sure"),
  // deliberately skipped: legal name, date of birth, address, touch/taste, words said, witnesses, injuries, safety notes
  'about.legalName': skip,
  'about.dob': skip,
};

async function openStory(page: Page) {
  await nav(page, 'Your account');
  await expect(page.locator('.intake-answer-area')).toBeVisible({ timeout: 60_000 });
}

test('1. survivor registers (18+ gate), completes intake (skips + a break), seals; dashboard shows ledger + verified', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  await shot(page, '01-welcome');

  // Under 18: a kind message with age-appropriate help; nothing is sent to the server.
  await page.getByRole('link', { name: 'Get started' }).click();
  const registerCalls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/auth/register') && registerCalls.push(r.url()));
  await page.getByRole('button', { name: 'I’m under 18' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you for telling us' })).toBeVisible();
  await expect(page.getByRole('link', { name: '1-800-422-4453' })).toHaveAttribute('href', 'tel:+18004224453');
  await shot(page, '01b-under-18', { mobile: false });
  await page.getByRole('button', { name: 'Go back' }).click();
  expect(registerCalls).toEqual([]);

  await registerSurvivor(page, ALIAS_A);
  await shot(page, '02-dashboard-empty', { mobile: false });
  await openStory(page);

  const seen = await runIntake(page, FULL_PLAN, {
    'recall.sound': async (p) => {
      await shot(p, '03-intake-midway');
      await p.getByRole('button', { name: 'Take a break' }).click();
      const dialog = p.getByRole('dialog', { name: 'Take a break' });
      await expect(dialog).toBeVisible();
      await shot(p, '04-take-a-break', { mobile: false });
      await dialog.getByRole('button', { name: "I'm ready to keep going" }).click();
      await expect(dialog).toBeHidden();
    },
  });
  expect(seen).toContain('person.escrow');

  // Review: words verbatim, skipped questions marked
  const review = page.locator('.intake-review');
  await expect(review).toBeVisible();
  await expect(review.getByText('Skipped', { exact: true }).first()).toBeVisible();
  const narrativeDd = review.locator('dd.intake-verbatim').filter({ hasText: 'He said he' });
  expect(await narrativeDd.textContent()).toBe(NARRATIVE);
  await shot(page, '05-review');

  await sealFromReview(page);
  await expect(page.getByText(/ledger entry #\d+/)).toBeVisible();
  await shot(page, '06-sealed', { mobile: false });
  expect(seen).toEqual(expect.arrayContaining(['details.strangulationInfo', 'comp.mailing', 'wishes.access']));
  expect(seen.indexOf('details.force')).toBeGreaterThan(seen.indexOf('story.freeRecall'));

  await nav(page, 'Your vault');
  const acct = page.locator('section', { has: page.getByRole('heading', { name: 'Your account of what happened' }) });
  await expect(acct.getByText('Current sealed account')).toBeVisible({ timeout: 60_000 });
  await expect(acct.getByText('Verified ✓')).toBeVisible();
  await expect(acct.getByText(/ledger entry #\d+/)).toBeVisible();
  const escrow = page.locator('section', { has: page.getByRole('heading', { name: 'Sealed escrow' }) });
  // phone + handle; a bare initial ("R.") is too weak to seal
  await expect(escrow.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrow.getByText('R. · social media handle (instagram)')).toBeVisible();
  // the client labels the seal (it can decrypt its own records); the server only knows "saved"
  const activity = page.locator('section', { has: page.getByRole('heading', { name: 'Activity' }) });
  await expect(activity.getByText('You sealed your account')).toBeVisible();
  await shot(page, '07-dashboard');
});

test('2. evidence: JPEG GPS is stripped and hashed; PDF warns metadata kept; re-seal attaches files', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Evidence');
  await expect(page.getByRole('heading', { name: 'Evidence', level: 1 })).toBeVisible();

  const jpeg = await jpegWithGps(page);
  expect(hasExifGps(jpeg)).toBe(true);
  await page.getByLabel('What is it? (optional)').fill('Photo of the hallway (fictional)');
  await page.getByLabel('Choose evidence files').setInputFiles({ name: 'hallway.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const added = page.locator('section', { has: page.getByRole('heading', { name: 'Added just now' }) });
  const jpgRow = added.locator('li', { hasText: 'hallway.jpg' });
  await expect(jpgRow.getByText('Hidden details removed')).toBeVisible({ timeout: 60_000 });
  await expect(jpgRow.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();
  await expect(page.getByText('Saved to your vault and attached to your draft account.')).toBeVisible();

  await page.getByLabel('Choose evidence files').setInputFiles({ name: 'texts-export.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
  const pdfRow = added.locator('li', { hasText: 'texts-export.pdf' });
  await expect(pdfRow.getByText('Hidden details not removed')).toBeVisible({ timeout: 60_000 });
  await expect(pdfRow.getByText(/couldn’t remove hidden details from this PDF/)).toBeVisible();
  await shot(page, '08-evidence');

  // The stored copy really has no EXIF: decrypt it from the vault and download it.
  await nav(page, 'Your vault');
  await nav(page, 'Evidence');
  const vaultRow = page.locator('section', { has: page.getByRole('heading', { name: 'In your vault' }) }).locator('li', { hasText: 'hallway.jpg' });
  await vaultRow.getByRole('button', { name: 'Decrypt & view' }).click();
  await expect(vaultRow.getByText('Verified ✓')).toBeVisible();
  const dl = page.waitForEvent('download');
  await vaultRow.getByRole('link', { name: 'Download' }).click();
  const stored = fs.readFileSync((await (await dl).path())!);
  expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(hasExifGps(stored)).toBe(false);

  // Re-seal so the files are part of the sealed account (and shareable).
  await openStory(page);
  await expect(page.getByText('2 evidence file(s) will be attached when you seal.')).toBeVisible();
  await expect(page.locator('.intake-review')).toBeVisible();
  await sealFromReview(page);
  await nav(page, 'Your vault');
  const acct = page.locator('section', { has: page.getByRole('heading', { name: 'Your account of what happened' }) });
  await expect(acct.getByText('Current sealed account')).toBeVisible({ timeout: 60_000 });
  await expect(acct.getByText(/2 evidence item\(s\)/).first()).toBeVisible();
});

test('3. incident summary: her words verbatim; summary + VCCO draft download as PDFs; "Download my data" zip', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Incident summary');
  const preview = page.locator('.brief-doc');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(preview.getByRole('heading', { name: 'Incident Summary in the Survivor’s Own Words' })).toBeVisible();
  const quotes = await preview.locator('.brief-verbatim-text').allTextContents();
  expect(quotes).toContain(NARRATIVE);
  // her answers are printed as she gave them
  await expect(preview.getByText('Survivor answered: Yes, I’m safe')).toBeVisible();
  await expect(preview.getByText('Survivor answered: I’m not sure').first()).toBeVisible();
  await expect(preview.getByText(/can cause internal injury/)).toBeVisible();
  await expect(preview.getByText('He stood in the doorway so I could not leave.')).toBeVisible();
  // compensation-only details never appear in the summary
  await expect(preview.getByText('08901')).toHaveCount(0);
  await shot(page, '09-brief-preview');

  for (const [button, prefix] of [
    ['Download incident summary (PDF)', 'matra-incident-summary-'],
    ['Download NJ compensation draft', 'nj-compensation-draft-'],
  ] as const) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(new RegExp(`^${prefix}\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    const buf = fs.readFileSync((await d.path())!);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  }

  // Download my data: warned first, then one .zip decrypted on the device
  await nav(page, 'Your vault');
  const data = page.locator('section', { has: page.getByRole('heading', { name: 'Your data' }) });
  await data.getByRole('button', { name: 'Download my data' }).click();
  await expect(data.getByText('The downloaded file is not encrypted.')).toBeVisible();
  const dl = page.waitForEvent('download');
  await data.getByRole('button', { name: 'I understand — download' }).click();
  const zip = await dl;
  expect(zip.suggestedFilename()).toMatch(/^matra-my-data-\d{4}-\d{2}-\d{2}\.zip$/);
  const zbuf = fs.readFileSync((await zip.path())!);
  expect(zbuf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(zbuf.includes(Buffer.from('records.json'))).toBe(true);
  expect(zbuf.includes(Buffer.from('hallway.jpg'))).toBe(true);
  expect(zbuf.includes(Buffer.from('He said he'))).toBe(true); // her words, decrypted
  await expect(data.getByText(/Downloaded matra-my-data-.*2 evidence file\(s\)/)).toBeVisible();
});

test('4. share with attorney → attorney decrypts + verifies → survivor sees access → revoke → attorney blocked', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Legal shield');
  const card = page.locator('li.card', { hasText: ATTORNEY_NAME });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await shot(page, '10-attorney-directory', { mobile: false });
  await card.getByRole('button', { name: 'Review and decide' }).click();
  await expect(page.getByRole('heading', { name: `Share with ${ATTORNEY_NAME}?` })).toBeVisible();
  await expect(page.getByLabel(/My evidence files/)).toBeChecked();
  await expect(page.locator('.consent-text')).toContainText(`I, "${ALIAS_A}", choose to share`);
  await page.getByLabel('This matches what the attorney told me.').check();
  await page.getByLabel('I agree to the statement above.').check();
  await shot(page, '11-share-consent');
  await page.getByRole('button', { name: `Yes, share with ${ATTORNEY_NAME}` }).click();
  await expect(page.getByRole('heading', { name: `Shared with ${ATTORNEY_NAME}` })).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  // Attorney
  await signIn(page, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByRole('heading', { name: `Client: ${ALIAS_A}` })).toBeVisible({ timeout: 60_000 });
  const proof = page.locator('section', { has: page.getByRole('heading', { name: 'Integrity proof' }) });
  await expect(proof.getByText('Verified ✓')).toBeVisible();
  expect(await page.locator('.brief-verbatim-text').allTextContents()).toContain(NARRATIVE);
  const ev = page.locator('section', { has: page.getByRole('heading', { name: 'Evidence', exact: true }) });
  const photo = ev.locator('li', { hasText: 'hallway.jpg' });
  await photo.getByRole('button', { name: 'Decrypt & verify' }).click();
  await expect(photo.getByText('Verified ✓', { exact: true })).toBeVisible({ timeout: 30_000 });
  const dl = page.waitForEvent('download');
  await photo.getByRole('link', { name: 'Download (verified ✓)' }).click();
  const got = fs.readFileSync((await (await dl).path())!);
  expect(hasExifGps(got)).toBe(false);
  await shot(page, '12-attorney-case');
  await signOut(page);

  // Survivor sees the access, then revokes
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  const activity = page.locator('section', { has: page.getByRole('heading', { name: 'Activity' }) });
  await expect(activity.getByText('Attorney opened your file').first()).toBeVisible({ timeout: 60_000 });
  await expect(activity.getByText('Attorney downloaded an evidence file').first()).toBeVisible();
  // one visit is logged once (not doubled by React StrictMode in dev)
  await expect(activity.getByText('Attorney opened your file')).toHaveCount(1);
  const shares = page.locator('section', { has: page.getByRole('heading', { name: 'Who can see your file' }) });
  await expect(shares.getByText('Has access')).toBeVisible();
  await shot(page, '13-dashboard-shared');
  await shares.getByRole('button', { name: 'Revoke' }).click();
  await shares.getByRole('button', { name: 'Yes, revoke access' }).click();
  await expect(shares.getByText(/^Revoked /)).toBeVisible();
  await signOut(page);

  // Attorney: clear revoked state, no crash
  await signIn(page, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await expect(page.getByRole('heading', { name: 'Access revoked by client' })).toBeVisible();
  await expect(page.getByText('No files have been shared with you yet.')).toBeVisible();
  await shot(page, '14-attorney-revoked', { mobile: false });
  await signOut(page);
});

test('4b. attorney with the case open when access is revoked sees a clear message', async ({ browser, page }) => {
  // Survivor shares again
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Legal shield');
  await page.locator('li.card', { hasText: ATTORNEY_NAME }).getByRole('button', { name: 'Review and decide' }).click();
  await page.getByLabel('This matches what the attorney told me.').check();
  await page.getByLabel('I agree to the statement above.').check();
  await page.getByRole('button', { name: `Yes, share with ${ATTORNEY_NAME}` }).click();
  await expect(page.getByRole('heading', { name: `Shared with ${ATTORNEY_NAME}` })).toBeVisible({ timeout: 60_000 });

  // Attorney opens it in a second browser profile
  const ctx = await browser.newContext();
  const att = await ctx.newPage();
  const attProblems: string[] = [];
  att.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/status of 40[34]/.test(m.text()) && attProblems.push(m.text()));
  att.on('pageerror', (e) => attProblems.push(e.message));
  await signIn(att, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await att.getByRole('link', { name: 'Open' }).first().click();
  await expect(att.getByRole('heading', { name: `Client: ${ALIAS_A}` })).toBeVisible({ timeout: 60_000 });

  // Survivor revokes
  await nav(page, 'Your vault');
  const shares = page.locator('section', { has: page.getByRole('heading', { name: 'Who can see your file' }) });
  await shares.getByRole('button', { name: 'Revoke' }).click();
  await shares.getByRole('button', { name: 'Yes, revoke access' }).click();
  await expect(shares.getByText('Has access')).toHaveCount(0);

  // Attorney tries to download evidence from the stale page, then reloads the case
  const photo = att.locator('li', { hasText: 'hallway.jpg' });
  await photo.getByRole('button', { name: 'Decrypt & verify' }).click();
  await expect(photo.getByRole('alert')).toContainText(/revoked/i);
  await att.getByRole('link', { name: '← All files' }).click();
  await expect(att.getByRole('heading', { name: 'Access revoked by client' })).toBeVisible();
  expect(attProblems).toEqual([]);
  await ctx.close();
});

test('5. escrow: two survivors name the same handle; both see only "Sealed"; attorney sees the match', async ({ page }) => {
  // Survivor B names the same handle, different capitalization and without the @
  await registerSurvivor(page, ALIAS_B);
  await openStory(page);
  await runIntake(page, {
    'safety.now': click("Yes, I'm safe"),
    'person.list': PERSON('Demo_Handle_123', 'Ryan'),
    'person.escrow': sealYes,
  });
  await sealFromReview(page);
  await nav(page, 'Your vault');
  const escrowB = page.locator('section', { has: page.getByRole('heading', { name: 'Sealed escrow' }) });
  await expect(escrowB.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrowB).not.toContainText(/match/i);
  await signOut(page);

  // Survivor A: still only "Sealed"; shares again
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  const escrowA = page.locator('section', { has: page.getByRole('heading', { name: 'Sealed escrow' }) });
  await expect(escrowA.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrowA).not.toContainText(/match/i);
  await nav(page, 'Legal shield');
  await page.locator('li.card', { hasText: ATTORNEY_NAME }).getByRole('button', { name: 'Review and decide' }).click();
  await page.getByLabel('This matches what the attorney told me.').check();
  await page.getByLabel('I agree to the statement above.').check();
  await page.getByRole('button', { name: `Yes, share with ${ATTORNEY_NAME}` }).click();
  await expect(page.getByRole('heading', { name: `Shared with ${ATTORNEY_NAME}` })).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  await signIn(page, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByRole('heading', { name: `Client: ${ALIAS_A}` })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Sealed escrow: independent match' })).toBeVisible();
  await shot(page, '15-attorney-escrow-match');
});

test('6. quick exit: button and triple-Esc leave to a neutral site; coming back shows welcome, no session', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await page.getByRole('button', { name: /Quick exit/ }).click();
  await page.waitForURL(`https://${QUICK_EXIT_HOST}/**`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock & sign out' })).toHaveCount(0);

  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await openStory(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForURL(`https://${QUICK_EXIT_HOST}/**`);
  expect(await page.evaluate(() => history.length)).toBeGreaterThan(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('7. wrong passphrase shows a friendly error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await page.getByLabel('Alias').fill(ALIAS_A);
  await page.getByLabel('Passphrase').fill('definitely not my passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('That alias and passphrase don’t match. Check for typos and try again.', { timeout: 60_000 });
  await shot(page, '16-wrong-passphrase', { mobile: false });
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
