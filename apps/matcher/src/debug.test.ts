/**
 * The matcher's dev/demo inspector view (src/debug.ts): absent unless the process turned it on, behind the app-server
 * token when present, and showing the states it opened (the only plaintext it holds about anyone) and its attestation.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { matcherKeysFromSeed, sealRouting } from '@matra/crypto';
import type { InspectorProcess } from '@matra/shared';
import { createMatcher, createMatcherApp, matcherDebugState, SimulatedAttester } from './index.js';

const keys = matcherKeysFromSeed(new Uint8Array(32).fill(5));
const TOKEN = 't'.repeat(40);
const hex = (s: string) => createHash('sha256').update(s).digest('hex');

function setup(debug: boolean) {
  const { matcher, store } = createMatcher({ dbPath: ':memory:', keys, releaseDelayMs: 0 });
  const attester = new SimulatedAttester({ platformSecretKey: new Uint8Array(32).fill(9), measurement: 'ab'.repeat(32), keys });
  return { matcher, app: createMatcherApp({ matcher, attester, token: TOKEN, ...(debug && { debugState: () => matcherDebugState(store, attester) }) }) };
}

describe('matcher debug state (inspector)', () => {
  it('is not mounted unless the process turned the inspector on', async () => {
    const { app } = setup(false);
    expect((await request(app).get('/v1/debug/state').set('Authorization', `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it('needs the app-server token; shows entries with their opened states and a fresh simulated attestation', async () => {
    const { app, matcher } = setup(true);
    expect((await request(app).get('/v1/debug/state')).status).toBe(401);
    const tag = hex('tag');
    for (const who of ['a', 'b'])
      await matcher.upsertEntry({
        entryId: `e-${who}`,
        tag,
        survivorRef: hex(who),
        createdAt: new Date().toISOString(),
        accountCreatedAt: new Date().toISOString(),
        routing: await sealRouting({ v: 1, tag, incidentState: 'NY', survivorState: 'NJ' }, keys.encPublicJwk),
      });
    const res = await request(app).get('/v1/debug/state').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    const s = res.body as InspectorProcess;
    expect(s.role).toBe('matcher');
    const entries = s.tables.find((t) => t.name === 'matcher_entries')!;
    expect(entries.total).toBe(2);
    expect(entries.rows[0]).toMatchObject({ incident_state: 'NY', survivor_state: 'NJ' });
    expect(s.tables[0]!.caption).toMatch(/SIMULATED/);
    expect(JSON.stringify(s.tables[0]!.rows[0])).toContain('simulated');
  });
});
