/**
 * Identifier normalization for sealed matching (see ./matching.ts). Two survivors typing the same person in different
 * forms must produce the same canonical string (the OPRF input), and nothing that is NOT one person's identifier may
 * ever produce a canonical string (a "magnet" canonical — e.g. every Instagram share link collapsing to
 * "instagram:share" — would match unrelated reports).
 *
 * Design: everything here is ALLOW-LIST based. A profile URL is accepted only when its host is a known host of a
 * supported app AND its path has one of the few shapes that name exactly one account on that app; anything else on
 * a supported host is `not_a_profile`. Phones must look like exactly one valid number; emails must be plain ASCII
 * addresses. Free text (`other`) and names are never sealed.
 */
import type { IdentifierKind, MatchContactBundle } from '@matra/shared';

// Ideas ported (reimplemented) from callisto-core reporting/validators.py: profile-URL → canonical handle for
// Facebook (incl. profile.php?id= and /people/), Instagram, Twitter/X, plus TikTok, Snapchat, LinkedIn; phones to
// E.164; emails canonicalised. Name-only matching is dropped.

export type MatchKind = MatchContactBundle['identifier']['kind'];

/** Every reason an identifier can be refused. Each has survivor-facing copy in MATCH_REJECT_COPY. */
export type MatchRejectReason =
  | 'empty'
  | 'name_not_unique'
  | 'not_supported'
  | 'not_a_profile'
  | 'short_link'
  | 'unrecognized';

export type NormalizedIdentifier =
  | { ok: true; kind: MatchKind; canonical: string; platform?: string }
  | { ok: false; reason: MatchRejectReason };

/** Plain-language explanations for a rejected identifier (shown to the survivor). */
export const MATCH_REJECT_COPY: Record<MatchRejectReason, string> = {
  empty: 'Nothing was entered.',
  name_not_unique: 'Names aren’t unique enough to match safely, so names are never used for sealed matching.',
  not_supported: 'Only an email address, a phone number, or a social media profile can be used for a sealed match.',
  not_a_profile: 'That link doesn’t point to one person’s profile — try their profile page or @handle.',
  short_link: 'Short links can’t be checked on this device. Open the link, then copy their profile page or @handle.',
  unrecognized:
    'We couldn’t recognise this as an email, a phone number, or a profile on a supported app, so it can’t be matched safely.',
};

const PLATFORM_ALIASES: Record<string, string> = {
  instagram: 'instagram', ig: 'instagram', insta: 'instagram',
  facebook: 'facebook', fb: 'facebook',
  twitter: 'x', x: 'x', 'x (twitter)': 'x', 'twitter/x': 'x',
  tiktok: 'tiktok', 'tik tok': 'tiktok',
  snapchat: 'snapchat', snap: 'snapchat',
  linkedin: 'linkedin',
  discord: 'discord',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
};

const HANDLE_RULES: Record<string, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  x: /^[a-z0-9_]{1,15}$/,
  tiktok: /^[a-z0-9._]{2,24}$/,
  snapchat: /^[a-z][a-z0-9._-]{2,14}$/,
  facebook: /^[a-z0-9]{5,50}$/, // dots are ignored by Facebook and stripped before this check
  linkedin: /^[\p{L}\p{N}-]{3,100}$/u,
  discord: /^[a-z0-9._]{2,32}$/,
  telegram: /^[a-z0-9_]{5,32}$/,
};

/**
 * Route words of each app: never a person's handle. Used (a) to refuse a typed handle equal to one of them and
 * (b) as an extra guard on the first path segment of a profile URL. The URL parsers below are allow-lists, so a word
 * missing from here does not by itself open a magnet — it is defence in depth.
 */
export const RESERVED_ROUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  instagram: new Set([
    '_u', '_n', 'about', 'accounts', 'ads', 'api', 'ar', 'audio', 'blog', 'business', 'call', 'challenge', 'contact',
    'create', 'creators', 'data', 'developer', 'developers', 'direct', 'directory', 'download', 'embed', 'emails',
    'explore', 'favicon.ico', 'fragments', 'graphql', 'help', 'highlights', 'invite', 'invites', 'legal', 'lite',
    'locations', 'login', 'logout', 'meta', 'music', 'nametag', 'oauth', 'p', 'popular', 'press', 'privacy', 'qr',
    'reel', 'reels', 'robots.txt', 'run', 's', 'safety', 'session', 'share', 'shop', 'shopping', 'signup',
    'sitemap.xml', 'static', 'stories', 'terms', 'threads', 'topics', 'tv', 'web', 'your_activity',
  ]),
  facebook: new Set([
    'about', 'ads', 'ajax', 'api', 'apps', 'appcenter', 'biz', 'bookmarks', 'business', 'campaign', 'careers',
    'checkpoint', 'communities', 'community', 'composer', 'connect', 'developers', 'dialog', 'donate', 'events',
    'feeds', 'find-friends', 'friends', 'fundraiser', 'fundraisers', 'games', 'gaming', 'graph', 'groups', 'hashtag',
    'help', 'home', 'jobs', 'l', 'latest', 'legal', 'live', 'login', 'logout', 'marketplace', 'me', 'media',
    'memories', 'messages', 'messenger', 'mobile', 'news', 'notes', 'notifications', 'offers', 'onthisday', 'p',
    'page', 'pages', 'people', 'permalink', 'pg', 'photo', 'photos', 'places', 'plugins', 'policies', 'policy',
    'privacy', 'privacy_center', 'profile', 'r', 'recover', 'reel', 'reels', 'reg', 'saved', 'search', 'security',
    'settings', 'share', 'sharer', 'shops', 'stories', 'story', 'terms', 'tr', 'video', 'videos', 'watch', 'weather',
  ]),
  x: new Set([
    'about', 'account', 'ads', 'bookmarks', 'business', 'communities', 'compose', 'connect_people', 'display',
    'download', 'explore', 'followers', 'following', 'grok', 'hashtag', 'help', 'home', 'i', 'intent', 'jobs',
    'lists', 'login', 'logout', 'messages', 'notifications', 'oauth', 'personalization', 'premium', 'privacy',
    'rules', 'safety', 'search', 'session', 'settings', 'share', 'signup', 'spaces', 'status', 'statuses', 'topics',
    'tos', 'verified-choose', 'who_to_follow',
  ]),
  tiktok: new Set([
    'about', 'business', 'creators', 'discover', 'embed', 'explore', 'following', 'foryou', 'friends', 'legal',
    'live', 'login', 'logout', 'music', 'privacy', 'search', 'signup', 't', 'tag', 'upload', 'video',
  ]),
  snapchat: new Set([
    'add', 'ads', 'community', 'create', 'discover', 'download', 'explore', 'lens', 'lenses', 'map', 'privacy',
    'safety', 'scan', 'spotlight', 'stories', 'story', 'support', 'unlock', 'web',
  ]),
  linkedin: new Set([
    'authwall', 'checkpoint', 'company', 'events', 'feed', 'games', 'groups', 'help', 'jobs', 'learning', 'legal',
    'login', 'messaging', 'mynetwork', 'newsletters', 'notifications', 'posts', 'premium', 'products', 'pub',
    'pulse', 'sales', 'school', 'search', 'services', 'showcase', 'signup', 'talent', 'top-content', 'uas',
  ]),
};

function canonHandle(platform: string, raw: string): string | null {
  let h = raw.normalize('NFKC').trim().replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
  const reserved = RESERVED_ROUTES[platform];
  if (reserved?.has(h)) return null;
  if (platform === 'facebook') {
    if (/^\d{5,20}$/.test(h)) return `facebook:id:${h}`;
    if (h.endsWith('.php')) return null; // "home.php" would otherwise become "facebook:homephp"
    h = h.replace(/\./g, '');
    if (reserved?.has(h)) return null;
  }
  if ((platform === 'instagram' || platform === 'tiktok') && (/^\.|\.$/.test(h) || h.includes('..'))) return null;
  const rule = HANDLE_RULES[platform];
  if (!rule || !rule.test(h)) return null;
  return `${platform}:${h}`;
}

// ───────────── profile URLs ─────────────

type Platform = 'instagram' | 'facebook' | 'x' | 'tiktok' | 'snapchat' | 'linkedin';

/** The only hosts we parse. Subdomains are accepted only if every label is a known "same site" prefix. */
const PROFILE_HOSTS: Record<string, Platform> = {
  'instagram.com': 'instagram',
  'instagr.am': 'instagram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'twitter.com': 'x',
  'x.com': 'x',
  'tiktok.com': 'tiktok',
  'snapchat.com': 'snapchat',
  'linkedin.com': 'linkedin',
};
/** Redirectors we cannot resolve offline (they hide which account they point at). */
const SHORT_LINK_HOSTS = new Set(['fb.me', 'm.me', 'fb.watch', 'ig.me', 'lnkd.in', 't.co', 'vm.tiktok.com', 'vt.tiktok.com']);
/** Mobile / web-client prefixes that serve the same profile pages. */
const SAME_SITE_PREFIXES = new Set(['www', 'm', 'mobile', 'mbasic', 'web', 'touch']);
/** Language / country subdomains (de-de.facebook.com, uk.linkedin.com, in.linkedin.com). */
const LOCALE_PREFIX: Partial<Record<Platform, RegExp>> = {
  facebook: /^[a-z]{2}-[a-z]{2}$/,
  linkedin: /^[a-z]{2}(?:-[a-z]{2})?$/,
};

const KNOWN_DOMAINS = [...Object.keys(PROFILE_HOSTS), ...SHORT_LINK_HOSTS];
const BARE_DOMAIN_RE = new RegExp(
  `^(?:[a-z0-9-]+\\.)*(?:${KNOWN_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')})\\.?(?::\\d+)?(?:[/?#]|$)`,
  'i',
);

export type ProfileUrlResult =
  | { ok: true; canonical: string; platform: Platform }
  /** `not_a_url`: the value isn't a link at all (try it as a handle); `unrecognized`: a link to an unsupported site. */
  | { ok: false; reason: 'not_a_url' | 'unrecognized' | 'not_a_profile' | 'short_link' };

const NOT_A_PROFILE = { ok: false, reason: 'not_a_profile' } as const;

function resolveHost(hostname: string): { platform: Platform } | { reason: 'unrecognized' | 'not_a_profile' | 'short_link' } {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (SHORT_LINK_HOSTS.has(h) || SHORT_LINK_HOSTS.has(h.replace(/^www\./, ''))) return { reason: 'short_link' };
  for (const [base, platform] of Object.entries(PROFILE_HOSTS)) {
    if (h !== base && !h.endsWith(`.${base}`)) continue;
    const labels = h === base ? [] : h.slice(0, -(base.length + 1)).split('.');
    const sameSite = labels.every((l) => SAME_SITE_PREFIXES.has(l) || LOCALE_PREFIX[platform]?.test(l));
    // l.facebook.com (link shim), business., developers., help., story.snapchat.com, … are not profile hosts.
    return sameSite ? { platform } : { reason: 'not_a_profile' };
  }
  return { reason: 'unrecognized' };
}

const isNumericId = (s: string | undefined): s is string => !!s && /^\d{5,20}$/.test(s);

/** Allowed Instagram subpages after /<handle> (all still about that one account). */
const IG_PROFILE_SUBPATHS = new Set(['tagged', 'reels', 'guides', 'igtv', 'channel', 'followers', 'following', 'feed', 'saved', 'p', 'reel', 'tv']);

function instagramPath(segs: string[]): string | null {
  const [s0, s1, s2] = segs.map((s) => s.toLowerCase());
  if (!s0) return null;
  if (s0 === '_u') return segs.length === 2 ? canonHandle('instagram', s1!) : null; // instagram.com/_u/<handle>
  if (s0 === 'stories') {
    // /stories/<handle>/<story id>; /stories/highlights/<id> is a highlight reel, not a person.
    if (!s1 || segs.length > 3 || (s2 !== undefined && !/^\d+$/.test(s2))) return null;
    return canonHandle('instagram', s1);
  }
  if (RESERVED_ROUTES.instagram!.has(s0)) return null;
  if (s1 !== undefined && !IG_PROFILE_SUBPATHS.has(s1)) return null;
  return canonHandle('instagram', s0);
}

function facebookPath(segs: string[], params: URLSearchParams): string | null {
  const [s0, s1, s2] = segs.map((s) => s.toLowerCase());
  if (!s0) return null;
  if (s0 === 'profile.php') {
    const id = params.get('id') ?? undefined;
    return segs.length === 1 && isNumericId(id) ? `facebook:id:${id}` : null;
  }
  if (s0 === 'people') return segs.length === 3 && isNumericId(s2) ? `facebook:id:${s2}` : null; // /people/<Name>/<id>
  if (s0 === 'messages') {
    // /messages/t/<numeric id | username> is a conversation with exactly that account.
    if (s1 !== 't' || segs.length !== 3 || !s2) return null;
    return isNumericId(s2) ? `facebook:id:${s2}` : canonHandle('facebook', s2);
  }
  if (s0.endsWith('.php') || RESERVED_ROUTES.facebook!.has(s0)) return null;
  return canonHandle('facebook', s0); // later segments (/posts/…, /photos, /about) still belong to this account
}

function xPath(segs: string[], params: URLSearchParams): string | null {
  const [s0, s1] = segs.map((s) => s.toLowerCase());
  if (!s0) return null;
  if (s0 === 'intent' && (s1 === 'user' || s1 === 'follow') && segs.length === 2) {
    const name = params.get('screen_name');
    return name ? canonHandle('x', name) : null;
  }
  if (RESERVED_ROUTES.x!.has(s0)) return null;
  return canonHandle('x', s0); // /status/<id>, /with_replies, /media … still belong to this account
}

function tiktokPath(segs: string[]): string | null {
  const s0 = segs[0];
  return s0?.startsWith('@') ? canonHandle('tiktok', s0.slice(1)) : null; // /@<handle>(/video/<id>)
}

function snapchatPath(segs: string[]): string | null {
  const [s0, s1] = segs.map((s) => s.toLowerCase());
  if (s0 === 'add' && s1 && segs.length === 2) return canonHandle('snapchat', s1);
  if (s0?.startsWith('@') && segs.length === 1) return canonHandle('snapchat', s0.slice(1));
  return null;
}

function linkedinPath(segs: string[]): string | null {
  const [s0, s1] = segs;
  return s0?.toLowerCase() === 'in' && s1 ? canonHandle('linkedin', s1) : null; // /in/<handle> only (not /pub)
}

/**
 * Parse a link to a profile on a supported app. Returns the canonical handle, or why it can't be used:
 * `not_a_url` (plain text — try it as a handle), `unrecognized` (another site, or a malformed link),
 * `not_a_profile` (a supported app, but not one person's profile), `short_link` (a redirector).
 */
export function parseProfileUrl(value: string): ProfileUrlResult {
  const s = value.normalize('NFKC').trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!hasScheme && !BARE_DOMAIN_RE.test(s)) return { ok: false, reason: 'not_a_url' };
  let url: URL;
  try {
    url = new URL(hasScheme ? s : `https://${s}`);
  } catch {
    return { ok: false, reason: 'unrecognized' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'unrecognized' };
  if (url.username || url.password || url.port) return { ok: false, reason: 'unrecognized' };
  const host = resolveHost(url.hostname);
  if ('reason' in host) return { ok: false, reason: host.reason };
  let segs: string[];
  try {
    segs = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    return { ok: false, reason: 'unrecognized' };
  }
  const first = segs[0]?.toLowerCase();
  if ((host.platform === 'tiktok' || host.platform === 'snapchat') && first === 't') return { ok: false, reason: 'short_link' };
  const p = url.searchParams;
  const canonical =
    host.platform === 'instagram' ? instagramPath(segs)
    : host.platform === 'facebook' ? facebookPath(segs, p)
    : host.platform === 'x' ? xPath(segs, p)
    : host.platform === 'tiktok' ? tiktokPath(segs)
    : host.platform === 'snapchat' ? snapchatPath(segs)
    : linkedinPath(segs);
  return canonical ? { ok: true, canonical, platform: host.platform } : NOT_A_PROFILE;
}

/** Profile URL → canonical "platform:handle", or null if it isn't a single person's profile (see parseProfileUrl). */
export function canonicalFromProfileUrl(value: string): string | null {
  const r = parseProfileUrl(value);
  return r.ok ? r.canonical : null;
}

// ───────────── phones ─────────────

/** NANP: area code and exchange both start with 2-9. */
const NANP_RE = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * E.164 ("+12015550100") or null. Accepts exactly one number made of digits and the usual separators, optionally
 * with an extension ("ext 12", "x12" — dropped). International: "+", "00" or "011" prefix, 8–15 digits, a "(0)"
 * trunk digit after the country code is dropped. Without a prefix only valid US/Canada (NANP) numbers are accepted.
 */
export function toE164(value: string): string | null {
  let s = value.normalize('NFKC').trim().toLowerCase().replace(/[‐-―−]/g, '-');
  s = s.replace(/\s*(?:ext\.?|extension|x)\s*\d{1,6}$/, ''); // trailing extension; a bare "x" is not one
  if (!/^\+?[\d\s().-]+$/.test(s)) return null; // letters, commas, a second "+", … → not one plain number
  let digits = s.replace(/\D/g, '');
  const intlPrefix = s.startsWith('+') ? '' : digits.startsWith('00') ? '00' : digits.startsWith('011') ? '011' : null;
  // "(0)" is a domestic trunk digit written after a country code: "+44 (0) 20 7946 0958" → +44 20 7946 0958.
  if (intlPrefix !== null) digits = s.replace(/\(\s*0\s*\)/, '').replace(/\D/g, '').slice(intlPrefix.length);

  let e164: string;
  if (intlPrefix !== null) {
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith('1') && !(digits.length === 11 && NANP_RE.test(digits.slice(1)))) return null;
    e164 = digits;
  } else if (digits.length === 10 && NANP_RE.test(digits)) e164 = `1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1') && NANP_RE.test(digits.slice(1))) e164 = digits;
  else return null;
  if (/(\d)\1{6}$/.test(e164)) return null; // placeholder tails like 000-0000
  return `+${e164}`;
}

// ───────────── emails ─────────────

/** Providers where "user+tag@" is delivered to "user@" (so the tag must be dropped to match). */
const PLUS_ADDRESSING = new Set([
  'gmail.com',
  'outlook.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.es', 'outlook.it', 'outlook.jp', 'outlook.com.au',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it', 'live.com', 'live.co.uk',
  'live.fr', 'live.ca', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'fastmail.com', 'fastmail.fm',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
]);
const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Canonical "local@domain" or null. ASCII local parts only; IDN domains become punycode. */
export function canonicalEmail(value: string): string | null {
  const v = value.normalize('NFKC').trim().replace(/^mailto:/i, '').toLowerCase();
  const at = v.lastIndexOf('@');
  if (at <= 0 || /\s/.test(v)) return null;
  let local = v.slice(0, at);
  let domain = v.slice(at + 1).replace(/\.$/, '');
  if (!LOCAL_RE.test(local) || !domain || /[/?#:@\\[\]%]/.test(domain)) return null; // quoted / non-ASCII / 2nd "@"
  try {
    domain = new URL(`http://${domain}`).hostname; // WHATWG URL applies IDNA ToASCII (bücher.de → xn--bcher-kva.de)
  } catch {
    return null;
  }
  if (!HOST_RE.test(domain) || domain.length > 253) return null;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (PLUS_ADDRESSING.has(domain)) local = local.split('+')[0]!;
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local || /^\.|\.$|\.\./.test(local)) return null;
  return `${local}@${domain}`;
}

// ───────────── entry point ─────────────

/**
 * Canonicalise an identifier so that two survivors typing the same person in different forms produce the same
 * OPRF input. Full names (`name_not_unique`) and free text (`other` → `not_supported`) are always refused.
 */
export function normalizeMatchIdentifier(kind: IdentifierKind, value: string, platform?: string): NormalizedIdentifier {
  const v = (value ?? '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  if (kind === 'full_name') return { ok: false, reason: 'name_not_unique' };
  if (kind === 'other') return { ok: false, reason: 'not_supported' };
  const fail = (reason: MatchRejectReason): NormalizedIdentifier => ({ ok: false, reason });

  if (kind === 'email') {
    const e = canonicalEmail(v);
    return e ? { ok: true, kind: 'email', canonical: `email:${e}` } : fail('unrecognized');
  }
  const phone = (): NormalizedIdentifier => {
    const p = toE164(v);
    return p ? { ok: true, kind: 'phone', canonical: `phone:${p}` } : fail('unrecognized');
  };
  if (kind === 'phone') return phone();
  if (kind !== 'social_handle') return fail('unrecognized');

  const url = parseProfileUrl(v);
  if (url.ok) return { ok: true, kind: 'social', canonical: url.canonical, platform: url.platform };
  if (url.reason !== 'not_a_url') return fail(url.reason);
  const plat = PLATFORM_ALIASES[(platform ?? '').trim().toLowerCase()];
  if (plat === 'whatsapp') return phone();
  if (!plat || /[/:]/.test(v)) return fail('unrecognized');
  const c = canonHandle(plat, v);
  return c ? { ok: true, kind: 'social', canonical: c, platform: plat } : fail('unrecognized');
}
