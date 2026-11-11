/**
 * Attestation providers for the matcher (docs/threat-model.md W18). `attest(nonce)` returns a document that a verifier
 * (the survivor's client, the app server) checks with packages/crypto verifyAttestation against a PINNED platform key
 * and a PINNED measurement before sealing anything to `encKey`.
 *
 *   simulated            a dev Ed25519 "platform" key (MATRA_ATTESTATION_PLATFORM_KEY) signs { measurement, keys,
 *                        nonce, time }. It shows the protocol end to end. It is NOT attestation: whoever holds that key
 *                        (here, whoever runs the matcher) can sign any measurement. Production refuses it unless
 *                        MATRA_DEMO_MODE=1.
 *   nitro                AWS Nitro Enclaves (NSM attestation document, COSE_Sign1 over PCRs). Not implemented.
 *   confidential-space   GCP Confidential Space (attestation OIDC token over the image digest). Not implemented.
 */
import { signAttestation, type MatcherKeys } from '@matra/crypto';
import type { AttestationDocument } from '@matra/shared';

export interface AttestationProvider {
  readonly platform: 'simulated' | 'nitro' | 'confidential-space';
  readonly measurement: string;
  attest(nonce: string): Promise<AttestationDocument>;
}

const HEX64 = /^[0-9a-f]{64}$/;

export class SimulatedAttester implements AttestationProvider {
  readonly platform = 'simulated' as const;
  constructor(
    private readonly o: { platformSecretKey: Uint8Array; measurement: string; keys: MatcherKeys; now?: () => number },
  ) {}
  get measurement() {
    return this.o.measurement;
  }
  async attest(nonce: string): Promise<AttestationDocument> {
    if (!HEX64.test(nonce)) throw Object.assign(new Error('nonce must be 64 hex chars'), { status: 400 });
    return signAttestation(
      {
        v: 1,
        platform: 'simulated',
        measurement: this.o.measurement,
        encKey: this.o.keys.encPublicJwk,
        signKey: this.o.keys.signPublicKey,
        nonce,
        issuedAt: new Date((this.o.now ?? Date.now)()).toISOString(),
      },
      this.o.platformSecretKey,
    );
  }
}

/** Placeholder for a real platform: configuration exists, the provider does not yet. */
export class UnimplementedAttester implements AttestationProvider {
  readonly measurement = '';
  constructor(readonly platform: 'nitro' | 'confidential-space') {}
  async attest(): Promise<AttestationDocument> {
    throw new Error(`attestation platform "${this.platform}" is not implemented yet (see docs/DEPLOY.md)`);
  }
}
