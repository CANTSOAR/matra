/**
 * Plain-language notices for the key moments (PRD N4; Legal Research Memo §2, §6, §7A; Security Whitepaper §7):
 * before she starts writing, when versions are saved or sealed, before sharing, when a file is downloaded, before
 * deleting, and when evidence is added. Plus the sealed-match consent she agrees to (Memo §7A).
 *
 * One source of truth: screens render these through <KeyNotice>, and the interview script builds its words from them,
 * so every place says the same thing. Style: short sentences, plain words, calm, never alarming, never legal advice.
 * Never say "subpoena-proof", "bulletproof", "admissible" or "tamper-proof".
 */

export interface Notice {
  id: string;
  title: string;
  /** 1–3 short sentences, always shown. */
  body: readonly string[];
  /** Optional "Learn more" text, shown only if she opens it. */
  more?: readonly string[];
}

const NOT_ADVICE = 'This is general information, not legal advice.';

export const NOTICES = {
  /** Story space and interview, before she starts writing (Memo §2 product implication 2). */
  beforeWriting: {
    id: 'before-writing',
    title: 'Good to know before you start',
    body: [
      'Matra can’t read what you write.',
      'But a court can order you to hand it over.',
      'Anything you give police will be shared with the defense.',
    ],
    more: [
      'Your words are locked on this device before they’re saved, so the people who run Matra can’t open them, even if they are asked to. Matra does keep a few basic facts, like when your account was used. It never has your words.',
      'Locking your words doesn’t stop a court from asking you, or anyone you share with, for a copy. What you write for yourself usually isn’t private in court the way a conversation with your own lawyer is.',
      `If you’re working with a lawyer, you can ask them how and when to write things down. ${NOT_ADVICE}`,
    ],
  },

  /** When a version is saved or sealed (Memo §2 "Drafts and versions"). */
  savedVersions: {
    id: 'saved-versions',
    title: 'Every saved version is kept',
    body: [
      'Each time your story is saved or sealed, the earlier versions are kept too.',
      'If you are ever asked to hand over your records, that can include earlier versions.',
    ],
    more: [
      'Memories after something like this often come back in pieces, or in a different order. That’s normal.',
      'Keeping every version shows when you wrote what, and that nothing was changed later. Earlier versions stay in your space until you delete your account.',
      NOT_ADVICE,
    ],
  },

  /** Before sharing with an attorney (Whitepaper §7). */
  sharing: {
    id: 'sharing',
    title: 'Before you share',
    body: [
      'The attorney can read and save what you share.',
      'Turning off sharing stops new access, but it can’t erase what they already saved.',
    ],
    more: [
      'Talking with a lawyer to get legal advice is usually kept confidential. But sharing doesn’t change the fact that a court can order you to hand over your own records.',
      'Every time the attorney opens your file or downloads one of your files, you’ll see it in your activity on Home.',
      `${NOT_ADVICE} The attorney can explain how it applies to you.`,
    ],
  },

  /** Downloading the Incident Summary or VCCO draft PDF. */
  downloadFile: {
    id: 'download-file',
    title: 'Downloaded files aren’t locked',
    body: [
      'Once you download a PDF, it is not encrypted. Anyone who can open this device, or the file, can read it.',
      'Keep it somewhere safe, and delete it when you no longer need it.',
    ],
    more: [
      'Downloads usually go to a “Downloads” folder, and some devices copy them to an online backup. If someone else uses this device, think about where the file is saved.',
      'Your sealed story in Matra stays locked. Only the downloaded copy is unlocked.',
    ],
  },

  /** Before deleting the account (Memo §2 "Deletion and spoliation"; Succession and Data Promise D2). */
  deleting: {
    id: 'deleting',
    title: 'If there is a legal case, talk to a lawyer first',
    body: [
      'If there is a legal case, or there might be one, please talk to a lawyer before you delete anything.',
      'Deleting records that could matter in a case can cause legal problems for you.',
      NOT_ADVICE,
    ],
    more: [
      'When a case is going on, or is likely, people are often expected to keep records that might matter. Deleting them can cause problems, even if you didn’t mean any harm.',
      'Matra’s tamper-evident record would still show that your records existed and were deleted. It never shows what they said.',
      'A free advocate at 1-800-656-4673 can help you find a lawyer.',
    ],
  },

  /** When evidence is added (Whitepaper §3 "Evidence handling"). */
  keepOriginals: {
    id: 'keep-originals',
    title: 'Keep your originals',
    body: [
      'Please keep the original file, and the phone or device it came from.',
      'Matra saves a copy with hidden details like location removed, so it isn’t an exact match for the original.',
    ],
    more: [
      'The original can show things the copy can’t, like when a photo was taken. If this ever matters in a case, people may ask for the original.',
      'If keeping the original on your device doesn’t feel safe, an advocate or a lawyer can help you think about where to keep it.',
    ],
  },
} as const satisfies Record<string, Notice>;

/**
 * Sealed-match consent (Memo §7A). She sees these lines, in this order, wherever she can opt in (the story space and
 * the one-question-at-a-time interview), and on the "What you've sealed" page. The exact same words, joined, are
 * stored in her encrypted contact bundle (lib/vault.ts MATCHING_CONSENT_STATEMENT), so the counselor sees exactly
 * what she was told.
 *
 * Accuracy (threat model W2/W14): say the identifier is sealed and that only a counselor sees a match. Never claim
 * that the people who run Matra cannot test identifiers: in this MVP they hold both key shares.
 */
export const MATCHING_CONSENT_LINES: readonly string[] = [
  'If you turn it on, the email, phone number, or social media profile you gave is sealed on this device before it is sent. Names are not used. Many people share a name, so a name alone is not unique enough to match safely.',
  'If someone else names the same person, only a Legal Options Counselor sees the match. The counselor is a licensed attorney — not the police, not your school.',
  'The counselor would reach out to you once, privately, by the way you choose, and separately from anyone else. That only happens because you said yes here.',
  'A match is a lead, not evidence. It doesn’t prove anything on its own.',
  'You can say no to the counselor. If you do, there is no follow-up. There are no fees.',
  'You will never see a match in this app. It always says “Sealed”, so no one can use it to find out if they have been named.',
  'This is a test version. For now, the people who run Matra could check whether a particular email or number was sealed. Before real use, the key that makes this possible will be split between separate organizations.',
  'You can withdraw a sealed match at any time. Nothing else happens unless you decide. It is completely okay to say no.',
];
