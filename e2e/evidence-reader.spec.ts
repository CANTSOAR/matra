/**
 * The evidence reader (P6) end to end, in a real browser, with the REAL on-device OCR engine (no mock): import a file →
 * its hash and salted commitment → read its text → search → exhibit list (CSV) → a redacted copy. All data is fictional.
 *
 * Also checks what the server is sent: it never gets the plain hash of the original, only a salted commitment, and a public
 * ledger proof query by the plain hash finds nothing.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { RUN, expect, nav, registerSurvivor, tinyPdf, test } from './helpers';

/** A PNG with printed text, made by the page's own canvas (fictional receipt). */
async function receiptPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 360;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 900, 360);
    x.fillStyle = '#000';
    x.font = 'bold 56px Arial, Helvetica, sans-serif';
    x.fillText('INVOICE 4471', 40, 90);
    x.font = '48px Arial, Helvetica, sans-serif';
    x.fillText('Paid 03/04/2026', 40, 190);
    x.fillText('Total $12.50', 40, 290);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(b64, 'base64');
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('evidence reader: import, hash, read the text, search, exhibit list, redacted copy', async ({ page }) => {
  test.setTimeout(420_000);
  // everything the browser sends to the app server: method, URL, headers and the body as text and as hex
  const sent: string[] = [];
  const commitments: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/') === false) return;
    const body = r.postDataBuffer();
    const h = r.headers();
    if (h['x-evidence-commitment']) commitments.push(h['x-evidence-commitment']);
    sent.push(`${r.method()} ${r.url()} ${JSON.stringify(h)} ${body ? body.toString('latin1') : ''} ${body ? body.toString('hex') : ''}`);
  });

  await registerSurvivor(page, `reader-${RUN}`);
  await nav(page, 'Evidence');
  await expect(page.getByRole('heading', { name: 'Evidence', level: 1 })).toBeVisible();
  // before anything is added she is told, plainly, which files are cleaned and which are not
  await expect(page.getByTestId('import-format-notice')).toContainText('only from JPEG, PNG and WebP photos');
  await expect(page.getByTestId('import-format-notice')).toContainText('HEIC photos, videos, recordings, PDFs');

  const png = await receiptPng(page);
  const originalHash = sha(png);
  const chooser = page.getByLabel('Choose evidence files');
  const added = page.getByTestId('evidence-just-added');

  // 1. a receipt image, a screenshot-named copy of it, and a PDF
  await chooser.setInputFiles({ name: 'receipt-fixture.png', mimeType: 'image/png', buffer: png });
  const receipt = added.locator('li', { hasText: 'receipt-fixture.png' });
  await expect(receipt.getByText('Hidden details removed')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Saved to your space and added to your draft story.')).toBeVisible();
  await chooser.setInputFiles({ name: 'Screenshot 2026-03-03 at 10.12.04.png', mimeType: 'image/png', buffer: png });
  const shot = added.locator('li', { hasText: 'Screenshot 2026-03-03' });
  await expect(shot.getByText('Hidden details removed')).toBeVisible({ timeout: 90_000 });
  await expect(shot.getByTestId('screenshot-note')).toContainText('Please keep the original messages on your phone too');
  await expect(page.getByText('Saved to your space and added to your draft story.')).toBeVisible();
  await chooser.setInputFiles({ name: 'texts-export.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
  const pdf = added.locator('li', { hasText: 'texts-export.pdf' });
  await expect(pdf.getByTestId('unstripped-warning')).toContainText('Hidden details were not removed from this file', { timeout: 90_000 });
  await expect(page.getByText('Saved to your space and added to your draft story.')).toBeVisible();

  // 2. hash and commitment: three different commitments (a fresh salt each), none is the plain hash; the server never saw it
  expect(commitments).toHaveLength(3);
  expect(new Set(commitments).size).toBe(3);
  for (const c of commitments) expect(c).toMatch(/^[0-9a-f]{64}$/);
  expect(commitments).not.toContain(originalHash);
  for (const line of sent) expect(line).not.toContain(originalHash);
  await expect(receipt.getByTestId('commitment')).toContainText(commitments[0]!);
  // the public proof lookup, by the plain hash of the file, finds nothing; by her commitment it finds the ledger entry
  const byPlain = await page.request.post('/api/ledger/proof', { data: { contentHashes: [originalHash] } });
  expect((await byPlain.json()).entries).toEqual([]);
  const byCommitment = await page.request.post('/api/ledger/proof', { data: { contentHashes: [commitments[0]] } });
  expect((await byCommitment.json()).entries.map((e: { type: string }) => e.type)).toEqual(['evidence.committed']);

  // 3. pictures stay blurred until she taps
  await expect(receipt.locator('img.blurred')).toHaveCount(1);
  await receipt.getByRole('button', { name: 'Show picture' }).click();
  await expect(receipt.locator('img.blurred')).toHaveCount(0);
  await receipt.getByRole('button', { name: 'Hide picture' }).click();
  await expect(receipt.locator('img.blurred')).toHaveCount(1);

  // 4. read the text, on request, with the real engine; shown as read, and saved
  await expect(receipt.getByTestId('ocr-text')).toHaveCount(0); // nothing is read until she taps
  await receipt.getByRole('button', { name: 'Read the text in this image' }).click();
  await expect(receipt.getByTestId('ocr-text')).toContainText('INVOICE', { timeout: 150_000 });
  const read = (await receipt.getByTestId('ocr-text').textContent())!;
  expect(read).toMatch(/4471/);
  expect(read).toMatch(/Total/i);
  await expect(receipt.getByText('Saved, locked, in your space.')).toBeVisible();
  // the text she had read never went to the server in the clear
  for (const line of sent) expect(line).not.toContain('INVOICE');

  // 5. search, from her space (reload), on this device: the query is not sent anywhere
  await nav(page, 'Home');
  await nav(page, 'Evidence');
  const exhibits = page.getByTestId('exhibit-list');
  await expect(exhibits.getByTestId('exhibit-row-3')).toBeVisible({ timeout: 60_000 });
  const before = sent.length;
  await exhibits.getByLabel('Search your files').fill('invoice');
  const results = exhibits.getByTestId('search-results');
  await expect(results).toContainText('Exhibit 1: receipt-fixture.png');
  await expect(results).toContainText('found in the text read from the image');
  await expect(results.locator('mark')).toHaveText(/invoice/i);
  await exhibits.getByLabel('Search your files').fill('screenshot');
  await expect(results).toContainText('Screenshot 2026-03-03');
  await exhibits.getByLabel('Search your files').fill('zzzqqq');
  await expect(results).toContainText('No file matches');
  expect(sent.slice(before).filter((l) => /invoice|screenshot|zzzqqq/i.test(l.split(' ').slice(0, 3).join(' ')))).toEqual([]); // no request carries a query

  // 6. exhibit list: numbered in the order added, with the salted fingerprint; downloads as CSV
  await expect(exhibits.getByTestId('exhibit-row-1')).toContainText('receipt-fixture.png');
  await expect(exhibits.getByTestId('exhibit-row-1')).toContainText(commitments[0]!);
  await expect(exhibits.getByTestId('exhibit-row-2')).toContainText('Screenshot 2026-03-03');
  await expect(exhibits.getByTestId('exhibit-row-3')).toContainText('texts-export.pdf');
  const dl = page.waitForEvent('download');
  await exhibits.getByRole('button', { name: 'Download the list (CSV)' }).click();
  const csv = fs.readFileSync((await (await dl).path())!, 'utf8').trimEnd().split('\r\n');
  expect(csv[0]).toBe('"Exhibit","File name","Date added","Type","Size","Salted fingerprint of the original"');
  expect(csv).toHaveLength(4);
  expect(csv.slice(1).map((l) => l.split('","').pop()!.replace(/"$/, ''))).toEqual(commitments);
  for (const l of csv) expect(l).not.toContain(originalHash);

  // 7. a redacted copy: she draws the box; a NEW file is made; the original is not touched
  const file1 = page.getByTestId('file-1');
  const shaBefore = await file1.getByText(/SHA-256: /).textContent();
  await file1.getByRole('button', { name: 'Unlock & view' }).click();
  await expect(file1.getByText('Verified ✓')).toBeVisible();
  await file1.getByRole('button', { name: 'Make a redacted copy' }).click();
  const tool = file1.getByTestId('redact-tool');
  await tool.getByRole('button', { name: 'Add a box' }).click();
  await tool.getByLabel('From the left (%)').fill('0');
  await tool.getByLabel('From the top (%)').fill('0');
  await tool.getByLabel('Width (%)').fill('100');
  await tool.getByLabel('Height (%)').fill('60');
  await tool.getByRole('button', { name: 'Save as a new file' }).click();
  const copy = added.locator('li', { hasText: 'Redacted copy of exhibit 1' });
  await expect(copy).toBeVisible({ timeout: 90_000 });
  await expect(copy.getByText('Hidden details removed')).toBeVisible();
  // the copy has the covered words gone: read it with the same engine
  await copy.getByRole('button', { name: 'Read the text in this image' }).click();
  await expect(copy.getByTestId('ocr-text')).toContainText(/Total/i, { timeout: 150_000 });
  const copyText = (await copy.getByTestId('ocr-text').textContent())!;
  expect(copyText).not.toMatch(/INVOICE/i);
  expect(copyText).not.toMatch(/Paid/i);
  // the original is unchanged (same fingerprint, still exhibit 1), and the list now has the copy as exhibit 4
  await nav(page, 'Home');
  await nav(page, 'Evidence');
  await expect(page.getByTestId('file-1').getByText(/SHA-256: /)).toHaveText(shaBefore!);
  const row4 = page.getByTestId('exhibit-list').getByTestId('exhibit-row-4');
  await expect(row4).toContainText('Redacted copy of exhibit 1', { timeout: 60_000 });
  await expect(page.getByTestId('exhibit-list').getByTestId('exhibit-row-1')).toContainText('receipt-fixture.png');
  for (const line of sent) expect(line).not.toContain(originalHash);
});
