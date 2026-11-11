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
  expect,
  hasExifGps,
  jpegWithGps,
  nav,
  registerSurvivor,
  sealFromReview,
  storySafety,
  addToStory,
  openTopic,
  chip,
  fill,
  savePage,
  enough,
  moreDetails,
  storyMap,
  shot,
  signIn,
  signOut,
  startPhoneVerify,
  test,
  verifyPhone,
  tinyPdf,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const ALIAS_A = `bluebird-${RUN}`;
const ALIAS_B = `sparrow-${RUN}`;
const ATTORNEY = 'attorney.nj1';
const ATTORNEY_NAME = 'Demo — Alex Rivera, Esq.';

const NARRATIVE =
  "We were at a party at a coworker's apartment. I remember the music was too loud and the hallway smelled like cologne.\n\n" +
  'He said he\'d walk me to my car… I said "no thanks, I\'m fine" — twice.\nI don\'t remember the drive home clearly.';

// Two seeded counselors: counselor.demo is licensed in NJ, counselor.ny in NY. The matcher gives each matched group to
// ONE counselor, licensed where it happened if possible (apps/matcher).
const COUNSELOR_NJ = 'counselor.demo';
const COUNSELOR_NY = 'counselor.ny';
const COUNSELOR_PASS = 'demo-counselor-passphrase';

async function counselorSignIn(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('link', { name: 'I’m an attorney' }).click();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Passphrase').fill(COUNSELOR_PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Matched sealed reports' })).toBeVisible({ timeout: 90_000 });
}

async function openStory(page: Page) {
  await nav(page, 'My story');
  await expect(page.locator('.space-root')).toBeVisible({ timeout: 60_000 });
}

test('1. survivor registers (18+ gate), tells her story "dump first", answers topics in any order, seals; dashboard shows ledger + verified', async ({ page }) => {
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
  // "Go back" leaves the form, so the 18+ box can't just be ticked straight away
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  expect(registerCalls).toEqual([]);

  await registerSurvivor(page, ALIAS_A);
  await shot(page, '02-dashboard-empty', { mobile: false });
  await openStory(page);

  // Safety first, before anything else.
  await shot(page, '03-story-safety');
  await storySafety(page, 'Yes');

  // Start anywhere: her words, verbatim. First, a calm note that Matra can't read it but a court can order her to
  // hand it over (PRD N4); "Learn more" is there only if she wants it.
  await expect(page.getByRole('heading', { name: 'Start wherever feels right.' })).toBeVisible();
  const before = page.getByTestId('notice-before-writing');
  await expect(before).toContainText('But a court can order you to hand it over.');
  await expect(before).toContainText('Anything you give police will be shared with the defense.');
  await addToStory(page, NARRATIVE);
  expect(await page.locator('.space-journal .space-entry-text').first().textContent()).toBe(NARRATIVE);

  // What I picked up: suggestions show the words they came from; she keeps one and sets one aside.
  const picked = page.getByRole('region', { name: /what I picked up/i });
  await expect(picked).toBeVisible({ timeout: 30_000 });
  await expect(picked.locator('mark').first()).toBeVisible();
  await shot(page, '03b-picked-up');
  const cards = picked.locator('[data-suggestion-id]');
  const dismissedId = (await cards.nth(1).getAttribute('data-suggestion-id'))!;
  await cards.nth(1).getByRole('button', { name: 'Not right' }).click();
  await expect(page.locator(`[data-suggestion-id="${dismissedId}"]`)).toHaveCount(0);
  await cards.first().getByRole('button', { name: 'Keep' }).click();

  // Her draft saves itself to her private space, quietly (no "save" card to remember).
  await expect(page.getByTestId('vault-status')).toContainText('Saved to your private space', { timeout: 30_000 });

  // A break is always one tap away.
  await page.getByRole('button', { name: 'Take a break' }).click();
  const dialog = page.getByRole('dialog', { name: 'Take a break' });
  await expect(dialog).toBeVisible();
  await shot(page, '04-take-a-break', { mobile: false });
  await dialog.getByRole('button', { name: "I'm ready to keep going" }).click();
  await expect(dialog).toBeHidden();

  // Only if she wants: topics in any order (a "later" one first).
  await openTopic(page, 'details');
  await chip(page, 'Were any of these part of what happened?', 'Being held, tied, or blocked from leaving');
  await fill(page, { 'If you want, describe it in your own words.': 'He stood in the doorway so I could not leave.' });
  await chip(page, /press on your neck or throat/, "I'm not sure");
  await expect(page.locator('[data-topic-panel] .space-note').first()).toBeVisible(); // the gentle health note
  await chip(page, /alcohol, drugs, or medicine/, 'I had been drinking');
  await shot(page, '04b-topic-details');
  await savePage(page);
  await chip(page, /could not move, speak, or remember/, 'No');
  await enough(page);

  await openTopic(page, 'person');
  await fill(page, { 'Name, or what you call them': 'R.', 'How you know them': 'coworker' });
  await chip(page, 'Did you know this person before?', 'Yes');
  await moreDetails(page);
  await fill(page, {
    'Their phone number': '(201) 555-0199', // valid NANP (review M1: (555) 010-… is not a real number shape)
    'Their social media name or handle': '@demo_handle_123',
    'Which app or site?': { select: 'instagram' },
  });
  await savePage(page);
  await chip(page, 'R.', 'Yes, seal it');
  await savePage(page);
  await chip(page, 'Best way to reach you', 'Text message');
  // how a legal options counselor may reach her if there is ever a match (sealed into her contact bundle)
  await fill(page, { 'Phone number or email to use': '(555) 010-0100' });
  await savePage(page);
  await expect(page.getByText('That’s everything here. Thank you.')).toBeVisible();
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();

  await openTopic(page, 'people');
  await fill(page, {
    'Who you told': 'M. (roommate)',
    'About when': 'the next morning',
    'How you told them': { select: 'text' },
    'What you remember saying': 'something bad happened last night',
  });
  await savePage(page);
  await enough(page);

  await openTopic(page, 'reports');
  await chip(page, 'Have you reported this anywhere?', 'Yes');
  await savePage(page);
  await fill(page, { 'Who you reported to': 'HR at my job', 'What kind of place was it?': { select: 'employer' }, 'About when': 'a week later' });
  await savePage(page);

  await openTopic(page, 'safety');
  await chip(page, /know where you live, work, or go to school/, 'Yes');
  await chip(page, 'Do you think you might want a protective order?', "I'm not sure");
  await savePage(page);
  await enough(page);

  await openTopic(page, 'next');
  await chip(page, 'Would you like help making a police report?', "I'm not sure");
  await chip(page, 'Would you like to talk with a free lawyer about your options?', 'Yes');
  await chip(page, 'Would you like help asking for victim compensation?', 'Yes');
  await savePage(page);
  await fill(page, { 'City or town': 'New Brunswick', State: { select: 'NJ' }, 'ZIP code': '08901' });
  await savePage(page);
  await chip(page, 'Are you applying for yourself?', 'Yes, for myself');
  await savePage(page);
  await enough(page);

  await openTopic(page, 'you');
  await fill(page, { 'What name would you like us to use for you?': 'J.', 'What pronouns do you use, if you would like to share?': 'she/her' });
  await enough(page);

  // A topic she chooses to skip says so.
  await openTopic(page, 'costs');
  await page.getByRole('button', { name: 'Skip this part' }).click();
  if (!(await page.locator('[data-topic="costs"]').count())) await page.getByRole('button', { name: /Show all \d+ topics/ }).click();
  await expect(page.locator('[data-topic="costs"]')).toContainText('Skipped');

  // The story map shows where things stand, in words, and jumps anywhere.
  const map = storyMap(page);
  await expect(map.getByRole('button', { name: /^Your words\s*Filled$/ })).toBeVisible();
  await expect(map.getByRole('button', { name: /^The person\s*Filled$/ })).toBeVisible();
  if (await page.locator('[data-topic-panel]').count()) await enough(page);
  await map.getByRole('button', { name: /^When & where/ }).click();
  // (the date may already be filled from what she kept above — the topic opens at the first open question)
  if (await page.locator('[data-topic-panel]').getByRole('group', { name: 'When did this happen?' }).count()) {
    await chip(page, 'When did this happen?', 'Describe it in words');
    await fill(page, { 'Describe when, in your own words': 'around March 14, not sure of the exact day' });
  }
  await chip(page, 'Did it happen more than once, or over a period of time?', 'No');
  await fill(page, { 'Do you remember about what time of day it was?': 'late at night' });
  await savePage(page);
  await enough(page);
  await shot(page, '04c-story-home');

  // Review: her words verbatim, first.
  await map.getByRole('button', { name: /^Review/ }).click();
  const review = page.getByRole('region', { name: 'Here is everything you shared' });
  await expect(review).toBeVisible();
  expect(await review.locator('.space-review-entry .space-verbatim').first().textContent()).toBe(NARRATIVE);
  await expect(review.getByText('Skipped', { exact: true }).first()).toBeVisible();
  await expect(review.getByTestId('notice-saved-versions')).toContainText('Every saved version is kept');
  await shot(page, '05-review');

  await sealFromReview(page);
  await expect(page.getByText(/ledger entry #\d+/)).toBeVisible();
  // Her sealed match waits for one quick phone confirmation (W13): a calm next step, not an error.
  await expect(page.getByTestId('phone-step-card')).toContainText('To turn on your sealed match, confirm a phone number first.');
  await expect(page.getByText(/sealed match could not be set up/)).toHaveCount(0);
  await shot(page, '06-sealed', { mobile: false });
  await startPhoneVerify(page, '(201) 555-0142');
  await expect(page.getByTestId('phone-verified')).toContainText('Done. The number has been forgotten.', { timeout: 60_000 });
  await expect(page.getByTestId('phone-verified')).toContainText('Your sealed match is on.');
  await shot(page, '06b-phone-verified');
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('home-title')).toBeVisible();
  await expect(page.getByTestId('phone-step-card')).toHaveCount(0);

  await nav(page, 'Home');
  const acct = page.getByTestId('home-story');
  await expect(acct.getByText('Current sealed version')).toBeVisible({ timeout: 60_000 });
  // Turning the sealed match on saved her record again as a new sealed version (only the list of sealed fingerprints
  // changed), so the first seal is now listed as an earlier version; both verify.
  await expect(acct.getByTestId('sealed-current').getByText('Verified ✓')).toBeVisible();
  await expect(acct.getByTestId('sealed-earlier').getByText('Verified ✓')).toBeVisible();
  await expect(acct.getByTestId('sealed-current').getByText(/ledger entry #\d+/)).toBeVisible();
  const escrow = page.getByTestId('home-escrow');
  // phone + handle; a bare initial ("R.") is too weak to seal
  await expect(escrow.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrow.getByText('R. · social media handle (instagram)')).toBeVisible();
  // the client labels the seal (it can decrypt its own records); the server only knows "saved"
  const activity = page.getByTestId('home-activity');
  await expect(activity.getByText('You sealed your account').first()).toBeVisible();
  await shot(page, '07-dashboard');
});

test('2. evidence: JPEG GPS is stripped and hashed; PDF warns metadata kept; re-seal attaches files', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Evidence');
  await expect(page.getByRole('heading', { name: 'Evidence', level: 1 })).toBeVisible();
  await expect(page.getByTestId('notice-keep-originals')).toContainText('keep the original file');

  const jpeg = await jpegWithGps(page);
  expect(hasExifGps(jpeg)).toBe(true);
  await page.getByLabel('What is it? (optional)').fill('Photo of the hallway (fictional)');
  await page.getByLabel('Choose evidence files').setInputFiles({ name: 'hallway.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const added = page.getByTestId('evidence-just-added');
  const jpgRow = added.locator('li', { hasText: 'hallway.jpg' });
  await expect(jpgRow.getByText('Hidden details removed')).toBeVisible({ timeout: 60_000 });
  await expect(jpgRow.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();
  await expect(page.getByText('Saved to your space and added to your draft story.')).toBeVisible();

  await page.getByLabel('Choose evidence files').setInputFiles({ name: 'texts-export.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
  const pdfRow = added.locator('li', { hasText: 'texts-export.pdf' });
  await expect(pdfRow.getByText('Hidden details not removed')).toBeVisible({ timeout: 60_000 });
  await expect(pdfRow.getByText(/couldn’t remove hidden details from this PDF/)).toBeVisible();
  // The row appears once the file is uploaded; its details are added to her draft a moment later. Wait for that (the
  // message is cleared when the PDF is chosen, so this is the PDF's), as she would: leaving earlier used to race it.
  await expect(page.getByText('Saved to your space and added to your draft story.')).toBeVisible();
  await shot(page, '08-evidence');

  // The stored copy really has no EXIF: decrypt it from the vault and download it.
  await nav(page, 'Home');
  await nav(page, 'Evidence');
  const vaultRow = page.getByTestId('evidence-in-space').locator('li', { hasText: 'hallway.jpg' });
  await vaultRow.getByRole('button', { name: 'Unlock & view' }).click();
  await expect(vaultRow.getByText('Verified ✓')).toBeVisible();
  const dl = page.waitForEvent('download');
  await vaultRow.getByRole('link', { name: 'Download' }).click();
  const stored = fs.readFileSync((await (await dl).path())!);
  expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(hasExifGps(stored)).toBe(false);

  // Re-seal so the files are part of the sealed account (and shareable).
  await openStory(page);
  await expect(page.getByText('2 files kept safely')).toBeVisible();
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);
  await nav(page, 'Home');
  const acct = page.getByTestId('home-story');
  await expect(acct.getByText('Current sealed version')).toBeVisible({ timeout: 60_000 });
  await expect(acct.getByText(/2 evidence files/).first()).toBeVisible();
});

test('3. incident summary: her words verbatim; summary + VCCO draft download as PDFs; "Download my data" zip', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Summary');
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
  // Before downloading: the PDFs aren't locked once they leave Matra.
  await expect(page.getByTestId('notice-download-file')).toContainText('it is not encrypted');
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
  await nav(page, 'Home');
  const data = page.getByTestId('home-data');
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
  await expect(data.getByText(/Downloaded matra-my-data-.*2 evidence files/)).toBeVisible();
});

test('4. share with attorney → attorney decrypts + verifies → survivor sees access → revoke → attorney blocked', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await nav(page, 'Sharing');
  const card = page.locator('li.card', { hasText: ATTORNEY_NAME });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await shot(page, '10-attorney-directory', { mobile: false });
  await card.getByRole('button', { name: 'Review and decide' }).click();
  await expect(page.getByRole('heading', { name: `Share with ${ATTORNEY_NAME}?` })).toBeVisible();
  await expect(page.getByLabel(/My evidence files/)).toBeChecked();
  await expect(page.locator('.consent-text')).toContainText(`I, "${ALIAS_A}", choose to share`);
  await expect(page.locator('.consent-text')).toContainText('The attorney can read and save what I share.');
  await expect(page.getByTestId('notice-sharing')).toContainText('it can’t erase what they already saved');
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
  const activity = page.getByTestId('home-activity');
  await expect(activity.getByText('Attorney opened your file').first()).toBeVisible({ timeout: 60_000 });
  await expect(activity.getByText('Attorney downloaded an evidence file').first()).toBeVisible();
  // one visit is logged once (not doubled by React StrictMode in dev)
  await expect(activity.getByText('Attorney opened your file')).toHaveCount(1);
  const shares = page.getByTestId('home-shares');
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
  await nav(page, 'Sharing');
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
  await nav(page, 'Home');
  const shares = page.getByTestId('home-shares');
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

test('5. sealed match: two survivors name the same Instagram profile in different forms; both see only "Sealed"; attorney sees nothing; the matcher gives the group to the counselor licensed where it happened (NY), with two separate contact bundles; the NJ counselor sees nothing; staged release: contact details only after her conflict check, A says yes to her report request and B says no, A stops sharing', async ({ page }) => {
  // Survivor B names the same Instagram profile as a URL (A typed "@demo_handle_123"), and a different phone number.
  await registerSurvivor(page, ALIAS_B);
  // She confirms a phone first, from the sealed-match page: the same phone as A, written differently (2 accounts allowed).
  await page.getByTestId('home-matching-link').click();
  await expect(page.getByTestId('matching-phone')).toContainText('confirm a phone number once');
  await verifyPhone(page, '+1 201-555-0142');
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await openStory(page);
  await storySafety(page, 'Yes');
  await openTopic(page, 'person');
  await fill(page, { 'Name, or what you call them': 'Ryan', 'How you know them': 'coworker' });
  await chip(page, 'Did you know this person before?', 'Yes');
  await moreDetails(page);
  await fill(page, {
    'Their phone number': '(201) 555-0177',
    'Their social media name or handle': 'https://www.instagram.com/Demo_Handle_123/',
    'Which app or site?': { select: 'instagram' },
  });
  await savePage(page);
  await chip(page, 'Ryan', 'Yes, seal it');
  await savePage(page);
  await chip(page, 'Best way to reach you', 'Text message');
  await fill(page, { 'Phone number or email to use': '(555) 010-0300' });
  await savePage(page);
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();
  // It happened in New York: the matcher routes the group to a counselor licensed there (sealed to the matcher only).
  await openTopic(page, 'whenWhere');
  // (the "when" page, then the place page, are left empty: she only gives the state)
  await savePage(page);
  await expect(page.locator('[data-topic-panel]').getByLabel('Where did it happen? Describe it any way you can.')).toBeVisible();
  await savePage(page);
  await fill(page, { State: { select: 'NY' } });
  await savePage(page);
  await page.locator('[data-topic-panel]').getByRole('button', { name: 'Back to your story' }).last().click();
  await storyMap(page).getByRole('button', { name: /^Review/ }).click();
  await sealFromReview(page);
  await expect(page.getByText(/sealed match could not be set up/)).toHaveCount(0);
  await expect(page.getByTestId('phone-step-card')).toHaveCount(0);
  await nav(page, 'Home');
  const escrowB = page.getByTestId('home-escrow');
  await expect(escrowB.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrowB).not.toContainText(/matched|counselor has/i);
  await signOut(page);

  // Survivor A: still only "Sealed"; shares again
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  const escrowA = page.getByTestId('home-escrow');
  await expect(escrowA.locator('.badge')).toHaveText(['Sealed', 'Sealed']);
  await expect(escrowA).not.toContainText(/matched|counselor has/i);
  await nav(page, 'Sharing');
  await page.locator('li.card', { hasText: ATTORNEY_NAME }).getByRole('button', { name: 'Review and decide' }).click();
  await page.getByLabel('This matches what the attorney told me.').check();
  await page.getByLabel('I agree to the statement above.').check();
  await page.getByRole('button', { name: `Yes, share with ${ATTORNEY_NAME}` }).click();
  await expect(page.getByRole('heading', { name: `Shared with ${ATTORNEY_NAME}` })).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  // The attorney no longer learns anything about sealed matches.
  await signIn(page, ATTORNEY, ATTORNEY_PASS, 'attorney');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByRole('heading', { name: `Client: ${ALIAS_A}` })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /Sealed escrow|independent match/i })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/independent(ly)? (match|named)/i);
  await page.getByTestId('lock-signout').click();
  await expect(page.getByRole('heading', { name: 'For attorneys' })).toBeVisible();

  // The NJ-licensed counselor is not given this group: it happened in NY.
  await counselorSignIn(page, COUNSELOR_NJ);
  await expect(page.getByText('No matches right now.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('counselor-group')).toHaveCount(0);
  await page.getByTestId('lock-signout').click();

  // The NY-licensed counselor (verified, seeded) signs in and sees exactly one matched group, and why it is hers.
  await counselorSignIn(page, COUNSELOR_NY);
  await expect(page.getByTestId('counselor-ethics')).toContainText('not evidence');
  const groups = page.getByTestId('counselor-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.getByTestId('counselor-assignment')).toContainText('Assigned to you because this happened in New York, where you’re licensed.');
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  await expect(groups.getByText('instagram:demo_handle_123').first()).toBeVisible({ timeout: 30_000 });
  // every card shows the identifier its bundle names (review L1)
  await expect(groups.getByTestId('counselor-canonical')).toHaveText(['instagram:demo_handle_123', 'instagram:demo_handle_123']);
  const people = groups.getByTestId('counselor-survivor');
  await expect(people).toHaveCount(2);
  // Staged release, stage 1: what matched, where, and HOW each person wants to be reached; no numbers, no names yet.
  await expect(groups).not.toContainText('(555) 010-0100');
  await expect(groups).not.toContainText('(555) 010-0300');
  await expect(people.getByTestId('counselor-contact-hidden')).toHaveCount(2);
  await expect(people.filter({ hasText: 'Text message' }).first()).toBeVisible();
  const conflict = groups.getByTestId('counselor-conflict-check');
  await expect(conflict).toContainText('instagram:demo_handle_123');
  await expect(conflict).toContainText('New York');
  await shot(page, '15a-counselor-conflict-check', { mobile: false });
  await conflict.getByRole('button', { name: 'I have no conflict' }).click();
  await expect(groups.getByTestId('counselor-conflict-done')).toBeVisible({ timeout: 30_000 });
  // stage 1b: two separate contact bundles, never mixed
  const a = people.filter({ hasText: '(555) 010-0100' });
  const b = people.filter({ hasText: '(555) 010-0300' });
  await expect(a).toHaveCount(1, { timeout: 30_000 });
  await expect(b).toHaveCount(1);
  await expect(a).not.toContainText('(555) 010-0300');
  await expect(b).not.toContainText('(555) 010-0100');
  await expect(groups).not.toContainText(ALIAS_A);
  await expect(groups).not.toContainText(ALIAS_B);
  // an encrypted outreach note
  await a.getByLabel('Note').fill('Texted after 6pm as asked.');
  await a.getByRole('button', { name: 'Save note' }).click();
  await expect(a.getByRole('listitem').filter({ hasText: 'Texted after 6pm as asked.' })).toContainText('Reached out', { timeout: 30_000 });
  await shot(page, '15-counselor-match');
  // Stage 2: having spoken with each of them, she asks each one for their full report (only once they expect it).
  for (const person of [a, b]) {
    const ask = person.getByRole('button', { name: 'Ask for their full report' });
    await expect(ask).toBeDisabled();
    await person.getByLabel('I’ve spoken with this person and they expect this request.').check();
    await ask.click();
    await expect(person.getByTestId('counselor-report-request')).toContainText('They haven’t decided', { timeout: 30_000 });
  }
  await page.getByTestId('lock-signout').click();

  // A sees the request on Home, only about herself, and says yes (evidence stays unticked unless she chooses it).
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  const card = page.getByTestId('home-report-request');
  await expect(card).toContainText('A legal options counselor has asked to see your report.', { timeout: 30_000 });
  await card.getByRole('link', { name: 'See the request' }).click();
  await expect(page.getByTestId('report-request-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('main')).not.toContainText(ALIAS_B);
  await expect(page.getByLabel(/My evidence files too/)).not.toBeChecked();
  await expect(page.locator('.consent-text')).toContainText('It is not shared with anyone else who named the same person.');
  const yes = page.getByRole('button', { name: 'Yes, share my report' });
  await expect(yes).toBeDisabled();
  await page.getByLabel('This matches what the counselor told me.').check();
  await page.getByLabel('I agree to the statement above.').check();
  await shot(page, '15b-survivor-report-request');
  await yes.click();
  await expect(page.getByTestId('report-request-shared')).toContainText('They haven’t opened it yet.', { timeout: 60_000 });
  await signOut(page);

  // B says no. The counselor will learn only that.
  await signIn(page, ALIAS_B, SURVIVOR_PASS);
  await page.getByTestId('home-report-request').getByRole('link', { name: 'See the request' }).click();
  await expect(page.getByTestId('report-request-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('main')).not.toContainText(ALIAS_A);
  await page.getByRole('button', { name: 'No, don’t share' }).click();
  await expect(page.getByTestId('report-request-declined')).toBeVisible({ timeout: 30_000 });
  await nav(page, 'Home');
  await expect(page.getByTestId('home-report-request')).toHaveCount(0);
  await signOut(page);

  // The counselor opens A's report (her story, decrypted on the counselor's device); B's stays sealed.
  await counselorSignIn(page, COUNSELOR_NY);
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  await expect(b.getByTestId('counselor-report-request')).toContainText('They decided not to share their report.', { timeout: 30_000 });
  await expect(b.getByRole('link', { name: 'Open their report' })).toHaveCount(0);
  await a.getByRole('link', { name: 'Open their report' }).click();
  await expect(page.getByTestId('counselor-report-title')).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('.brief-verbatim-text').allTextContents()).toContain(NARRATIVE);
  await expect(page.locator('main')).not.toContainText(ALIAS_A);
  await expect(page.locator('main')).not.toContainText(ALIAS_B);
  await shot(page, '15c-counselor-report', { mobile: false });
  await page.getByRole('link', { name: '← Matched sealed reports' }).click();
  await page.getByTestId('lock-signout').click();

  // A sees the opening in her activity, and stops sharing; the counselor's access ends.
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await expect(page.getByTestId('home-activity').getByText('The legal options counselor opened your report').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('home-report-shared').getByRole('link', { name: 'See or stop sharing' }).click();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await page.getByRole('button', { name: 'Yes, stop sharing' }).click();
  await expect(page.getByTestId('report-request-shared')).toContainText('You stopped sharing on', { timeout: 30_000 });
  await signOut(page);

  await counselorSignIn(page, COUNSELOR_NY);
  await expect(page.getByTestId('counselor-releases')).toContainText('they stopped sharing', { timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Open report' })).toHaveCount(0);
  await groups.getByRole('button', { name: 'Open with my private key' }).click();
  await expect(a.getByTestId('counselor-report-request')).toContainText('They stopped sharing their report with you.', { timeout: 30_000 });
  // A conflict turns up later: she declines the group, and the matcher passes it on; it is gone from her list.
  await groups.getByRole('button', { name: 'I can’t take this group (conflict of interest)' }).click();
  await groups.getByRole('button', { name: 'Keep it' }).click();
  await expect(groups).toHaveCount(1);
  await groups.getByRole('button', { name: 'I can’t take this group (conflict of interest)' }).click();
  await groups.getByRole('button', { name: 'Yes, decline this group' }).click();
  await expect(page.getByTestId('counselor-declined')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('counselor-group')).toHaveCount(0);
  await expect(page.getByText('No matches right now.')).toBeVisible();
});

test('5b. one phone turns on sealed matching for at most two accounts: a third gets a kind message and stays unconfirmed', async ({ page }) => {
  await registerSurvivor(page, `finch-${RUN}`);
  await page.getByTestId('home-matching-link').click();
  await startPhoneVerify(page, '201.555.0142');
  await expect(page.getByRole('alert')).toContainText('already been used to turn on sealed matching for as many accounts as we allow', { timeout: 30_000 });
  await expect(page.getByTestId('phone-verified')).toHaveCount(0);
  await page.getByRole('link', { name: 'Not now' }).click();
  await page.getByTestId('home-matching-link').click();
  await expect(page.getByTestId('matching-phone')).toContainText('confirm a phone number once');
});

test('6. quick exit: button and triple-Esc leave to a neutral site; coming back shows welcome, no session', async ({ page }) => {
  await signIn(page, ALIAS_A, SURVIVOR_PASS);
  await page.getByRole('button', { name: /Quick exit/ }).click();
  await page.waitForURL(`https://${QUICK_EXIT_HOST}/**`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  await expect(page.getByTestId('lock-signout')).toHaveCount(0);

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

test('8. delete everything: explained first (lawyer caution, what stays), typed confirmation, then the session is gone', async ({ page }) => {
  const alias = `wren-del-${RUN}`;
  await registerSurvivor(page, alias);
  await page.getByTestId('delete-account-link').click();
  await expect(page.getByRole('heading', { name: 'Delete everything', level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('notice-deleting')).toContainText('talk to a lawyer before you delete anything');
  await expect(page.getByText('This can’t be undone.')).toBeVisible();
  await expect(page.getByText(/Copies an attorney already downloaded or saved/)).toBeVisible();
  // a copy first, if she wants one
  await expect(page.getByTestId('delete-export').getByRole('button', { name: 'Download my data' })).toBeVisible();
  await shot(page, '17-delete-account');

  const button = page.getByTestId('delete-account');
  await expect(button).toBeDisabled();
  await page.getByTestId('delete-confirm-input').fill('DELETE');
  await expect(button).toBeEnabled();
  await button.click();

  // the public home, no session, nothing in the header
  await expect(page.getByTestId('account-deleted')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /Tell it once/ })).toBeVisible();
  await expect(page.getByTestId('lock-signout')).toHaveCount(0);

  // the account no longer exists
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await page.getByLabel('Alias').fill(alias);
  await page.getByLabel('Passphrase').fill(SURVIVOR_PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('That alias and passphrase don’t match. Check for typos and try again.', { timeout: 60_000 });
});
