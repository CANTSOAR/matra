import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@matra/shared';
import { describeAudit, formatRange, groupActivity } from './Dashboard';

let n = 0;
const ev = (action: string, at: string, detail?: string): AuditEvent => ({ id: `e${++n}`, userId: 'u', action, at, detail });

describe('groupActivity', () => {
  const kinds = new Map([
    [1, 'draft' as const],
    [2, 'draft' as const],
    [3, 'draft' as const],
    [4, 'final' as const],
  ]);
  const label = (e: AuditEvent) => describeAudit(e, kinds);

  it('folds consecutive identical lines into one with a count and time range', () => {
    const newestFirst = [
      ev('record.created', '2026-10-07T02:40:00Z', 'ledger #4'),
      ev('record.created', '2026-10-07T02:31:00Z', 'ledger #3'),
      ev('record.created', '2026-10-07T02:20:00Z', 'ledger #2'),
      ev('record.created', '2026-10-07T02:04:00Z', 'ledger #1'),
      ev('auth.login', '2026-10-07T02:00:00Z'),
    ];
    const lines = groupActivity(newestFirst, label);
    expect(lines.map((l) => [l.label, l.count])).toEqual([
      ['You sealed your account', 1],
      ['You saved a draft', 3],
      ['Signed in', 1],
    ]);
    expect(lines[1].newest).toBe('2026-10-07T02:31:00Z');
    expect(lines[1].oldest).toBe('2026-10-07T02:04:00Z');
  });

  it('does not merge identical lines that are not next to each other', () => {
    const lines = groupActivity(
      [ev('auth.login', '2026-10-07T03:00:00Z'), ev('auth.logout', '2026-10-07T02:00:00Z'), ev('auth.login', '2026-10-07T01:00:00Z')],
      label,
    );
    expect(lines.map((l) => l.count)).toEqual([1, 1, 1]);
  });

  it('never groups attorney access: every open is its own line', () => {
    const lines = groupActivity(
      [
        ev('attorney.opened_share', '2026-10-07T03:00:00Z'),
        ev('attorney.opened_share', '2026-10-07T02:00:00Z'),
        ev('attorney.downloaded_evidence', '2026-10-07T01:30:00Z'),
        ev('attorney.downloaded_evidence', '2026-10-07T01:00:00Z'),
      ],
      label,
    );
    expect(lines.map((l) => [l.label, l.count])).toEqual([
      ['Attorney opened your file', 1],
      ['Attorney opened your file', 1],
      ['Attorney downloaded an evidence file', 1],
      ['Attorney downloaded an evidence file', 1],
    ]);
  });
});

describe('formatRange', () => {
  it('shows one date and a time range for a run within a day', () => {
    const s = formatRange('2026-10-07T14:04:00', '2026-10-07T14:31:00');
    expect(s).toMatch(/2:04/);
    expect(s).toMatch(/2:31/);
    expect(s.match(/2026/g)).toHaveLength(1);
  });
});
