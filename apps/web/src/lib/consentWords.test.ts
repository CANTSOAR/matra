/**
 * The consent words, pinned word for word.
 *
 * CHANGING ANY OF THESE NEEDS ADVOCATE AND COUNSEL REVIEW (Q-023; MATRA_PLAN §9, "PR 9, PR 37 consent text"). These
 * are the sentences she agrees to before an attorney or a counselor can open her account, and the words the server
 * checks. If a change here is approved, update the literal text below in the same commit, so the diff shows exactly
 * what changed. shareContents.test.tsx checks that these words cover what the recipient can decrypt.
 */
import { describe, expect, it } from 'vitest';
import type { AttorneyProfile } from '@matra/shared';
import { ACCOUNT_PARTS, shareAliasSentence, sharedFilesSentence, writtenAccountSentence } from '@matra/shared';
import { ATTORNEY_SUMMARY_LINE, buildConsentStatement } from '../screens/Share';
import { COUNSELOR_SUMMARY_LINE, buildReportConsentStatement } from './disclosures';

const FP = 'ABCD-EF01-2345-6789-ABCD-EF01-2345-6789';

describe('consent words (advocate and counsel review before any change)', () => {
  it('the attorney share statement, word for word', () => {
    expect(
      buildConsentStatement({
        alias: 'Client BCDFG',
        attorney: { displayName: 'Alex Rivera, Esq.', organization: 'Demo Legal Aid' } as AttorneyProfile,
        fingerprint: FP,
        files: 2,
        sealedAt: '2026-10-01T10:00:00.000Z',
        at: '2026-10-02T10:00:00.000Z',
        expiresInDays: 90,
      }).split('\n'),
    ).toEqual([
      "I choose to share my sealed Matra file (sealed 2026-10-01T10:00:00.000Z) with Alex Rivera, Esq. of Demo Legal Aid, a verified attorney, so that they can advise me.",
      "Matra shows this share to them as \"Client BCDFG\", a name made up for this share only, not the alias I sign in with.",
      "My written account is always shared. It holds everything I wrote or chose in Matra, including any of these I gave: my name and legal name, date of birth, pronouns and language; my phone number and email, how it’s safe to reach me, the state and county I live in, and any interpreter or access needs; what happened, in my own words (each piece with when I added it and whether I typed or spoke it), and when and where it happened; who did this, what I know about them and how to find them, and whether I set up a sealed match on them, anyone who saw or heard something, and who I’ve told and what I said; medical care and injuries, forensic exams, reports I’ve made, and physical evidence I kept; my answers about my safety; costs, losses and insurance, and any compensation details I gave (such as a mailing address, employer or another contact person); what I’d like to do next; the list of all my evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files I don’t share; when I sealed it.",
      "Their app can lay my written account out as an incident summary, which they can download as a PDF.",
      "I am also sharing 2 of the evidence files themselves, the ones I chose.",
      "It will be encrypted on my device so that only the holder of the key with fingerprint ABCD-EF01-2345-6789-ABCD-EF01-2345-6789 can open it.",
      "This access expires 90 days after the date below unless I renew it.",
      "This does not report anything to police. The attorney can read and save what I share. I can revoke access at any time. Access also ends on its own on the expiry date, unless I renew it. Revoking or expiry stops future access, but it can’t erase what was already viewed or saved.",
      "Agreed at 2026-10-02T10:00:00.000Z.",
    ]);
  });

  it('the counselor release statement, word for word', () => {
    expect(
      buildReportConsentStatement({
        counselor: { displayName: 'Sam Lee', organization: 'Demo LOC' },
        fingerprint: FP,
        files: 0,
        sealedAt: '2026-10-01T10:00:00.000Z',
        expiresInDays: 90,
        at: '2026-10-02T10:00:00.000Z',
      }).split('\n'),
    ).toEqual([
      "I choose to share my sealed Matra account (sealed 2026-10-01T10:00:00.000Z) with Sam Lee of Demo LOC, the legal options counselor who asked for it, and with no one else.",
      "My written account is always shared. It holds everything I wrote or chose in Matra, including any of these I gave: my name and legal name, date of birth, pronouns and language; my phone number and email, how it’s safe to reach me, the state and county I live in, and any interpreter or access needs; what happened, in my own words (each piece with when I added it and whether I typed or spoke it), and when and where it happened; who did this, what I know about them and how to find them, and whether I set up a sealed match on them, anyone who saw or heard something, and who I’ve told and what I said; medical care and injuries, forensic exams, reports I’ve made, and physical evidence I kept; my answers about my safety; costs, losses and insurance, and any compensation details I gave (such as a mailing address, employer or another contact person); what I’d like to do next; the list of all my evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files I don’t share; when I sealed it.",
      "Their app shows my written account laid out as an incident summary.",
      "I am not sharing any of the evidence files themselves.",
      "It is encrypted on my device so that only the holder of the key with fingerprint ABCD-EF01-2345-6789-ABCD-EF01-2345-6789 can open it.",
      "It is not shared with anyone else who named the same person.",
      "Access ends after 90 days unless I stop it sooner. Stopping ends future access, but it can’t take back what was already read.",
      "Agreed at 2026-10-02T10:00:00.000Z.",
    ]);
  });

  it('the file and label sentences, for every count', () => {
    expect(sharedFilesSentence(0)).toBe('I am not sharing any of the evidence files themselves.');
    expect(sharedFilesSentence(1)).toBe('I am also sharing 1 of the evidence files themselves, the one I chose.');
    expect(sharedFilesSentence(2)).toBe('I am also sharing 2 of the evidence files themselves, the ones I chose.');
    expect(shareAliasSentence('Client BCDFG')).toBe(
      'Matra shows this share to them as "Client BCDFG", a name made up for this share only, not the alias I sign in with.',
    );
    expect(writtenAccountSentence()).toBe("My written account is always shared. It holds everything I wrote or chose in Matra, including any of these I gave: my name and legal name, date of birth, pronouns and language; my phone number and email, how it’s safe to reach me, the state and county I live in, and any interpreter or access needs; what happened, in my own words (each piece with when I added it and whether I typed or spoke it), and when and where it happened; who did this, what I know about them and how to find them, and whether I set up a sealed match on them, anyone who saw or heard something, and who I’ve told and what I said; medical care and injuries, forensic exams, reports I’ve made, and physical evidence I kept; my answers about my safety; costs, losses and insurance, and any compensation details I gave (such as a mailing address, employer or another contact person); what I’d like to do next; the list of all my evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files I don’t share; when I sealed it.");
  });

  it('what both screens list as always shared, and their summary lines, word for word', () => {
    expect(ACCOUNT_PARTS.map((p) => p.screen)).toEqual([
      "your name and legal name, date of birth, pronouns and language",
      "your phone number and email, how it’s safe to reach you, the state and county you live in, and any interpreter or access needs",
      "what happened, in your own words (each piece with when you added it and whether you typed or spoke it), and when and where it happened",
      "who did this, what you know about them and how to find them, and whether you set up a sealed match on them, anyone who saw or heard something, and who you’ve told and what you said",
      "medical care and injuries, forensic exams, reports you’ve made, and physical evidence you kept",
      "your answers about your safety",
      "costs, losses and insurance, and any compensation details you gave (such as a mailing address, employer or another contact person)",
      "what you’d like to do next",
      "the list of all your evidence files, with their names, file types and sizes, descriptions, dates and fingerprints, whether hidden photo data like location was removed, and Matra’s reference for each uploaded file, including files you don’t share",
      "when you sealed it",
    ]);
    expect(ATTORNEY_SUMMARY_LINE).toBe("Their app can lay your written account out as an incident summary, which they can download as a PDF.");
    expect(COUNSELOR_SUMMARY_LINE).toBe("Their app shows your written account laid out as an incident summary.");
  });
});
