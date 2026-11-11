/**
 * The "On her device" column of the Server view (dev/Inspector.tsx): in development and demo builds only, the app tells
 * an open Server view tab what was typed, at the moment it is encrypted, blinded or hashed, so a viewer can put it next to
 * what each server received. It goes over a BroadcastChannel: same origin, same browser, in memory, to other open tabs
 * only. Nothing is stored and nothing is sent anywhere; with no Server view open, the message reaches nobody.
 *
 * Production builds that are not demos leave all of this out (INSPECTOR_AVAILABLE is a build-time false).
 */
import { DEMO_BUILD } from '../matchPins';

export const INSPECTOR_AVAILABLE: boolean = import.meta.env.DEV || DEMO_BUILD;
export const INSPECTOR_CHANNEL = 'matra-inspector';

export interface DeviceEvent {
  at: string;
  /** what this is ("Her story (sealed)") */
  what: string;
  /** what she typed or chose, as her device has it */
  typed: string;
  /** what left this device instead */
  sent: string;
}

let channel: BroadcastChannel | null | undefined;

export function mirror(what: string, typed: string, sent: string): void {
  if (!INSPECTOR_AVAILABLE) return;
  try {
    if (channel === undefined) {
      channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INSPECTOR_CHANNEL);
      (channel as unknown as { unref?: () => void } | null)?.unref?.(); // Node (unit tests): never keep the process alive
    }
    channel?.postMessage({ at: new Date().toISOString(), what, typed: typed.slice(0, 600), sent } satisfies DeviceEvent);
  } catch {
    /* best effort: a demo aid, never part of the app's behaviour */
  }
}

/** The text she gave, from a vault payload: its string values, in order, joined. */
export function typedText(value: unknown, out: string[] = []): string {
  if (typeof value === 'string') {
    const v = value.trim();
    if (v.length > 1 && !/^\d{4}-\d\d-\d\dT/.test(v) && !/^[0-9a-f]{32,}$/i.test(v)) out.push(v);
  } else if (Array.isArray(value)) value.forEach((v) => typedText(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => typedText(v, out));
  return [...new Set(out)].join(' · ');
}
