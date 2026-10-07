import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, WEB_CSP } from './app.js';
import { TEST_PEPPER } from './test-helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matra-web-'));
fs.mkdirSync(path.join(dir, 'assets'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Notes</title></head><body><div id="root"></div></body></html>');
fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('production web serving', () => {
  const app = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: dir });

  it('serves index.html with a strict CSP and no caching', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toBe(WEB_CSP);
    // WebAssembly may compile (on-device transcription), but no JS eval and no inline script.
    expect(WEB_CSP).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(WEB_CSP).toContain("worker-src 'self';");
    expect(WEB_CSP).toContain("connect-src 'self';");
    expect(WEB_CSP).toContain("frame-ancestors 'none'");
    expect(WEB_CSP.replace("'wasm-unsafe-eval'", '')).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(WEB_CSP).not.toMatch(/(script|worker|connect)-src[^;]*(blob:|data:|https?:)/);
    // The microphone is allowed for this origin only (voice capture); camera etc. stay off.
    expect(res.headers['permissions-policy']).toContain('microphone=(self)');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('matra-demo-banner');
  });

  it('serves hashed assets as immutable', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['content-security-policy']).toBe(WEB_CSP);
  });

  it('falls back to index.html for app routes, but 404s missing files and unknown API paths', async () => {
    expect((await request(app).get('/vault/story')).text).toContain('<div id="root">');
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
    const api = await request(app).get('/api/nope');
    expect(api.status).toBe(404);
    expect(api.body.code).toBe('not_found');
    expect(api.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
  });

  it('injects the demo banner flag when enabled', async () => {
    const demo = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER, webDir: dir, demoBanner: true });
    expect((await request(demo).get('/')).text).toContain('<meta name="matra-demo-banner" content="1" />');
  });

  it('does not serve the web app unless webDir is set', async () => {
    const api = createApp({ dbPath: ':memory:', pepper: TEST_PEPPER });
    expect((await request(api).get('/')).status).toBe(404);
  });
});
