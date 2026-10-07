// @vitest-environment node
/**
 * Writes sample PDFs for visual review. Skipped unless RENDER_BRIEF_SAMPLES=1.
 *   RENDER_BRIEF_SAMPLES=1 BRIEF_SAMPLE_DIR=/some/dir npx vitest run src/brief/render-sample
 */
import { describe, it } from 'vitest';
import { generatePoliceBrief, generateVccoDraft } from './index';
import { minimalRecord, sampleBriefOptions, sampleRecord } from './fixtures';

const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const DIR = env.BRIEF_SAMPLE_DIR ?? '/private/tmp/claude-503/-Users-dipalshah-Desktop-matra/73f0ca63-ecb6-4a7b-bcb8-0ca79efef538/scratchpad';

describe.skipIf(env.RENDER_BRIEF_SAMPLES !== '1')('render sample PDFs', () => {
  it('writes PDFs', async () => {
    const fsMod = 'node:fs/promises';
    const fs: { writeFile(p: string, d: Uint8Array): Promise<void> } = await import(/* @vite-ignore */ fsMod);
    const multi = {
      ...sampleRecord,
      narrative: { ...sampleRecord.narrative, additionalDetails: sampleRecord.narrative.additionalDetails + ' He signed it “D” 😊 — Он знал.' },
    };
    await fs.writeFile(`${DIR}/police-brief-sample.pdf`, await generatePoliceBrief(sampleRecord, sampleBriefOptions));
    await fs.writeFile(`${DIR}/police-brief-sample-redacted-unicode.pdf`, await generatePoliceBrief(multi, { ...sampleBriefOptions, redactContactInfo: true }));
    await fs.writeFile(`${DIR}/police-brief-minimal.pdf`, await generatePoliceBrief(minimalRecord, { generatedAt: sampleBriefOptions.generatedAt }));
    await fs.writeFile(`${DIR}/vcco-draft-sample.pdf`, await generateVccoDraft(sampleRecord, { generatedAt: sampleBriefOptions.generatedAt }));
    await fs.writeFile(`${DIR}/vcco-draft-minimal.pdf`, await generateVccoDraft(minimalRecord, { generatedAt: sampleBriefOptions.generatedAt }));
  });
});
