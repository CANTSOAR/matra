/**
 * Session: token, user, masterKey and privateKey live ONLY in React memory.
 * Nothing here ever touches localStorage, sessionStorage, IndexedDB or cookies.
 * Closing the tab, quick exit, logout, or 15 minutes of inactivity forgets everything.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_KDF_ITERATIONS,
  decryptJSON,
  deriveKeys,
  encryptJSON,
  generateContentKey,
  generateIdentity,
  newKdfSalt,
  unwrapKeyWithMaster,
  unwrapPrivateKey,
  wrapKeyWithMaster,
} from '@matra/crypto';
import type { AttorneyProfile, Envelope, EvidenceItem, PublicUser, RegisterRequest, Role, WrappedKey } from '@matra/shared';
import { ApiClient, ApiError } from '../api/client';
import type { IntakeDraft } from '../integration/intakeAdapter';
import { onWipe, wipeAll } from './wipe';

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
  /** id of the vault draft record this was loaded from / last saved as (for `supersedes`) */
  savedDraftRecordId?: string;
}

export type Progress = 'deriving' | 'generating' | 'contacting' | 'unlocking';

export interface RegisterInput {
  username: string;
  passphrase: string;
  role: Role;
  attorneyProfile?: RegisterRequest['attorneyProfile'];
  /** Survivors must confirm "I am 18 or older"; the server rejects registration otherwise. */
  ageConfirmed18?: boolean;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

interface SessionCtx {
  session: Session | null;
  api: ApiClient;
  lockReason: 'idle' | null;
  register(input: RegisterInput, onProgress?: (p: Progress) => void): Promise<Session>;
  login(username: string, passphrase: string, onProgress?: (p: Progress) => void): Promise<Session>;
  logout(): Promise<void>;
  lock(reason?: 'idle'): void;
  refreshProfile(): Promise<void>;
  getWorkingData(): Promise<WorkingData | null>;
  setWorkingData(d: WorkingData | null): Promise<void>;
  /** bumps whenever working data changes */
  workingVersion: number;
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
  const [lockReason, setLockReason] = useState<'idle' | null>(null);
  const tokenRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // working draft: encrypted under a per-draft key, which is itself wrapped under masterKey
  const workingRef = useRef<{ envelope: Envelope; wrappedKey: WrappedKey } | null>(null);
  const [workingVersion, setWorkingVersion] = useState(0);

  const api = useMemo(() => new ApiClient({ getToken: () => tokenRef.current, fetchImpl }), [fetchImpl]);

  const clear = useCallback(() => {
    tokenRef.current = null;
    sessionRef.current = null;
    workingRef.current = null;
    setSession(null);
    setWorkingVersion((v) => v + 1);
  }, []);

  useEffect(() => onWipe(clear), [clear]);

  const adopt = useCallback((s: Session) => {
    tokenRef.current = s.token;
    sessionRef.current = s;
    workingRef.current = null;
    setLockReason(null);
    setSession(s);
  }, []);

  const register = useCallback<SessionCtx['register']>(
    async ({ username, passphrase, role, attorneyProfile, ageConfirmed18 }, onProgress) => {
      if (role === 'survivor' && !ageConfirmed18) throw new SessionError('Please confirm you are 18 or older.');
      const kdfSalt = newKdfSalt();
      onProgress?.('deriving');
      const { authKey, masterKey } = await deriveKeys(passphrase, kdfSalt, DEFAULT_KDF_ITERATIONS);
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
    [api, adopt, fetchImpl],
  );

  const login = useCallback<SessionCtx['login']>(
    async (username, passphrase, onProgress) => {
      const name = username.trim();
      onProgress?.('contacting');
      const pre = await api.prelogin(name);
      onProgress?.('deriving');
      const { authKey, masterKey } = await deriveKeys(passphrase, pre.kdfSalt, pre.kdfIterations);
      onProgress?.('contacting');
      let res;
      try {
        res = await api.login({ username: name, authKey });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
          throw new SessionError('That alias and passphrase don’t match. Check for typos and try again.');
        }
        throw e;
      }
      onProgress?.('unlocking');
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
      return s;
    },
    [api, adopt, fetchImpl],
  );

  const logout = useCallback(async () => {
    try {
      if (tokenRef.current) await api.logout();
    } catch {
      /* we forget locally regardless */
    }
    wipeAll();
  }, [api]);

  const lock = useCallback((reason?: 'idle') => {
    setLockReason(reason ?? null);
    wipeAll();
  }, []);

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
    }),
    [session, api, lockReason, register, login, logout, lock, refreshProfile, getWorkingData, setWorkingData, workingVersion],
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
  if (e instanceof SessionError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 409) return 'That alias is already taken. Try another one.';
    return e.message;
  }
  return 'Something went wrong. Nothing was shared. Please try again.';
}
