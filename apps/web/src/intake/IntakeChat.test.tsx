import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntakeRecord } from '@shield/shared';
import { IntakeChat, type IntakeDraft } from './index';

afterEach(cleanup);

const NARRATIVE = 'He said "stay quiet".\n\n  Then the music stopped… 😶\t[2am] {I think}  ';

function currentStepId(container: HTMLElement): string {
  return container.querySelector('[data-step-id]')!.getAttribute('data-step-id')!;
}
function area(container: HTMLElement) {
  return within(container.querySelector('[data-step-id]') as HTMLElement);
}

type User = ReturnType<typeof userEvent.setup>;

/** Click the primary action of an info step (always the first button). */
async function continueInfo(user: User, container: HTMLElement) {
  await user.click(area(container).getAllByRole('button')[0]);
}

async function skipOrContinue(user: User, container: HTMLElement) {
  const a = area(container);
  const kind = container.querySelector('[data-step-id]')!.getAttribute('data-step-kind');
  if (kind === 'info') return continueInfo(user, container);
  if (kind === 'evidence') return user.click(a.getAllByRole('button').at(-1)!);
  return user.click(a.getByRole('button', { name: 'Skip for now' }));
}

describe('IntakeChat', () => {
  it('shows hotline resources and a way to leave when she is not safe', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const { container } = render(<IntakeChat onComplete={() => {}} onExit={onExit} />);
    expect(screen.getByText('Are you safe right now?', { selector: 'div' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(currentStepId(container)).toBe('safety.help');
    const hotline = screen.getByRole('link', { name: /1-800-656-4673/ });
    expect(hotline).toHaveAttribute('href', 'tel:+18006564673');
    expect(screen.getByRole('link', { name: /911/ })).toHaveAttribute('href', 'tel:911');
    expect(screen.getByRole('link', { name: /online\.rainn\.org/ })).toHaveAttribute('href', 'https://online.rainn.org');
    await user.click(screen.getByRole('button', { name: 'Leave this page now' }));
    expect(onExit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: "I'd like to keep going" }));
    expect(currentStepId(container)).toBe('privacy');
  });

  it('does not show the crisis screen when she is safe', async () => {
    const user = userEvent.setup();
    const { container } = render(<IntakeChat onComplete={() => {}} />);
    await user.click(screen.getByRole('button', { name: "Yes, I'm safe" }));
    expect(currentStepId(container)).toBe('privacy');
    expect(screen.queryByRole('link', { name: /1-800-656-4673/ })).not.toBeInTheDocument();
  });

  it('skipping every question still reaches review and seals a valid record', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<(r: IntakeRecord) => void>();
    const { container } = render(<IntakeChat onComplete={onComplete} />);
    for (let i = 0; i < 200 && currentStepId(container) !== 'review'; i++) await skipOrContinue(user, container);
    expect(currentStepId(container)).toBe('review');
    expect(screen.getAllByText('Skipped').length).toBeGreaterThan(10);
    await user.click(screen.getByRole('button', { name: 'Seal my account' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const r = onComplete.mock.calls[0][0];
    expect(r.schemaVersion).toBe(1);
    expect(r.narrative.freeRecall).toBe('');
    expect(r.perpetrators).toEqual([]);
    expect(r.goals.policeReport).toBe('undecided');
    expect(screen.getByText('Your account is sealed.')).toBeInTheDocument();
  });

  it('happy path: walks the whole interview and completes with her exact words', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<(r: IntakeRecord) => void>();
    const onUpload = vi.fn();
    const drafts: IntakeDraft[] = [];
    const { container } = render(
      <IntakeChat onComplete={onComplete} onRequestEvidenceUpload={onUpload} onDraftChange={(d) => drafts.push(d)} />,
    );

    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = currentStepId(container);
      if (id === 'review') break;
      seen.push(id);
      const a = area(container);
      switch (id) {
        case 'safety.now':
          await user.click(a.getByRole('button', { name: "Yes, I'm safe" }));
          break;
        case 'about.name':
          await user.type(a.getByLabelText('Name to use for you'), 'Sam');
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'about.contactMethods':
          await user.click(a.getByRole('button', { name: 'Text message' }));
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'about.phone':
          await user.type(a.getByLabelText('Safe phone number'), '555-0100');
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'when.date':
          fireEvent.change(a.getByLabelText('Date'), { target: { value: '2025-06-01' } });
          await user.click(a.getByLabelText('This date is approximate'));
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'story.freeRecall': {
          const box = a.getByLabelText('What happened, in your own words');
          await user.click(box);
          await user.paste(NARRATIVE);
          await user.click(a.getByRole('button', { name: 'Save and continue' }));
          break;
        }
        case 'recall.sound':
          await user.type(a.getByLabelText('What you heard'), 'loud music');
          await user.click(a.getByRole('button', { name: 'Save and continue' }));
          break;
        case 'context.types':
          await user.click(a.getByRole('button', { name: 'Rape' }));
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'person.list':
          await user.type(a.getByLabelText('Name, or what you call them'), 'Alex');
          await user.type(a.getByLabelText('Their email'), 'alex@example.com');
          await user.click(a.getByRole('button', { name: '+ Add another person' }));
          await user.type(a.getAllByLabelText('What they look like')[1], 'tall, beard');
          await user.click(a.getByRole('button', { name: 'Save and continue' }));
          break;
        case 'person.escrow':
          await user.click(a.getAllByRole('button', { name: 'Yes, seal it' })[0]);
          await user.click(a.getByRole('button', { name: 'Continue' }));
          break;
        case 'people.told':
          await user.type(a.getByLabelText('Who you told'), 'my roommate');
          await user.click(a.getByRole('button', { name: 'Save and continue' }));
          break;
        case 'evidence.upload':
          await user.click(a.getByRole('button', { name: 'Add files' }));
          break;
        case 'goals.police':
          await user.click(a.getByRole('button', { name: 'Yes' }));
          break;
        case 'goals.attorney':
          await user.click(a.getByRole('button', { name: "I'm not sure" }));
          break;
        default:
          await skipOrContinue(user, container);
      }
    }

    expect(currentStepId(container)).toBe('review');
    for (const id of ['safety.now', 'privacy', 'story.freeRecall', 'recall.sight', 'person.escrow', 'people.witnesses', 'medical.care', 'evidence.upload', 'safety.access', 'costs.amounts', 'goals.protective'])
      expect(seen).toContain(id);
    expect(seen).not.toContain('safety.help');
    expect(onUpload).toHaveBeenCalledTimes(1);

    // Review shows her words verbatim and lets her edit a section, then return.
    const reviewNarr = Array.from(container.querySelectorAll('dd')).find((dd) => dd.textContent === NARRATIVE);
    expect(reviewNarr).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit: In your words' }));
    expect(currentStepId(container)).toBe('story.intro');
    await user.click(screen.getByRole('button', { name: 'Back to review' }));
    expect(currentStepId(container)).toBe('review');

    await user.click(screen.getByRole('button', { name: 'Seal my account' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const r = onComplete.mock.calls[0][0];
    expect(r.narrative.freeRecall).toBe(NARRATIVE);
    expect(r.narrative.sensory.sound).toBe('loud music');
    expect(r.narrative.sensory.sight).toBeUndefined();
    expect(r.survivor).toMatchObject({ preferredName: 'Sam', phone: '555-0100', safeContact: { text: true, phone: false } });
    expect(r.incident).toMatchObject({ dateStart: '2025-06-01', dateIsApproximate: true, incidentTypes: ['rape'] });
    expect(r.perpetrators).toHaveLength(2);
    expect(r.perpetrators[0]).toMatchObject({ name: 'Alex', escrowOptIn: true });
    expect(r.perpetrators[0].identifiers).toContainEqual({ kind: 'email', value: 'alex@example.com' });
    expect(r.perpetrators[1]).toMatchObject({ physicalDescription: 'tall, beard', escrowOptIn: false });
    expect(r.disclosures[0].toWhom).toBe('my roommate');
    expect(r.goals).toMatchObject({ policeReport: 'yes', attorney: 'undecided' });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.at(-1)!.answers['story.freeRecall']).toBe(NARRATIVE);
  }, 60_000);

  it('take a break shows grounding, keeps typed words, and resumes', async () => {
    const user = userEvent.setup();
    const drafts: IntakeDraft[] = [];
    const start: IntakeDraft = {
      draftVersion: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'story.freeRecall',
      answers: { 'safety.now': 'yes' },
      skipped: [],
      visited: ['safety.now', 'privacy', 'story.intro', 'story.freeRecall'],
      reachedReview: false,
    };
    render(<IntakeChat initialDraft={start} onComplete={() => {}} onDraftChange={(d) => drafts.push(d)} />);
    await user.type(screen.getByLabelText('What happened, in your own words'), 'I was at');
    await user.click(screen.getByRole('button', { name: 'Take a break' }));
    const dialog = screen.getByRole('dialog', { name: 'Take a break' });
    expect(within(dialog).getByText('Name 5 things you can see.')).toBeInTheDocument();
    expect(within(dialog).getByText(/progress is kept/i)).toBeInTheDocument();
    // flushed immediately on break, including unsent text
    expect(drafts.at(-1)!.pending).toEqual({ stepId: 'story.freeRecall', value: 'I was at' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('What happened, in your own words')).toHaveValue('I was at');
  });

  it('resumes from a draft and can go back to a previous question', async () => {
    const user = userEvent.setup();
    const start: IntakeDraft = {
      draftVersion: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'about.legalName',
      answers: { 'safety.now': 'yes', 'about.name': 'Sam' },
      skipped: [],
      visited: ['safety.now', 'privacy', 'howItWorks', 'about.name', 'about.legalName'],
      reachedReview: false,
    };
    const { container } = render(<IntakeChat initialDraft={start} onComplete={() => {}} />);
    expect(screen.getByText('Part 2 of 15: About you')).toBeInTheDocument();
    expect(screen.getByText('Sam', { selector: 'div' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(currentStepId(container)).toBe('about.name');
    expect(screen.getByLabelText('Name to use for you')).toHaveValue('Sam');
    await act(async () => {});
  });
});
