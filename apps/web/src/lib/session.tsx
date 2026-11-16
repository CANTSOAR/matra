/**
 * Session: token, user, masterKey and privateKey live ONLY in React memory.
 * Nothing here ever touches localStorage, sessionStorage, IndexedDB or cookies.
 * Closing the tab, quick exit, logout, or 15 minutes of inactivity forgets everything.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_KDF_ITERATIONS,
  RecoveryCodeError,
  decryptJSON,
  deriveKeys,
  derivePassphraseKeys,
  deriveRecoveryKeys,
  encryptJSON,
  generateContentKey,
  generateIdentity,
  generateRecoveryCode,
  importAccountSecret,
  legacyAccountSecret,
  newKdfSalt,
  parseRecoveryCode,
  passphraseMaterialFor,
  unlockAccount,
  unwrapAccountSecret,
  unwrapKeyWithMaster,
  unwrapPrivateKey,
  wrapAccountSecret,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { AttorneyProfile, AuthResponse, Envelope, EvidenceItem, PublicUser, RegisterRequest, Role, WrappedKey } from '@matra/shared';
import { ApiClient, ApiError } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { MatchingApiClient } from '../api/matching';
import { UnreadableVaultError, getProfile as loadProfileRecord, saveProfile as saveProfileRecord, type VaultProfile } from './vault';
import { onWipe, wipeAll } from './wipe';
import { mirror } from '../dev/mirror';
import { canChoosePassphrase, isGeneratedPassphrase, passphraseAccepted, passphraseWords } from './passphrase';

export const IDLE_LOCK_MS = 15 * 60 * 1000;

export interface Session {
  token: string;
  user: PublicUser;
  masterKey: CryptoKey;
  privateKey: CryptoKey;
  attorneyProfile?: AttorneyProfile;
}

/** In-progress intake work held (encrypted) in memory between screens. */
export interface WorkingData {
  draft: IntakeDraft | null;
  evidence: EvidenceItem[];
  /**
   * version of her draft slot this was loaded from / last saved as (a save must name it: lib/draftSlot.ts); null when
   * she had no slot, undefined when not known
   */
  slotVersion?: string | null;
}

export type Progress = 'deriving' | 'generating' | 'contacting' | 'unlocking';

export interface RegisterInput {
  username: string;
  passphrase: string;
  role: Role;
  attorneyProfile?: RegisterRequest['attorneyProfile'];
  /** Survivors must confirm "I am 18 or older"; the server rejects registration otherwise. */
  ageConfirmed18?: boolean;
  /**
   * Optional name she'd like to be called. Never sent to the server in plaintext: after the account exists it is
   * saved as an encrypted 'profile' vault record (best effort — registration succeeds even if that save fails).
   */
  preferredName?: string;
}

/**
 * A recovery code made on this device and shown to her, not yet sent. `commit()` sends only what the server stores
 * (a hash input and wrapped keys); the code itself and the account secret never leave this device, and the secret is
 * already wiped from memory by the time this exists. Until she commits, her old code (if any) keeps working.
 */
export interface PendingRecoveryCode {
  code: string;
  replacing: boolean;
  commit(): Promise<void>;
}

/**
 * A signed-out reset in progress: her alias and code were accepted, and her account secret is held in memory only
 * until `finish` (or `cancel`) wipes it. `finish` sets the new passphrase (the used code is burned on the server),
 * signs her in, and returns a NEW recovery code made on this device: it is saved only when she confirms she wrote it
 * down (`newCode.commit()`), so until then her account has no code rather than one nobody holds.
 */
export interface RecoveryReset {
  finish(newPassphrase: string, onProgress?: (p: Progress) => void): Promise<{ session: Session; newCode: PendingRecoveryCode }>;
  cancel(): void;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

const PASSPHRASE_CHANGED_TEXT =
  'Your passphrase was changed somewhere else just now, so nothing was changed here. Sign out and back in with the newest one.';

/**
 * A passphrase change got no clear answer (no connection, or a server error) and the server, asked again, couldn't
 * confirm it either way. The change may have been saved, so the new passphrase may already be the one that works.
 */
export class PassphraseMaybeChangedError extends SessionError {
  constructor() {
    super(
      'We couldn’t confirm the change. Your new passphrase may already be active. Try signing in with it; if it doesn’t ' +
        'work, your old passphrase still does. Keep both written down until you know which one works.',
    );
    this.name = 'PassphraseMaybeChangedError';
  }
}

const sameEnvelope = (a: Envelope | undefined, b: Envelope) => !!a && a.iv === b.iv && a.ct === b.ct;

/**
 * A reset whose earlier attempt failed in transit was then refused as spent: the server may have set her new
 * passphrase after all (her old code is burned either way), so she should try signing in with it.
 */
export class RecoveryMaybeFinishedError extends SessionError {
  constructor() {
    super(
      'Your earlier attempt may have gone through: your new passphrase could already be set. Try signing in with it. ' +
        'If it doesn’t work, sign in with your old passphrase, or use your recovery code again.',
    );
    this.name = 'RecoveryMaybeFinishedError';
  }
}

interface SessionCtx {
  session: Session | null;
  api: ApiClient;
  /** why she was signed out: 15 quiet minutes, or her session was ended elsewhere (or ran out) */
  lockReason: 'idle' | 'ended' | null;
  register(input: RegisterInput, onProgress?: (p: Progress) => void): Promise<Session>;
  login(username: string, passphrase: string, onProgress?: (p: Progress) => void): Promise<Session>;
  logout(): Promise<void>;
  lock(reason?: 'idle' | 'ended'): void;
  refreshProfile(): Promise<void>;
  getWorkingData(): Promise<WorkingData | null>;
  setWorkingData(d: WorkingData | null): Promise<void>;
  /** bumps whenever working data changes */
  workingVersion: number;
  /** Her decrypted preferences (survivors only), loaded on sign-in. null until loaded or if she has none. */
  profile: VaultProfile | null;
  /** Re-read the encrypted profile record from the vault. */
  getProfile(): Promise<VaultProfile | null>;
  /** Encrypt and save her preferences (e.g. `{ preferredName }`) as a profile vault record. */
  saveProfile(input: { preferredName?: string }): Promise<VaultProfile>;
  /** Signed in: check her passphrase on this device, then make a recovery code to show her (sent on commit). */
  prepareRecoveryCode(passphrase: string, onProgress?: (p: Progress) => void): Promise<PendingRecoveryCode>;
  /** Signed in: remove her recovery code (her passphrase keeps working). */
  turnOffRecovery(passphrase: string, onProgress?: (p: Progress) => void): Promise<void>;
  /** Signed out: alias + recovery code → a reset she finishes by choosing a new passphrase. */
  beginRecovery(username: string, code: string, onProgress?: (p: Progress) => void): Promise<RecoveryReset>;
  /**
   * Signed in: check her passphrase on this device, then ask the server to delete her account (it checks the
   * passphrase again). Does not sign her out here: the caller leaves the signed-in screens first, then locks.
   */
  deleteAccount(passphrase: string, onProgress?: (p: Progress) => void): Promise<void>;
  /**
   * Signed in: a new passphrase for the same account (its secret is re-wrapped on this device; nothing is
   * re-encrypted). Her recovery code keeps working, and every other session of hers is signed out.
   */
  changePassphrase(current: string, next: string, onProgress?: (p: Progress) => void): Promise<{ endedSessions: number | null }>;
  /** Signed in: sign out every other session of hers (her passphrase again, not only this session). */
  signOutOtherSessions(passphrase: string, onProgress?: (p: Progress) => void): Promise<{ endedSessions: number }>;
}

/** The most PBKDF2 rounds she will run (the server's own limit); more would only freeze her browser. */
const MAX_KDF_ITERATIONS = 10_000_000;

/**
 * The server tells her client how many PBKDF2 rounds to run on her passphrase (prelogin). A lower count would make the
 * auth key her client then sends, and the keys it unlocks, cheaper to guess offline, so a malicious or broken server
 * could weaken her passphrase. Refuse anything below DEFAULT_KDF_ITERATIONS before deriving or sending anything.
 */
export function checkKdfIterations(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < DEFAULT_KDF_ITERATIONS || n > MAX_KDF_ITERATIONS)
    throw new SessionError(
      'This app stopped before using your passphrase: the server asked for weaker protection than it should. Nothing was sent. Please try again later.',
    );
  return n;
}

/**
 * A new passphrase must look like one this device generated (attorneys and counselors: 7 words; the app gives them no box
 * for their own) or, for a survivor who chose her own, pass the meter. The forms enforce the same; this is the app's last
 * check before any key is derived from it (the server never sees a passphrase). `context`: her alias.
 */
export function checkNewPassphrase(role: Role, passphrase: string, context: readonly string[] = []): void {
  if (!canChoosePassphrase(role)) {
    if (!isGeneratedPassphrase(passphrase, passphraseWords(role)))
      throw new SessionError(`Attorney and counselor accounts use the ${passphraseWords(role)} words made on this device. Please use those.`);
  } else if (!passphraseAccepted(passphrase, context)) {
    throw new SessionError('That passphrase would be too easy to guess. Try six random words, like the one we made for you.');
  }
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({
  children,
  fetchImpl,
  idleMs = IDLE_LOCK_MS,
}: {
  children: ReactNode;
  fetchImpl?: typeof fetch;
  idleMs?: number;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [lockReason, setLockReason] = useState<'idle' | 'ended' | null>(null);
  // set below, once `lock` exists: the API client calls it when the server says this session is gone
  const sessionEndedRef = useRef<(token: string) => void>(() => undefined);
  // true while she is signing out or deleting her account on purpose: a request that fails because of it is not news
  const leavingRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // working draft: encrypted under a per-draft key, which is itself wrapped under masterKey
  const workingRef = useRef<{ envelope: Envelope; wrappedKey: WrappedKey } | null>(null);
  const [workingVersion, setWorkingVersion] = useState(0);
  const [profile, setProfile] = useState<VaultProfile | null>(null);
  const profileRecordRef = useRef<string | undefined>(undefined);

  // A build with sealed matching (MATRA_MATCHING=on) gets the client that can reach the matching routes; any other
  // build has no code for them at all (api/matching.ts is left out of its bundle).
  const api = useMemo(
    () =>
      __MATRA_MATCHING__
        ? new MatchingApiClient({ getToken: () => tokenRef.current, fetchImpl, onSessionEnded: (t) => sessionEndedRef.current(t) })
        : new ApiClient({ getToken: () => tokenRef.current, fetchImpl, onSessionEnded: (t) => sessionEndedRef.current(t) }),
    [fetchImpl],
  );

  const clear = useCallback(() => {
    tokenRef.current = null;
    sessionRef.current = null;
    workingRef.current = null;
    profileRecordRef.current = undefined;
    setProfile(null);
    setSession(null);
    setWorkingVersion((v) => v + 1);
  }, []);

  useEffect(() => onWipe(clear), [clear]);

  const adopt = useCallback((s: Session) => {
    if (sessionRef.current?.user.id !== s.user.id) {
      profileRecordRef.current = undefined;
      setProfile(null);
    }
    tokenRef.current = s.token;
    sessionRef.current = s;
    workingRef.current = null;
    leavingRef.current = false;
    setLockReason(null);
    setSession(s);
  }, []);

  const getProfile = useCallback(async (): Promise<VaultProfile | null> => {
    const s = sessionRef.current;
    if (!s || s.user.role !== 'survivor') return null;
    const found = await loadProfileRecord(api, s.masterKey);
    if (sessionRef.current !== s) return null; // locked meanwhile
    profileRecordRef.current = found?.recordId;
    setProfile(found?.profile ?? null);
    return found?.profile ?? null;
  }, [api]);

  const saveProfile = useCallback(
    async (input: { preferredName?: string }): Promise<VaultProfile> => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      const res = await saveProfileRecord(api, s.masterKey, input, profileRecordRef.current);
      if (sessionRef.current === s) {
        profileRecordRef.current = res.recordId;
        setProfile(res.profile);
      }
      return res.profile;
    },
    [api],
  );

  const register = useCallback<SessionCtx['register']>(
    async ({ username, passphrase, role, attorneyProfile, ageConfirmed18, preferredName }, onProgress) => {
      if (role === 'survivor' && !ageConfirmed18) throw new SessionError('Please confirm you are 18 or older.');
      checkNewPassphrase(role, passphrase, [username]);
      const kdfSalt = newKdfSalt();
      onProgress?.('deriving');
      const { authKey, masterKey } = await deriveKeys(passphrase, kdfSalt, DEFAULT_KDF_ITERATIONS);
      mirror(
        `Passphrase for "${username.trim()}"`,
        `${'•'.repeat(Math.min(passphrase.length, 24))} (${passphrase.length} characters, hidden here too)`,
        'Never sent. Her device derives keys from it (PBKDF2-SHA256, 600,000 rounds): one proves it to the server, which keeps only a salted hash of that; the other never leaves.',
      );
      onProgress?.('generating');
      const identity = await generateIdentity(masterKey);
      onProgress?.('contacting');
      const res = await api.register({
        username: username.trim(),
        role,
        authKey,
        kdfSalt,
        kdfIterations: DEFAULT_KDF_ITERATIONS,
        publicKey: identity.publicKey,
        wrappedPrivateKey: identity.wrappedPrivateKey,
        attorneyProfile,
        ...(role === 'survivor' && { ageConfirmed18: true as const }),
      });
      const s: Session = { token: res.token, user: res.user, masterKey, privateKey: identity.privateKey };
      adopt(s);
      if (role === 'survivor' && preferredName?.trim()) {
        try {
          await saveProfile({ preferredName });
        } catch {
          /* best effort: she can set it again from Home */
        }
      }
      if (role === 'attorney') {
        try {
          const me = await new ApiClient({ getToken: () => res.token, fetchImpl }).me();
          const withProfile = { ...s, attorneyProfile: me.attorneyProfile };
          adopt(withProfile);
          return withProfile;
        } catch {
          /* profile fetch is best-effort */
        }
      }
      return s;
    },
    [api, adopt, fetchImpl, saveProfile],
  );

  /** After the server accepted her: open her private key, adopt the session, and do the survivor's sign-in chores. */
  const enter = useCallback(
    async (res: AuthResponse, masterKey: CryptoKey): Promise<Session> => {
      let privateKey: CryptoKey;
      try {
        privateKey = await unwrapPrivateKey(res.user.wrappedPrivateKey, masterKey);
      } catch {
        throw new SessionError('Passphrase incorrect — your vault could not be opened.');
      }
      let attorneyProfile: AttorneyProfile | undefined;
      try {
        const me = await new ApiClient({ getToken: () => res.token, fetchImpl }).me();
        attorneyProfile = me.attorneyProfile;
      } catch {
        /* best effort */
      }
      const s: Session = { token: res.token, user: res.user, masterKey, privateKey, attorneyProfile };
      adopt(s);
      if (s.user.role === 'survivor') {
        try {
          await getProfile(); // so Home can greet her by name straight away
        } catch {
          /* best effort */
        }
        // Keep her sealed-match entries current (re-seal after a key rotation, seal to new counselors). In the
        // background and silent: it never reveals anything about matches, and a failure just retries next sign-in.
        // Only in a build with sealed matching: otherwise this code (and lib/matching.ts) is not in the bundle.
        if (__MATRA_MATCHING__)
          void import('./matching')
            .then((m) => m.refreshSealedMatches(new MatchingApiClient({ getToken: () => res.token, fetchImpl }), masterKey))
            .catch(() => undefined);
      }
      return s;
    },
    [adopt, fetchImpl, getProfile],
  );

  const login = useCallback<SessionCtx['login']>(
    async (username, passphrase, onProgress) => {
      const name = username.trim();
      onProgress?.('contacting');
      const pre = await api.prelogin(name);
      onProgress?.('deriving');
      const keys = await derivePassphraseKeys(passphrase, pre.kdfSalt, checkKdfIterations(pre.kdfIterations));
      onProgress?.('contacting');
      let res;
      try {
        res = await api.login({ username: name, authKey: keys.authKey });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
          throw new SessionError('That alias and passphrase don’t match. Check for typos and try again.');
        }
        throw e;
      }
      onProgress?.('unlocking');
      let masterKey: CryptoKey;
      try {
        // key version 2: her account secret, unwrapped with the passphrase key; version 1: derived as always
        ({ masterKey } = await unlockAccount(keys, res.user.keyVersion === 2 ? res.user.wrappedAccountKey : undefined));
      } catch {
        throw new SessionError('Passphrase incorrect — your vault could not be opened.');
      }
      return enter(res, masterKey);
    },
    [api, enter],
  );

  // ── recovery code (W20) ──

  /** Her account secret from her passphrase, checked on this device. The caller wipes it. */
  const accountSecretFromPassphrase = useCallback(
    async (s: Session, passphrase: string, wrongText = 'That passphrase isn’t right. Check for typos and try again.') => {
      // Her account as the server holds it now, never the copy cached at sign-in: after a passphrase change whose
      // answer got lost, the cached wrap belongs to the old passphrase while prelogin already gives the new salt.
      const { user } = await api.me();
      if (sessionRef.current?.user.id === user.id && sessionRef.current.token === s.token) {
        const updated = { ...sessionRef.current, user };
        sessionRef.current = updated;
        setSession(updated);
      }
      const pre = await api.prelogin(user.username);
      const keys = await derivePassphraseKeys(passphrase, pre.kdfSalt, checkKdfIterations(pre.kdfIterations));
      const wrong = () => new SessionError(wrongText);
      let as: Uint8Array;
      try {
        as = user.keyVersion === 2 && user.wrappedAccountKey
          ? await unwrapAccountSecret(user.wrappedAccountKey, keys.kek)
          : await legacyAccountSecret(keys.ikm);
      } catch {
        throw wrong();
      }
      try {
        // version 1 derives "something" from any passphrase: prove it is hers by opening her private key with it
        const { masterKey } = await importAccountSecret(as);
        await unwrapPrivateKey(user.wrappedPrivateKey, masterKey);
      } catch {
        as.fill(0);
        throw wrong();
      }
      return { as, keys, user };
    },
    [api],
  );

  const prepareRecoveryCode = useCallback<SessionCtx['prepareRecoveryCode']>(
    async (passphrase, onProgress) => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      onProgress?.('deriving');
      const { as, keys, user } = await accountSecretFromPassphrase(s, passphrase);
      let body;
      const { bytes, code } = generateRecoveryCode();
      try {
        const rk = await deriveRecoveryKeys(bytes);
        body = {
          authKey: keys.authKey,
          ...(user.keyVersion !== 2 && { wrappedAccountKey: await wrapAccountSecret(as, keys.kek) }),
          recoveryAuthKey: rk.authKey,
          recoveryWrappedKey: await wrapAccountSecret(as, rk.kek),
        };
      } finally {
        as.fill(0);
        bytes.fill(0);
      }
      return {
        code,
        replacing: s.user.hasRecoveryCode,
        commit: async () => {
          try {
            const { user } = await api.setUpRecovery(body);
            // the same session (its user copy may have been refreshed meanwhile), not a later sign-in
            const cur = sessionRef.current;
            if (cur && cur.token === s.token) {
              const next = { ...cur, user };
              sessionRef.current = next;
              setSession(next);
            }
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) throw new SessionError('That passphrase isn’t right. Nothing was changed.');
            if (e instanceof ApiError && e.code === 'passphrase_changed') throw new SessionError(PASSPHRASE_CHANGED_TEXT);
            throw e;
          }
        },
      };
    },
    [api, accountSecretFromPassphrase],
  );

  const turnOffRecovery = useCallback<SessionCtx['turnOffRecovery']>(
    async (passphrase, onProgress) => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      onProgress?.('deriving');
      const { as, keys } = await accountSecretFromPassphrase(s, passphrase);
      as.fill(0);
      onProgress?.('contacting');
      let user;
      try {
        ({ user } = await api.turnOffRecovery({ authKey: keys.authKey }));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'passphrase_changed') throw new SessionError(PASSPHRASE_CHANGED_TEXT);
        throw e;
      }
      const cur = sessionRef.current;
      if (cur && cur.token === s.token) {
        const next = { ...cur, user };
        sessionRef.current = next;
        setSession(next);
      }
    },
    [api, accountSecretFromPassphrase],
  );

  const deleteAccount = useCallback<SessionCtx['deleteAccount']>(
    async (passphrase, onProgress) => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      onProgress?.('deriving');
      // same words whether her device or the server finds the passphrase wrong
      const { as, keys } = await accountSecretFromPassphrase(s, passphrase, 'That passphrase isn’t right. Nothing was deleted.');
      as.fill(0);
      onProgress?.('contacting');
      leavingRef.current = true;
      try {
        await api.deleteAccount({ authKey: keys.authKey });
      } catch (e) {
        leavingRef.current = false;
        if (e instanceof ApiError && e.status === 401) throw new SessionError('That passphrase isn’t right. Nothing was deleted.');
        throw e;
      }
    },
    [api, accountSecretFromPassphrase],
  );

  const changePassphrase = useCallback<SessionCtx['changePassphrase']>(
    async (current, next, onProgress) => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      checkNewPassphrase(s.user.role, next, [s.user.username]);
      if (next.normalize('NFKC') === current.normalize('NFKC')) throw new SessionError('That’s the passphrase you have now. Please choose a new one.');
      onProgress?.('deriving');
      const { as, keys, user } = await accountSecretFromPassphrase(s, current, 'That passphrase isn’t right. Nothing was changed.');
      let body;
      try {
        const m = await passphraseMaterialFor(as, next, DEFAULT_KDF_ITERATIONS);
        // Before anything is sent: the new wrap must open, with the new passphrase, to keys that open her private key.
        const check = await unlockAccount(m.keys, m.wrappedAccountKey);
        await unwrapPrivateKey(user.wrappedPrivateKey, check.masterKey);
        body = { authKey: keys.authKey, newAuthKey: m.authKey, kdfSalt: m.kdfSalt, kdfIterations: m.kdfIterations, wrappedAccountKey: m.wrappedAccountKey };
      } finally {
        as.fill(0);
      }
      onProgress?.('contacting');
      let res;
      try {
        res = await api.changePassphrase(body);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'invalid_credentials') throw new SessionError('That passphrase isn’t right. Nothing was changed.');
        if (e instanceof ApiError && e.code === 'passphrase_changed') throw new SessionError(PASSPHRASE_CHANGED_TEXT);
        // A 4xx is a definite refusal. No answer, or a server error, may have come after the change was saved: ask
        // the server what it holds now, and only call it done if it holds exactly what this device sent.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
        let now: PublicUser | undefined;
        try {
          now = (await api.me()).user;
        } catch {
          /* can't tell */
        }
        if (!now || !sameEnvelope(now.wrappedAccountKey, body.wrappedAccountKey)) throw new PassphraseMaybeChangedError();
        res = { user: now, endedSessions: null };
      }
      const cur = sessionRef.current;
      if (cur && cur.token === s.token) {
        const updated = { ...cur, user: res.user };
        sessionRef.current = updated;
        setSession(updated);
      }
      return { endedSessions: res.endedSessions };
    },
    [api, accountSecretFromPassphrase],
  );

  const signOutOtherSessions = useCallback<SessionCtx['signOutOtherSessions']>(
    async (passphrase, onProgress) => {
      const s = sessionRef.current;
      if (!s) throw new SessionError('Your space is locked. Please sign in again.');
      onProgress?.('deriving');
      const { as, keys } = await accountSecretFromPassphrase(s, passphrase, 'That passphrase isn’t right. No one was signed out.');
      as.fill(0);
      onProgress?.('contacting');
      try {
        return await api.revokeOtherSessions({ authKey: keys.authKey });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'invalid_credentials') throw new SessionError('That passphrase isn’t right. No one was signed out.');
        throw e;
      }
    },
    [api, accountSecretFromPassphrase],
  );

  const beginRecovery = useCallback<SessionCtx['beginRecovery']>(
    async (username, code, onProgress) => {
      let codeBytes: Uint8Array;
      try {
        codeBytes = parseRecoveryCode(code);
      } catch (e) {
        throw new SessionError(e instanceof RecoveryCodeError ? e.message : 'That code doesn’t look right.');
      }
      const rk = await deriveRecoveryKeys(codeBytes);
      codeBytes.fill(0);
      onProgress?.('contacting');
      let start;
      try {
        start = await api.recoverStart({ username: username.trim(), recoveryAuthKey: rk.authKey });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          throw new SessionError('That alias and recovery code don’t match. Check both for typos and try again.');
        throw e;
      }
      let as: Uint8Array | null;
      try {
        as = await unwrapAccountSecret(start.recoveryWrappedKey, rk.kek);
      } catch {
        throw new SessionError('Your recovery code was accepted, but your space could not be opened with it.');
      }
      const wipe = () => {
        as?.fill(0);
        as = null;
      };
      // set once a finish request may have reached the server without an answer (network error, 5xx)
      let unanswered = false;
      return {
        cancel: wipe,
        finish: async (newPassphrase, progress) => {
          const secret = as;
          if (!secret) throw new SessionError('This reset has ended. Please enter your recovery code again.');
          checkNewPassphrase('survivor', newPassphrase, [username]);
          progress?.('deriving');
          const kdfSalt = newKdfSalt();
          const keys = await derivePassphraseKeys(newPassphrase, kdfSalt, DEFAULT_KDF_ITERATIONS);
          const next = generateRecoveryCode();
          const nrk = await deriveRecoveryKeys(next.bytes);
          next.bytes.fill(0);
          const body = {
            resetToken: start.resetToken,
            kdfSalt,
            kdfIterations: DEFAULT_KDF_ITERATIONS,
            authKey: keys.authKey,
            wrappedAccountKey: await wrapAccountSecret(secret, keys.kek),
          };
          // the new code's material, sent only on commit (after she confirms), re-authenticated by the new passphrase
          const codeBody = {
            authKey: keys.authKey,
            recoveryAuthKey: nrk.authKey,
            recoveryWrappedKey: await wrapAccountSecret(secret, nrk.kek),
          };
          const { masterKey } = await importAccountSecret(secret);
          progress?.('contacting');
          let res;
          try {
            res = await api.recoverFinish(body);
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
              wipe(); // the token is spent: she starts again with her code
              if (unanswered) throw new RecoveryMaybeFinishedError();
              throw new SessionError('This reset has expired. Please enter your recovery code again.');
            }
            // no answer, or a server error: it may have committed (a 4xx such as 429 is refused before the token is used)
            if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) unanswered = true;
            throw e;
          }
          wipe();
          progress?.('unlocking');
          const session = await enter(res, masterKey);
          const newCode: PendingRecoveryCode = {
            code: next.code,
            replacing: false,
            commit: async () => {
              const { user } = await api.setUpRecovery(codeBody);
              const s = sessionRef.current;
              if (s && s.user.id === user.id) {
                const updated = { ...s, user };
                sessionRef.current = updated;
                setSession(updated);
              }
            },
          };
          return { session, newCode };
        },
      };
    },
    [api, enter],
  );

  const logout = useCallback(async () => {
    leavingRef.current = true;
    try {
      if (tokenRef.current) await api.logout();
    } catch {
      /* we forget locally regardless */
    }
    wipeAll();
  }, [api]);

  const lock = useCallback((reason?: 'idle' | 'ended') => {
    setLockReason(reason ?? null);
    wipeAll();
  }, []);
  // Signed out elsewhere (her passphrase changed, "sign out everywhere else") or expired: forget everything here too,
  // rather than leave a page whose every request fails. Only for the session she still holds (not an old request's).
  sessionEndedRef.current = (token) => {
    if (token === tokenRef.current && !leavingRef.current) lock('ended');
  };

  const refreshProfile = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const me = await api.me();
    const next = { ...s, user: me.user, attorneyProfile: me.attorneyProfile };
    sessionRef.current = next;
    setSession(next);
  }, [api]);

  const getWorkingData = useCallback(async (): Promise<WorkingData | null> => {
    const s = sessionRef.current;
    const w = workingRef.current;
    if (!s || !w) return null;
    const key = await unwrapKeyWithMaster(w.wrappedKey, s.masterKey);
    return decryptJSON<WorkingData>(w.envelope, key);
  }, []);

  const setWorkingData = useCallback(async (d: WorkingData | null) => {
    const s = sessionRef.current;
    if (!s) return;
    if (!d) {
      workingRef.current = null;
    } else {
      const key = await generateContentKey();
      const [envelope, wrappedKey] = await Promise.all([encryptJSON(d, key), wrapKeyWithMaster(key, s.masterKey)]);
      if (sessionRef.current !== s) return; // locked meanwhile
      workingRef.current = { envelope, wrappedKey };
    }
    setWorkingVersion((v) => v + 1);
  }, []);

  // ── auto-lock after inactivity ──
  useEffect(() => {
    if (!session) return;
    let timer = window.setTimeout(() => lock('idle'), idleMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock('idle'), idleMs);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [session, idleMs, lock]);

  const value = useMemo<SessionCtx>(
    () => ({
      session,
      api,
      lockReason,
      register,
      login,
      logout,
      lock,
      refreshProfile,
      getWorkingData,
      setWorkingData,
      workingVersion,
      profile,
      getProfile,
      saveProfile,
      prepareRecoveryCode,
      turnOffRecovery,
      beginRecovery,
      deleteAccount,
      changePassphrase,
      signOutOtherSessions,
    }),
    [
      session,
      api,
      lockReason,
      register,
      login,
      logout,
      lock,
      refreshProfile,
      getWorkingData,
      setWorkingData,
      workingVersion,
      profile,
      getProfile,
      saveProfile,
      prepareRecoveryCode,
      turnOffRecovery,
      beginRecovery,
      deleteAccount,
      changePassphrase,
      signOutOtherSessions,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession must be used inside <SessionProvider>');
  return c;
}

/** For screens that require a signed-in session (guarded by <RequireSession>). */
export function useRequiredSession(): SessionCtx & { session: Session } {
  const c = useSession();
  if (!c.session) throw new Error('No session');
  return c as SessionCtx & { session: Session };
}

export function friendlyError(e: unknown): string {
  if (e instanceof SessionError || e instanceof UnreadableVaultError) return e.message;
  // errors written for her to read (lib/draftSlot.ts, lib/sealStory.ts)
  if (e instanceof Error && (e as { friendly?: boolean }).friendly) return e.message;
  if (e instanceof ApiError) {
    // 409 from register is the alias; other conflicts (e.g. phone_limit_reached) carry their own message
    if (e.status === 409 && (!e.code || e.code === 'username_taken')) return 'Someone already uses that alias. Please try another one.';
    return e.message;
  }
  return 'Something didn’t work. Nothing was shared. Please try again.';
}
