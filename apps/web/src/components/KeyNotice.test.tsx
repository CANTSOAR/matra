import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MATCHING_CONSENT_LINES, NOTICES } from '../lib/disclosures';
import { KeyNotice } from './KeyNotice';

const BANNED = /subpoena-proof|bulletproof|admissible|tamper-proof/i;

describe('KeyNotice', () => {
  it('shows a title and a short body; "Learn more" is closed until she opens it', async () => {
    const user = userEvent.setup();
    render(<KeyNotice notice={NOTICES.downloadFile} />);
    const note = screen.getByRole('note', { name: NOTICES.downloadFile.title });
    expect(note).toHaveTextContent('Once you download a PDF, it is not encrypted.');
    const details = within(note).getByText('Learn more').closest('details')!;
    expect(details.open).toBe(false);
    await user.click(within(note).getByText('Learn more'));
    expect(details.open).toBe(true);
    expect(within(details).getByText(/Only the downloaded copy is unlocked/)).toBeVisible();
  });

  it('every notice is short (1–3 sentences) and uses none of the overstated words', () => {
    for (const n of Object.values(NOTICES)) {
      const sentences = n.body.join(' ').split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, n.id).toBeGreaterThanOrEqual(1);
      expect(sentences.length, n.id).toBeLessThanOrEqual(3);
      expect([n.title, ...n.body, ...(n.more ?? [])].join(' ')).not.toMatch(BANNED);
    }
    expect(MATCHING_CONSENT_LINES.join(' ')).not.toMatch(BANNED);
  });

  it('uses the memo’s approved words for the moments that matter', () => {
    expect(NOTICES.beforeWriting.body.join(' ')).toBe(
      'Matra can’t read what you write. But a court can order you to hand it over. Anything you give police will be shared with the defense.',
    );
    expect(NOTICES.savedVersions.title).toBe('Every saved version is kept');
    expect(NOTICES.deleting.body.join(' ')).toMatch(/talk to a lawyer before you delete/);
    expect(NOTICES.deleting.body.join(' ')).toMatch(/not legal advice/);
    expect(NOTICES.sharing.body.join(' ')).toMatch(/can’t erase what they already saved/);
    expect(NOTICES.keepOriginals.body.join(' ')).toMatch(/keep the original file, and the phone or device it came from/);
  });
});
