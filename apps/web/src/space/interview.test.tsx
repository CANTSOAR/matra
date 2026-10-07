import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntakeRecord } from '@matra/shared';
import { IntakeChat } from '../intake';
import { emptyDraft } from '../intake/draft';
import { addEntry, answerSafety, toInterview } from './ops';

afterEach(cleanup);

const stepOf = (c: HTMLElement) => c.querySelector('[data-step-id]')!.getAttribute('data-step-id')!;

describe('switching from the story space to one question at a time', () => {
  it('walks past the sensory questions to review and seals', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<(r: IntakeRecord) => void>();
    const start = toInterview(addEntry(answerSafety(emptyDraft(), 'yes'), 'It was at his place.', 'typed'));
    const { container } = render(<IntakeChat initialDraft={start} onComplete={onComplete} />);
    const seen: string[] = [];
    for (let i = 0; i < 200 && stepOf(container) !== 'review'; i++) {
      const id = stepOf(container);
      if (seen.at(-1) === id && seen.at(-2) === id) throw new Error(`stuck at ${id}`);
      seen.push(id);
      const area = within(container.querySelector('[data-step-id]') as HTMLElement);
      const kind = container.querySelector('[data-step-id]')!.getAttribute('data-step-kind');
      if (id === 'recall.sight') {
        await user.type(area.getByLabelText('What you saw'), 'a blue lamp');
        await user.click(area.getByRole('button', { name: 'Save and continue' }));
      } else if (id === 'recall.smell') {
        await user.type(area.getByLabelText('What you smelled'), 'cologne');
        await user.click(area.getByRole('button', { name: 'Save and continue' }));
      } else if (kind === 'info') await user.click(area.getAllByRole('button')[0]);
      else if (kind === 'evidence') await user.click(area.getAllByRole('button').at(-1)!);
      else await user.click(area.getByRole('button', { name: 'Skip for now' }));
    }
    expect(stepOf(container)).toBe('review');
    for (const id of ['recall.intro', 'recall.sight', 'recall.sound', 'recall.smell', 'recall.touch', 'recall.taste']) expect(seen).toContain(id);
    await user.click(screen.getByRole('button', { name: 'Seal my account' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const r = onComplete.mock.calls[0][0];
    expect(JSON.stringify(r)).toContain('a blue lamp');
  });
});
