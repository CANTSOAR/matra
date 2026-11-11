import { describe, expect, it } from 'vitest';
import { typedText } from './mirror';

describe('Server view: what she typed (mirror.ts)', () => {
  it('collects her words from a vault payload, without ids, timestamps or repeats', () => {
    const payload = {
      kind: 'final',
      record: {
        completedAt: '2026-11-11T10:00:00.000Z',
        narrative: { freeRecall: 'We met at the cafe.', entries: [{ id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', text: 'We met at the cafe.' }] },
        perpetrators: [{ identifiers: [{ kind: 'social_handle', value: '@someone' }] }],
      },
    };
    expect(typedText(payload)).toBe('final · We met at the cafe. · social_handle · @someone');
  });
});
