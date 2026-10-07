import { describe, expect, it } from 'vitest';
import * as c from './normalize';

type Kind = Parameters<typeof c.normalizeMatchIdentifier>[0];
const canon = (kind: Kind, v: string, p?: string) => {
  const r = c.normalizeMatchIdentifier(kind, v, p);
  return r.ok ? r.canonical : r.reason;
};

describe('normalizers', () => {
  it('maps profile URLs and handles to one canonical form', () => {
    const ig = [
      ['social_handle', 'https://www.instagram.com/Demo_Handle_123/', undefined],
      ['social_handle', 'instagram.com/demo_handle_123?igsh=abc123', undefined],
      ['social_handle', '@Demo_Handle_123', 'instagram'],
      ['social_handle', 'demo_handle_123', 'Instagram'],
      ['social_handle', 'https://instagram.com/stories/demo_handle_123/31234', undefined],
    ] as const;
    for (const [k, v, p] of ig) expect(canon(k, v, p)).toBe('instagram:demo_handle_123');
    expect(canon('social_handle', 'https://www.instagram.com/p/Cabc123/')).toBe('not_a_profile');

    expect(canon('social_handle', 'https://www.facebook.com/profile.php?id=100012345678')).toBe('facebook:id:100012345678');
    expect(canon('social_handle', 'https://facebook.com/people/Some-Name/100012345678/')).toBe('facebook:id:100012345678');
    expect(canon('social_handle', 'https://m.facebook.com/John.Doe.77')).toBe('facebook:johndoe77');
    expect(canon('social_handle', 'johndoe77', 'facebook')).toBe('facebook:johndoe77');
    expect(canon('social_handle', 'https://www.facebook.com/groups/123456')).toBe('not_a_profile');

    expect(canon('social_handle', 'https://twitter.com/Bad_Guy')).toBe('x:bad_guy');
    expect(canon('social_handle', 'https://x.com/bad_guy/status/123')).toBe('x:bad_guy');
    expect(canon('social_handle', '@BAD_GUY', 'x')).toBe('x:bad_guy');
    expect(canon('social_handle', 'https://twitter.com/search?q=x')).toBe('not_a_profile');

    expect(canon('social_handle', 'https://www.tiktok.com/@Bad.Guy/video/1')).toBe('tiktok:bad.guy');
    expect(canon('social_handle', 'https://www.snapchat.com/add/badguy22')).toBe('snapchat:badguy22');
    expect(canon('social_handle', 'https://www.linkedin.com/in/Jane-Doe-1a2b3c/')).toBe('linkedin:jane-doe-1a2b3c');
    expect(canon('social_handle', 'bad_guy', 'tiktok')).not.toBe(canon('social_handle', 'bad_guy', 'instagram'));
    expect(canon('social_handle', 'someone', 'dating_app')).toBe('unrecognized');
    expect(canon('social_handle', 'https://example.com/bad_guy')).toBe('unrecognized');
  });

  it('phones to E.164, emails canonical, names and free text refused', () => {
    expect(canon('phone', '(201) 555-0100')).toBe('phone:+12015550100');
    expect(canon('phone', '+1 201 555 0100')).toBe('phone:+12015550100');
    expect(canon('phone', '1-201-555-0100')).toBe('phone:+12015550100');
    expect(canon('phone', '0044 20 7946 0958')).toBe('phone:+442079460958');
    expect(canon('phone', '555-0100')).toBe('unrecognized');
    expect(canon('social_handle', '201 555 0100', 'whatsapp')).toBe('phone:+12015550100');
    expect(canon('email', ' John.Doe+x@GMAIL.com')).toBe('email:johndoe@gmail.com');
    expect(canon('email', 'J.Doe+tag@Example.org')).toBe('email:j.doe+tag@example.org'); // no plus-addressing assumed
    expect(canon('email', 'mailto:Someone@Example.org')).toBe('email:someone@example.org');
    expect(canon('email', 'not an email')).toBe('unrecognized');
    expect(canon('full_name', 'Ryan Smith')).toBe('name_not_unique');
    expect(canon('other', 'someone@example.com')).toBe('not_supported');
    expect(canon('other', 'tall guy with a beard')).toBe('not_supported');
    expect(canon('email', '   ')).toBe('empty');
  });
});

/** Every case from the security reviewer's probe (norm.ts), with the result required under the allow-list rules. */
describe('regression: reviewer norm.ts', () => {
  const cases: Array<[Kind, string, string | undefined, string]> = [
    // free text is never sealed (previously became phone canonicals)
    ['other', 'alice.smith1234567890', undefined, 'not_supported'],
    ['other', 'bob_9781234567890x', undefined, 'not_supported'],
    ['other', 'dob 01/02/1990, 23yo', undefined, 'not_supported'],
    ['other', 'Badguy 2015550100', undefined, 'not_supported'],
    ['other', 'https://instagram.com/_u/x', undefined, 'not_supported'],
    ['other', 'bad@guy', undefined, 'not_supported'],
    // instagram
    ['social_handle', 'https://instagram.com/_u/bad_guy', undefined, 'instagram:bad_guy'],
    ['social_handle', 'https://www.instagram.com/_u/other_guy', undefined, 'instagram:other_guy'],
    ['social_handle', 'https://www.instagram.com/share/AbCdEf123', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.instagram.com/stories/highlights/1789/', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.instagram.com/web/', undefined, 'not_a_profile'],
    ['social_handle', 'instagram.com/bad_guy', undefined, 'instagram:bad_guy'],
    ['social_handle', '@bad_guy', 'IG', 'instagram:bad_guy'],
    ['social_handle', 'bad_guy', 'Instagram ', 'instagram:bad_guy'],
    // facebook
    ['social_handle', 'https://www.facebook.com/messages/t/1000123', undefined, 'facebook:id:1000123'],
    ['social_handle', 'https://www.facebook.com/stories/1000123/', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.facebook.com/friends/requests', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.facebook.com/videos/123', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.facebook.com/home.php', undefined, 'not_a_profile'],
    ['social_handle', 'https://www.facebook.com/reel/123', undefined, 'not_a_profile'],
    ['social_handle', 'https://mbasic.facebook.com/john.smith', undefined, 'facebook:johnsmith'],
    ['social_handle', 'https://l.facebook.com/l.php?u=x', undefined, 'not_a_profile'],
    // x / twitter
    ['social_handle', 'https://x.com/notifications', undefined, 'not_a_profile'],
    ['social_handle', 'https://twitter.com/intent/user?screen_name=badguy', undefined, 'x:badguy'],
    // linkedin
    ['social_handle', 'https://linkedin.com/in/John-Smith', undefined, 'linkedin:john-smith'],
    ['social_handle', 'https://uk.linkedin.com/in/john-smith', undefined, 'linkedin:john-smith'],
    // tiktok / snapchat
    ['social_handle', 'https://www.tiktok.com/@bad.guy/video/1', undefined, 'tiktok:bad.guy'],
    ['social_handle', 'https://vm.tiktok.com/ZMabc/', undefined, 'short_link'],
    ['social_handle', 'https://www.snapchat.com/add/badguy', undefined, 'snapchat:badguy'],
    // phones
    ['phone', '+44 (0) 20 7946 0958', undefined, 'phone:+442079460958'],
    ['phone', '+44 20 7946 0958', undefined, 'phone:+442079460958'],
    ['phone', '011 44 20 7946 0958', undefined, 'phone:+442079460958'],
    ['phone', '(123) 456-7890', undefined, 'unrecognized'],
    ['phone', '9876543210', undefined, 'phone:+19876543210'],
    ['phone', '+91 98765 43210', undefined, 'phone:+919876543210'],
    ['phone', '201-555-0100 x', undefined, 'unrecognized'],
    ['phone', '+1 201 555 0100 ext 12', undefined, 'phone:+12015550100'],
    ['phone', '201.555.0100 or 201.555.0101', undefined, 'unrecognized'],
    // emails
    ['email', 'Bad.Guy+x@GoogleMail.com', undefined, 'email:badguy@gmail.com'],
    ['email', 'badguy@gmail.com.', undefined, 'email:badguy@gmail.com'],
    ['email', 'badguy@bücher.de', undefined, 'email:badguy@xn--bcher-kva.de'],
    ['email', 'badguy@xn--bcher-kva.de', undefined, 'email:badguy@xn--bcher-kva.de'],
    ['email', 'bad+guy@outlook.com', undefined, 'email:bad@outlook.com'],
    ['email', '"bad guy"@example.com', undefined, 'unrecognized'],
    ['email', 'bаdguy@gmail.com', undefined, 'unrecognized'], // Cyrillic "а" homoglyph
  ];
  it.each(cases)('%s %j (platform %j) → %s', (kind, value, platform, expected) => {
    expect(canon(kind, value, platform)).toBe(expected);
  });
});

describe('phone rules', () => {
  it.each([
    ['201-555-0100 ext. 12', 'phone:+12015550100'],
    ['201-555-0100x12', 'phone:+12015550100'],
    ['201-555-0100 x 12', 'phone:+12015550100'],
    ['00 44 (0)20 7946 0958', 'phone:+442079460958'],
    ['+1 (0) 201 555 0100', 'phone:+12015550100'], // "(0)" after a country code is a trunk digit
    ['201-055-0100', 'unrecognized'], // exchange starts with 0
    ['101-555-0100', 'unrecognized'], // area code starts with 1
    ['+1 123 456 7890', 'unrecognized'],
    ['000-000-0000', 'unrecognized'],
    ['+1 000 000 0000', 'unrecognized'],
    ['2015550100 2015550101', 'unrecognized'],
    ['201-555-0100, 201-555-0101', 'unrecognized'],
    ['+44 20 7946 0958 +44 20 7946 0959', 'unrecognized'],
    ['call 201 555 0100', 'unrecognized'],
    ['+0 20 7946 0958', 'unrecognized'],
    ['+1234567', 'unrecognized'], // too short
    ['+1234567890123456', 'unrecognized'], // > 15 digits
    ['020 7946 0958', 'unrecognized'], // UK domestic form, no country code → never assume +1
  ])('%j → %s', (v, expected) => {
    expect(canon('phone', v)).toBe(expected);
  });
});

describe('email rules', () => {
  it.each([
    ['John.Doe@googlemail.com', 'email:johndoe@gmail.com'],
    ['a.b+c@hotmail.co.uk', 'email:a.b@hotmail.co.uk'],
    ['bad+guy@icloud.com', 'email:bad@icloud.com'],
    ['bad+guy@proton.me', 'email:bad@proton.me'],
    ['bad+guy@fastmail.com', 'email:bad@fastmail.com'],
    ['bad+guy@yahoo.com', 'email:bad+guy@yahoo.com'],
    ['first.last@example.org', 'email:first.last@example.org'],
    ['+tag@outlook.com', 'unrecognized'],
    ['.bad@example.org', 'unrecognized'],
    ['bad.@example.org', 'unrecognized'],
    ['ba..d@example.org', 'unrecognized'],
    ['bad@guy', 'unrecognized'],
    ['@example.org', 'unrecognized'],
    ['bad@1.2.3.4', 'unrecognized'],
    ['bad@example.org/path', 'unrecognized'],
    ['bad guy@example.org', 'unrecognized'],
    ['a@b@example.org', 'unrecognized'],
  ])('%j → %s', (v, expected) => {
    expect(canon('email', v)).toBe(expected);
  });
});

describe('allowed profile forms', () => {
  it.each([
    // instagram
    ['https://instagr.am/bad_guy', 'instagram:bad_guy'],
    ['https://www.instagram.com/bad_guy/tagged/', 'instagram:bad_guy'],
    ['https://www.instagram.com/bad_guy/reels/', 'instagram:bad_guy'],
    ['https://www.instagram.com/bad_guy/p/Cabc123/', 'instagram:bad_guy'],
    ['https://m.instagram.com/_u/bad_guy/', 'instagram:bad_guy'],
    ['https://www.instagram.com/stories/bad_guy/', 'instagram:bad_guy'],
    // facebook
    ['https://www.facebook.com/profile.php?id=100012345678&sk=about', 'facebook:id:100012345678'],
    ['https://facebook.com/people/Some-Name/100012345678', 'facebook:id:100012345678'],
    ['https://www.facebook.com/messages/t/john.smith', 'facebook:johnsmith'],
    ['https://de-de.facebook.com/john.smith', 'facebook:johnsmith'],
    ['https://web.facebook.com/john.smith/photos', 'facebook:johnsmith'],
    ['https://touch.facebook.com/john.smith/posts/123', 'facebook:johnsmith'],
    ['https://fb.com/john.smith', 'facebook:johnsmith'],
    ['https://www.facebook.com/100012345678', 'facebook:id:100012345678'],
    // x
    ['https://mobile.twitter.com/bad_guy', 'x:bad_guy'],
    ['x.com/bad_guy/status/1234567890', 'x:bad_guy'],
    ['https://twitter.com/intent/follow?screen_name=Bad_Guy', 'x:bad_guy'],
    // tiktok
    ['https://www.tiktok.com/@bad.guy', 'tiktok:bad.guy'],
    ['tiktok.com/@bad.guy/video/7234567890123456789?lang=en', 'tiktok:bad.guy'],
    // snapchat
    ['https://snapchat.com/add/badguy22?share_id=x', 'snapchat:badguy22'],
    ['https://www.snapchat.com/@badguy22', 'snapchat:badguy22'],
    // linkedin
    ['https://in.linkedin.com/in/john-smith-12345/', 'linkedin:john-smith-12345'],
    ['https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller', 'linkedin:jörg-müller'],
    ['https://de.linkedin.com/in/John-Smith/details/experience/', 'linkedin:john-smith'],
  ])('%j → %s', (v, expected) => {
    expect(canon('social_handle', v)).toBe(expected);
  });

  it.each([
    ['https://fb.me/abc', 'short_link'],
    ['https://m.me/john.smith', 'short_link'],
    ['https://vt.tiktok.com/ZSabc/', 'short_link'],
    ['https://www.tiktok.com/t/ZTabc/', 'short_link'],
    ['https://www.snapchat.com/t/abc123', 'short_link'],
    ['https://lnkd.in/abc', 'short_link'],
    ['https://www.tiktok.com/discover/x', 'not_a_profile'],
    ['https://www.snapchat.com/spotlight/abc', 'not_a_profile'],
    ['https://story.snapchat.com/@badguy22', 'not_a_profile'],
    ['https://www.linkedin.com/pub/john-smith/1/2/3', 'not_a_profile'],
    ['https://www.linkedin.com/company/acme', 'not_a_profile'],
    ['https://www.linkedin.com/in/', 'not_a_profile'],
    ['https://business.facebook.com/john.smith', 'not_a_profile'],
    ['https://lm.facebook.com/l.php?u=x', 'not_a_profile'],
    ['https://www.facebook.com/sharer/sharer.php?u=x', 'not_a_profile'],
    ['https://www.facebook.com/permalink.php?story_fbid=1&id=100012345678', 'not_a_profile'],
    ['https://www.facebook.com/profile.php', 'not_a_profile'],
    ['https://twitter.com/i/user/12345', 'not_a_profile'],
    ['https://twitter.com/intent/user?user_id=12345', 'not_a_profile'],
    ['https://instagram.com', 'not_a_profile'],
    ['https://user:pass@instagram.com/bad_guy', 'unrecognized'],
    ['https://evil.example@instagram.com/bad_guy', 'unrecognized'],
    ['https://instagram.com@evil.example/bad_guy', 'unrecognized'],
    ['https://instagram.com/%E0%A4%A', 'unrecognized'],
    ['https://instagram.com.evil.example/bad_guy', 'unrecognized'],
    ['https://notinstagram.com/bad_guy', 'unrecognized'],
    ['ftp://instagram.com/bad_guy', 'unrecognized'],
  ])('%j → %s', (v, expected) => {
    expect(canon('social_handle', v)).toBe(expected);
  });

  it('exposes the reason through parseProfileUrl and keeps canonicalFromProfileUrl nullable', () => {
    expect(c.parseProfileUrl('https://instagram.com/share/x')).toEqual({ ok: false, reason: 'not_a_profile' });
    expect(c.parseProfileUrl('bad_guy')).toEqual({ ok: false, reason: 'not_a_url' });
    expect(c.canonicalFromProfileUrl('https://instagram.com/share/x')).toBeNull();
    expect(c.canonicalFromProfileUrl('https://instagram.com/bad_guy')).toBe('instagram:bad_guy');
  });
});

/**
 * Canonicals that would collapse many unrelated people into one "person" (a magnet). Kept here, independent of the
 * implementation's own route lists, so a regression in the parser is caught rather than mirrored.
 */
const ROUTE_WORDS: Record<string, string[]> = {
  instagram: [
    'share', 's', 'web', 'stories', 'highlights', 'reel', 'reels', 'p', 'tv', 'explore', 'accounts', 'direct', '_u',
    'about', 'developer', 'legal', 'emails', 'challenge', 'oauth', 'session', 'privacy', 'terms', 'ar', 'lite',
    'download', 'api', 'graphql', 'static', 'invites',
  ],
  facebook: [
    'friends', 'stories', 'videos', 'watch', 'groups', 'pages', 'events', 'marketplace', 'messages', 'reel', 'reels',
    'share', 'sharer', 'people', 'photo', 'photos', 'l', 'login', 'help', 'hashtag', 'search', 'notifications',
    'settings', 'bookmarks', 'saved', 'memories', 'fundraisers', 'ads', 'business', 'privacy', 'policies', 'legal',
    'gaming', 'home.php', 'profile.php', 'l.php', 'sharer.php', 'photo.php', 'story.php', 'permalink.php',
  ],
  x: [
    'home', 'i', 'intent', 'search', 'share', 'notifications', 'messages', 'explore', 'settings', 'hashtag',
    'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'jobs', 'about', 'help', 'account', 'lists', 'topics',
    'communities', 'premium', 'download',
  ],
  tiktok: ['t', 'discover', 'foryou', 'explore', 'live', 'tag', 'music', 'search', 'upload', 'login'],
  snapchat: ['add', 'spotlight', 't', 'discover', 'lens', 'lenses', 'download', 'unlock'],
  linkedin: ['in', 'company', 'school', 'pub', 'feed', 'posts', 'jobs', 'groups', 'pulse', 'learning', 'search'],
};
const fold = (platform: string, w: string) => (platform === 'facebook' ? w.replace(/\./g, '') : w);
const MAGNETS = new Set<string>([
  ...Object.entries(ROUTE_WORDS).flatMap(([p, ws]) => ws.map((w) => `${p}:${fold(p, w)}`)),
  'facebook:homephp', 'facebook:profilephp', 'facebook:lphp', 'facebook:sharerphp',
  'x:status', 'tiktok:video', 'phone:+10000000000', 'phone:+11111111111',
]);
const HOSTS: Record<string, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com'],
  x: ['twitter.com', 'x.com'],
  tiktok: ['tiktok.com'],
  snapchat: ['snapchat.com'],
  linkedin: ['linkedin.com'],
};
const PREFIXES = ['', 'www.', 'm.', 'mbasic.', 'web.', 'mobile.', 'touch.', 'uk.', 'de-de.', 'l.', 'lm.', 'business.', 'help.', 'vm.'];
const TAILS = ['', '/', '/123', '/1000123/', '/abc', '/abc/def', '/highlights/1789', '?id=1', '/?u=x', '/t/abc', '#x'];
const ALL_WORDS = [...new Set(Object.values(ROUTE_WORDS).flat())];

const isMagnet = (canonical: string) => {
  if (MAGNETS.has(canonical) || /^email:@|@$/.test(canonical)) return true;
  const [platform, ...rest] = canonical.split(':');
  const handle = rest.join(':');
  return (ROUTE_WORDS[platform!] ?? []).some((w) => fold(platform!, w) === handle);
};

describe('magnet denylist', () => {
  it('no non-profile URL on any supported host produces a magnet canonical', () => {
    let checked = 0;
    const leaks: string[] = [];
    for (const hosts of Object.values(HOSTS))
      for (const host of hosts)
        for (const prefix of PREFIXES)
          for (const word of ALL_WORDS)
            for (const tail of TAILS)
              for (const scheme of ['https://', '']) {
                const value = `${scheme}${prefix}${host}/${word}${tail}`;
                const r = c.normalizeMatchIdentifier('social_handle', value);
                checked++;
                if (r.ok && isMagnet(r.canonical)) leaks.push(`${value} → ${r.canonical}`);
              }
    expect(checked).toBeGreaterThan(10_000);
    expect(leaks).toEqual([]);
  });

  it('a typed handle equal to a route word of its platform is refused', () => {
    const leaks: string[] = [];
    for (const [platform, words] of Object.entries(ROUTE_WORDS))
      for (const w of words)
        for (const typed of [w, `@${w}`, w.toUpperCase(), ` ${w} `]) {
          const r = c.normalizeMatchIdentifier('social_handle', typed, platform);
          if (r.ok) leaks.push(`${platform} ${JSON.stringify(typed)} → ${r.canonical}`);
        }
    expect(leaks).toEqual([]);
  });

  it('placeholder phones and degenerate emails never produce a canonical', () => {
    for (const v of ['0000000000', '+1 000 000 0000', '1111111111', '+1 111 111 1111', '(000) 000-0000'])
      expect(canon('phone', v)).toBe('unrecognized');
    for (const v of ['@gmail.com', '+@gmail.com', '.@gmail.com', '...@gmail.com', '+x@outlook.com'])
      expect(canon('email', v)).toBe('unrecognized');
  });
});

describe('reject copy', () => {
  it('every MatchRejectReason has a gentle, non-empty message', () => {
    const reasons: c.MatchRejectReason[] = ['empty', 'name_not_unique', 'not_supported', 'not_a_profile', 'short_link', 'unrecognized'];
    for (const r of reasons) expect(c.MATCH_REJECT_COPY[r]?.trim().length ?? 0).toBeGreaterThan(10);
    expect(Object.keys(c.MATCH_REJECT_COPY).sort()).toEqual([...reasons].sort());
    expect(c.MATCH_REJECT_COPY.not_a_profile).toBe('That link doesn’t point to one person’s profile — try their profile page or @handle.');
    expect(c.MATCH_REJECT_COPY.short_link).toBe(
      'Short links can’t be checked on this device. Open the link, then copy their profile page or @handle.',
    );
  });
});
