/**
 * The "what the server sees" inspector (dev / demo only; docs/design/WEEKEND_MVP.md §4.3, docs/demo/TECH_RUNTHROUGH.md).
 *
 * Each service (app server, every OPRF key holder, the matcher) can describe what it holds, as an InspectorProcess:
 * tables from its own database (latest rows, long values cut to 48 characters) and what it keeps in memory. The app
 * server adds the last requests it received (route pattern and a summary of the body, never headers or IPs) and
 * gathers the holders' and the matcher's descriptions into one InspectorSnapshot for the web page (apps/web/src/dev).
 *
 * It is a demonstration tool. It is mounted only with MATRA_INSPECTOR=1, and never in production unless the process is
 * also a fictional-data demo (MATRA_DEMO_MODE=1): it is unauthenticated, and it shows every account's ciphertext and
 * metadata to whoever can reach it.
 */

export type InspectorValue = string | number | boolean | null | InspectorValue[] | { [key: string]: InspectorValue };

export interface InspectorTable {
  /** table name, or a label for something held in memory ("rate limits (memory)") */
  name: string;
  /** one plain sentence: what this is and what it is not */
  caption: string;
  /** rows in the table (rows shows at most the latest 20) */
  total: number;
  rows: Array<Record<string, InspectorValue>>;
}

export interface InspectorRequest {
  at: string;
  method: string;
  /** the route pattern (e.g. /api/vault/records/:id), never the URL */
  route: string;
  status: number;
  /** field names with truncated values; secrets the server never stores are shown as "[redacted: …]" */
  body?: InspectorValue;
}

export interface InspectorProcess {
  /** "App server", "Key holder 2", "Matcher" */
  name: string;
  role: 'app' | 'holder' | 'matcher';
  /** what this process is, in one sentence */
  note: string;
  /** set when the process could not be reached (a stopped holder shows here) */
  error?: string;
  requests?: InspectorRequest[];
  tables: InspectorTable[];
}

export interface InspectorSnapshot {
  at: string;
  demoMode: boolean;
  processes: InspectorProcess[];
  /**
   * With ?find=<text>: every place the app server's database holds that text (case-insensitive), searched in FULL
   * values of every column of every table, not the cut values shown above. Empty = nowhere.
   */
  found?: Array<{ table: string; column: string; rows: number }>;
}

/**
 * MATRA_INSPECTOR=1 turns the inspector on, outside production or in a fictional-data demo (MATRA_DEMO_MODE=1). The
 * same rule for every service, so a production process never exposes it by accident.
 */
export function inspectorEnabled(env: Record<string, string | undefined>): boolean {
  return env.MATRA_INSPECTOR === '1' && (env.NODE_ENV !== 'production' || env.MATRA_DEMO_MODE === '1');
}

/** Field names whose values are never shown, with the reason the inspector prints instead. */
export const INSPECTOR_REDACTED: Readonly<Record<string, string>> = {
  authKey: 'never stored: the server keeps only a salted hash of this key (derived on her device; it is not her passphrase)',
  recoveryAuthKey: 'never stored: the server keeps only a salted hash of this key (derived from her recovery code on her device)',
  passphrase: 'never sent: her passphrase never leaves her device',
  phone: 'never stored: the number is checked with the SMS provider, then only a keyed hash (phone token) and a count are kept',
  code: 'never stored: the SMS code is passed to the SMS provider to check, then dropped',
  resetToken: 'a single-use bearer token for a passphrase reset, held in memory for 10 minutes: not shown',
};

const MAX_TEXT = 48;
const MAX_ITEMS = 6;

/**
 * A value as the inspector shows it: strings cut to 48 characters (with their length), bytes as their first 16 bytes
 * in hex, arrays to 6 items, nesting to 4 levels, and every field named in INSPECTOR_REDACTED replaced by its reason.
 */
export function inspectValue(v: unknown, depth = 0): InspectorValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}… (${v.length} chars)` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) {
    const hex = Array.from(v.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return `bytes ${hex}${v.length > 16 ? '…' : ''} (${v.length} bytes)`;
  }
  if (depth >= 4) return '[…]';
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ITEMS).map((x) => inspectValue(x, depth + 1));
    if (v.length > MAX_ITEMS) items.push(`… (+${v.length - MAX_ITEMS} more)`);
    return items;
  }
  if (typeof v === 'object') {
    const out: Record<string, InspectorValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k in INSPECTOR_REDACTED && x !== undefined && x !== null ? `[redacted: ${INSPECTOR_REDACTED[k]}]` : inspectValue(x, depth + 1);
    }
    return out;
  }
  return String(v);
}
