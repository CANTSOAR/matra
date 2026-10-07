/** zod validators for every request the API accepts. Unknown keys are stripped. */
import { z } from 'zod';

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const base64 = (max: number) => z.string().min(1).max(max).regex(B64_RE, 'must be base64');

/** Decoded length of a base64 string (assumes it passed B64_RE). */
export function b64Len(s: string): number {
  return (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}

export const ID_RE = /^[a-f0-9]{32}$/;
export const id = z.string().regex(ID_RE, 'invalid id');

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, 'username must be 3-64 chars: a-z 0-9 . _ -');

export const envelope = z.object({
  v: z.literal(1),
  alg: z.literal('A256GCM'),
  iv: base64(64).refine((s) => b64Len(s) === 12, 'iv must be 12 bytes'),
  // JSON body limit is ~5 MB; ciphertext must include the 16-byte GCM tag
  ct: base64(7_000_000).refine((s) => b64Len(s) >= 16, 'ct too short'),
});

export const ownerWrappedKey = z.object({
  v: z.literal(1),
  alg: z.literal('A256GCM-KW'),
  iv: base64(64).refine((s) => b64Len(s) === 12, 'iv must be 12 bytes'),
  data: base64(256),
});

export const recipientWrappedKey = z.object({
  v: z.literal(1),
  alg: z.literal('RSA-OAEP-256'),
  data: base64(2048),
});

export const rsaPublicJwk = z
  .looseObject({
    kty: z.literal('RSA'),
    n: z.string().min(16).max(4096),
    e: z.string().min(1).max(16),
  })
  .refine((j) => !('d' in j) && !('p' in j) && !('q' in j), 'public key must not contain private components');

const usps = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'jurisdictions must be USPS codes');

export const attorneyProfileInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(200).optional(),
  barNumber: z.string().trim().max(64).optional(),
  jurisdictions: z.array(usps).min(1).max(60),
  practiceAreas: z.array(z.string().trim().min(1).max(100)).max(30),
  acceptsProBono: z.boolean(),
});

export const registerRequest = z
  .object({
    username,
    role: z.enum(['survivor', 'attorney']),
    authKey: base64(128).refine((s) => b64Len(s) >= 16 && b64Len(s) <= 64, 'authKey must be 16-64 bytes'),
    kdfSalt: base64(128).refine((s) => b64Len(s) >= 16, 'kdfSalt must be at least 16 bytes'),
    kdfIterations: z.number().int().min(1_000).max(10_000_000),
    publicKey: rsaPublicJwk,
    wrappedPrivateKey: envelope,
    attorneyProfile: attorneyProfileInput.optional(),
    /** Survivors must send `true` ("I am 18 or older"); attorneys may omit it. */
    ageConfirmed18: z.literal(true).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.role === 'survivor' && r.ageConfirmed18 !== true)
      ctx.addIssue({ code: 'custom', path: ['ageConfirmed18'], message: 'You must confirm you are 18 or older.' });
    if (r.role === 'attorney' && !r.attorneyProfile)
      ctx.addIssue({ code: 'custom', path: ['attorneyProfile'], message: 'attorneyProfile is required for attorneys' });
    if (r.role === 'survivor' && r.attorneyProfile)
      ctx.addIssue({ code: 'custom', path: ['attorneyProfile'], message: 'survivors cannot have an attorneyProfile' });
  });

export const loginRequest = z.object({
  username,
  authKey: base64(128),
});

export const preloginQuery = z.object({ username });

export const createRecordRequest = z.object({
  envelope,
  ownerWrappedKey,
  supersedes: id.optional(),
});

export const createShareRequest = z.object({
  recordId: id,
  attorneyId: id,
  recipientWrappedKey,
  attorneyKeyFingerprint: z.string().regex(/^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/),
  blobs: z
    .array(z.object({ blobId: id, recipientWrappedKey }))
    .max(500)
    .refine((b) => new Set(b.map((x) => x.blobId)).size === b.length, 'duplicate blobId'),
  consentStatement: z.string().trim().min(10).max(10_000),
  scope: z
    .array(z.enum(['record', 'evidence', 'brief']))
    .min(1)
    .max(3)
    .refine((s) => new Set(s).size === s.length, 'duplicate scope'),
  survivorAlias: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const renewShareRequest = z.object({ expiresInDays: z.number().int().min(1).max(365).optional() });

export const createEscrowRequest = z.object({
  identifierHash: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/, 'identifierHash must be 64 hex chars'),
  labelEnvelope: envelope,
});

export const attorneysQuery = z.object({
  state: usps.optional(),
});
