import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefPreview } from './BriefPreview';
import { sampleBriefOptions, sampleRecord } from './fixtures';

describe('BriefPreview', () => {
  it('renders the narrative verbatim and all sections', () => {
    const { container } = render(<BriefPreview record={sampleRecord} opts={sampleBriefOptions} />);
    expect(screen.getByText('Incident Summary in the Survivor’s Own Words')).toBeInTheDocument();
    const quotes = container.querySelectorAll('.brief-verbatim-text');
    expect(Array.from(quotes).some((q) => q.textContent === sampleRecord.narrative.freeRecall)).toBe(true);
    expect(container.querySelector('.brief-section--integrity')).not.toBeNull();
    expect(container.textContent).toContain(sampleRecord.evidence[0].sha256);
  });

  it('hides contact info when redacted', () => {
    const { container } = render(<BriefPreview record={sampleRecord} opts={{ ...sampleBriefOptions, redactContactInfo: true }} />);
    expect(container.textContent).not.toContain(sampleRecord.survivor.email!);
    expect(container.textContent).not.toContain(sampleRecord.survivor.phone!);
  });
});
