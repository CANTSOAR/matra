/**
 * `npm run -w @matra/matcher measure`: print the matcher build's measurement (pin it as MATRA_MATCHER_MEASUREMENT).
 * `… measure -- --platform-pubkey`: print the SIMULATED platform's public key (MATRA_ATTESTATION_PLATFORM_PUBKEY) for
 * the key in MATRA_ATTESTATION_PLATFORM_KEY / _FILE (single-operator demos and e2e only).
 */
import fs from 'node:fs';
import { platformPublicKey } from '@matra/crypto';
import { computeMeasurement } from './measure.js';

if (process.argv.includes('--platform-pubkey')) {
  const raw = (process.env.MATRA_ATTESTATION_PLATFORM_KEY ?? (process.env.MATRA_ATTESTATION_PLATFORM_KEY_FILE ? fs.readFileSync(process.env.MATRA_ATTESTATION_PLATFORM_KEY_FILE, 'utf8') : '')).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    console.error('Set MATRA_ATTESTATION_PLATFORM_KEY (64 hex) or MATRA_ATTESTATION_PLATFORM_KEY_FILE.');
    process.exit(1);
  }
  console.log(platformPublicKey(Uint8Array.from(raw.toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)))));
} else {
  console.log(computeMeasurement());
}
