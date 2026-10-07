import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntakeRecord } from '@matra/shared';
import { emptyDraft, type IntakeDraft } from '../intake/draft';
import type { StoryEntry, Suggestion } from '../understand/types';

// A tiny stand-in engine: finds "March 14" and "his apartment" in her words.
const understandSpy = vi.fn((entries: StoryEntry[], opts?: { dismissed?: string[] }): Suggestion[] => {
  const out: Suggestion[] = [];
  for (const e of entries) {
    const d = e.text.indexOf('March 14');
    if (d !== -1)
      out.push({
        id: `date:${e.id}:${d}`,
        kind: 'incident_date',
        label: 'It sounds like this happened around March 14.',
        target: 'when.date',
        value: { mode: 'text', text: 'around March 14' },
        confidence: 'medium',
        sources: [{ entryId: e.id, start: d, end: d + 8 }],
      });
    const p = e.text.indexOf('his apartment');
    if (p !== -1)
      out.push({
        id: `place:${e.id}:${p}`,
        kind: 'location',
        label: 'It sounds like it happened at his apartment.',
        target: 'where.place',
        value: 'his apartment',
        confidence: 'high',
        sources: [{ entryId: e.id, start: p, end: p + 13 }],
      });
  }
  return out.filter((s) => !opts?.dismissed?.includes(s.id));
});

vi.mock('./adapters', async (orig) => {
  const real = await orig<typeof import('./adapters')>();
  return { ...real, understand: (e: StoryEntry[], o?: { dismissed?: string[] }) => understandSpy(e, o) };
});

const { StorySpace } = await import('./StorySpace');
const { draftToRecord } = await import('../intake/record');
const { withEntries } = await import('./adapters');

/** Entries ride on the record (narrative.entries in the real engine). */
function entriesOf(r: IntakeRecord): StoryEntry[] {
  const x = r as unknown as { entries?: StoryEntry[]; narrative: { entries?: StoryEntry[] } };
  return x.narrative.entries ?? x.entries ?? [];
}

const NARRATIVE = 'It was around March 14, at his apartment.\n\n  He said "stay quiet"…  😶\t{I think}  ';

function safeDraft(extra: Partial<IntakeDraft> = {}): IntakeDraft {
  const d = emptyDraft(new Date('2026-01-01T10:00:00Z'));
  return { ...d, answers: { 'safety.now': 'yes' }, visited: [...d.visited, 'safety.help'], ...extra };
}

function setup(props: Partial<Parameters<typeof StorySpace>[0]> = {}) {
  const user = userEvent.setup();
  const changes: IntakeDraft[] = [];
  const onComplete = vi.fn<(r: IntakeRecord) => Promise<void>>(async () => {});
  const utils = render(
    <StorySpace onComplete={onComplete} onDraftChange={(d) => changes.push(d)} initialDraft={safeDraft()} {...props} />,
  );
  const last = () => changes[changes.length - 1];
  return { user, changes, last, onComplete, ...utils };
}

async function openTopicCard(user: ReturnType<typeof userEvent.setup>, id: string) {
  if (!document.querySelector(`[data-topic="${id}"]`)) await user.click(screen.getByRole('button', { name: /Show all \d+ topics/ }));
  await user.click(document.querySelector<HTMLButtonElement>(`[data-topic="${id}"]`)!);
}

async function card(user: ReturnType<typeof userEvent.setup>, id: string): Promise<HTMLElement> {
  const more = screen.queryByRole('button', { name: /Show all \d+ topics/ });
  if (more) await user.click(more);
  return document.querySelector<HTMLElement>(`[data-topic="${id}"]`)!;
}

async function addWords(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = screen.getByLabelText('What you would like to share');
  await user.click(box);
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Add to my story' }));
}

describe('StorySpace', () => {
  it('asks about safety first, and shows help for "No" before anything else', async () => {
    const onExit = vi.fn();
    const { user, last } = setup({ initialDraft: undefined, onExit });
    expect(screen.getByRole('heading', { name: /are you somewhere safe right now/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('What you would like to share')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Your story map' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(last().answers['safety.now']).toBe('no');
    expect(screen.getByRole('link', { name: /1-800-656-4673/ })).toHaveAttribute('href', 'tel:+18006564673');
    expect(screen.getByRole('link', { name: /911/ })).toHaveAttribute('href', 'tel:911');
    await user.click(screen.getByRole('button', { name: 'Leave this page now' }));
    expect(onExit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: "I'd like to keep going" }));
    expect(screen.getByRole('heading', { name: 'Start wherever feels right.' })).toBeInTheDocument();
  });

  it('goes straight to the open page when she is safe', async () => {
    const { user, last } = setup({ initialDraft: undefined });
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(last().answers['safety.now']).toBe('yes');
    expect(screen.queryByRole('link', { name: /1-800-656-4673/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('What you would like to share')).toBeInTheDocument();
  });

  it('typing an entry stores her words verbatim, timestamped, and shows them in the journal', async () => {
    const { user, last } = setup();
    expect(screen.getByRole('button', { name: 'Add to my story' })).toBeDisabled();
    await addWords(user, NARRATIVE);
    const entries = last().entries!;
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe(NARRATIVE);
    expect(entries[0].source).toBe('typed');
    expect(Number.isNaN(Date.parse(entries[0].createdAt))).toBe(false);
    const shown = document.querySelector('.space-journal .space-entry-text')!;
    expect(shown.textContent).toBe(NARRATIVE);
    expect(last().space?.composer).toBeUndefined();

    // add more later
    await user.click(screen.getByRole('button', { name: /Add more/ }));
    await addWords(user, 'A second thing.');
    expect(last().entries!.map((e) => e.text)).toEqual([NARRATIVE, 'A second thing.']);
  });

  it('shows what it picked up, with her words highlighted; Keep / Change / Not right update the draft', async () => {
    const { user, last } = setup();
    await addWords(user, NARRATIVE);
    const region = screen.getByRole('region', { name: /what I picked up/i });
    const date = within(region).getByText('It sounds like this happened around March 14.').closest('li')!;
    expect(date.querySelector('mark')!.textContent).toBe('March 14');
    expect(date.querySelector('blockquote')!.textContent).toContain('It was around March 14, at his apartment.');
    expect(screen.getByRole('status', { name: '' }).textContent ?? '').toBeDefined();
    expect(document.body.textContent).toContain('I picked up 2 things from your words.');

    // Change: she edits the date in her own words
    await user.click(within(date).getByRole('button', { name: 'Change' }));
    const input = within(date).getByLabelText('Change it to');
    await user.clear(input);
    await user.type(input, 'the Saturday before March 14');
    await user.click(within(date).getByRole('button', { name: 'Save' }));
    expect(last().answers['when.date']).toEqual({ mode: 'text', text: 'the Saturday before March 14' });
    expect(Object.values(last().space!.decisions!)).toContain('edited');

    // Keep: the place
    const place = screen.getByText('It sounds like it happened at his apartment.').closest('li')!;
    await user.click(within(place).getByRole('button', { name: 'Keep' }));
    expect(last().answers['where.place']).toBe('his apartment');
    expect(screen.queryByText('It sounds like it happened at his apartment.')).not.toBeInTheDocument();
    // and the topic now counts as filled
    expect((await card(user, 'whenWhere')).textContent).toContain('Filled');
  });

  it('"Not right" sets a suggestion aside for good, even after understanding runs again', async () => {
    const { user, last } = setup();
    await addWords(user, NARRATIVE);
    const date = screen.getByText('It sounds like this happened around March 14.').closest('li')!;
    await user.click(within(date).getByRole('button', { name: 'Not right' }));
    const id = last().dismissedSuggestions![0];
    expect(id).toMatch(/^date:/);
    expect(last().answers['when.date']).toBeUndefined();
    expect(screen.queryByText('It sounds like this happened around March 14.')).not.toBeInTheDocument();

    // A new entry makes it run again — the dismissed one is passed in, and stays hidden.
    await user.click(screen.getByRole('button', { name: /Add more/ }));
    await addWords(user, 'Later I texted my sister.');
    expect(understandSpy.mock.calls.at(-1)![1]?.dismissed).toContain(id);
    expect(screen.queryByText('It sounds like this happened around March 14.')).not.toBeInTheDocument();
    expect(screen.getByText('It sounds like it happened at his apartment.')).toBeInTheDocument();
  });

  it('opens topics in any order, a few questions at a time; skipped topics say "Skipped"', async () => {
    const { user, last } = setup();
    // open a later topic first
    await openTopicCard(user, 'care');
    expect(screen.getByRole('heading', { name: 'Care you got' })).toBeInTheDocument();
    const panel = document.querySelector('[data-topic-panel="care"]') as HTMLElement;
    const page = within(panel);
    expect(page.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'That’s enough for now' })).toBeInTheDocument();
    // 1–3 questions on a page
    const qs = panel.querySelectorAll('.space-page .space-field');
    expect(qs.length).toBeGreaterThanOrEqual(1);
    expect(qs.length).toBeLessThanOrEqual(3);
    await user.click(page.getByRole('group', { name: 'Did you get any medical care afterward?' }).querySelector('button:nth-child(2)')!);
    await user.click(page.getByRole('button', { name: 'That’s enough for now' }));
    expect(last().answers['medical.care']).toBe('no');
    expect(last().skipped).not.toContain('medical.injuries');

    // now an earlier one, and skip every page of it
    await openTopicCard(user, 'whenWhere');
    for (let i = 0; i < 10 && screen.queryByRole('button', { name: 'Skip' }); i++) {
      await user.click(screen.getByRole('button', { name: 'Skip' }));
    }
    expect(screen.getByText('That’s everything here. Thank you.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Back to your story' })[0]);
    expect((await card(user, 'whenWhere')).textContent).toContain('Skipped');
    if (!document.querySelector('[data-topic="care"]')) await user.click(screen.getByRole('button', { name: /Show all \d+ topics/ }));
    expect((await card(user, 'care')).textContent).toMatch(/Partly|Filled/);

    // "Skip this part" on a topic she has not touched
    await openTopicCard(user, 'costs');
    await user.click(screen.getByRole('button', { name: 'Skip this part' }));
    expect(last().space?.skippedTopics).toContain('costs');
    if (!document.querySelector('[data-topic="costs"]')) await user.click(screen.getByRole('button', { name: /Show all \d+ topics/ }));
    expect((await card(user, 'costs')).textContent).toContain('Skipped');
  });

  it('the story map shows status in words and jumps to any section', async () => {
    const { user } = setup();
    const map = screen.getByRole('navigation', { name: 'Your story map' });
    expect(within(map).getByRole('button', { name: /Your words\s*Not yet/ })).toHaveAttribute('aria-current', 'location');
    await user.click(within(map).getByRole('button', { name: /The person\s*Not yet/ }));
    expect(screen.getByRole('heading', { name: 'The person' })).toBeInTheDocument();
    expect(within(map).getByRole('button', { name: /^The person\s*(Not yet|Partly)$/ })).toHaveAttribute('aria-current', 'location');

    // the way back is always there
    await user.click(screen.getByRole('button', { name: /Back to your story/ }));
    await addWords(user, 'Some words.');
    expect(within(map).getByRole('button', { name: /Your words\s*Filled/ })).toBeInTheDocument();

    await user.click(within(map).getByRole('button', { name: /Review/ }));
    expect(screen.getByRole('heading', { name: 'Here is everything you shared' })).toBeInTheDocument();
  });

  it('review shows her words verbatim first; sealing reports progress, and failure keeps everything for a retry', async () => {
    let fail = true;
    let release: () => void = () => {};
    const onComplete = vi.fn(async (_r: IntakeRecord) => {
      if (fail) throw new Error('network down');
      await new Promise<void>((r) => (release = r));
    });
    const { user } = setup({ onComplete });
    await addWords(user, NARRATIVE);
    await user.click(screen.getByRole('button', { name: 'Look it over' }));
    const review = screen.getByRole('region', { name: 'Here is everything you shared' });
    const first = review.querySelector('.space-review-entry .space-verbatim')!;
    expect(first.textContent).toBe(NARRATIVE);

    await user.click(within(review).getByRole('button', { name: 'Seal my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't seal your account just now.*network down/);
    expect(within(review).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const record = onComplete.mock.calls[0][0] as IntakeRecord;
    expect(record.narrative.freeRecall).toBe(NARRATIVE);
    expect(entriesOf(record)[0].text).toBe(NARRATIVE);

    fail = false;
    await user.click(within(review).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Sealing your account…/)).toBeInTheDocument();
    release();
    expect(await screen.findByText('Your account is sealed.')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('a saved draft round-trips her entries and choices', async () => {
    const { user, last, unmount } = setup();
    await addWords(user, NARRATIVE);
    const date = screen.getByText('It sounds like this happened around March 14.').closest('li')!;
    await user.click(within(date).getByRole('button', { name: 'Not right' }));
    const saved = JSON.parse(JSON.stringify(last())) as IntakeDraft;
    unmount();

    render(<StorySpace onComplete={() => {}} initialDraft={saved} />);
    expect(document.querySelector('.space-journal .space-entry-text')!.textContent).toBe(NARRATIVE);
    expect(screen.queryByText('It sounds like this happened around March 14.')).not.toBeInTheDocument();
    expect(screen.getByText('It sounds like it happened at his apartment.')).toBeInTheDocument();
    const rec = withEntries(draftToRecord(saved), saved.entries!);
    expect(entriesOf(rec)).toEqual(saved.entries);
    expect(rec.narrative.freeRecall).toContain(NARRATIVE);
  });

  it('lets her edit her own words in the draft; marks them edited; the sealed version note shows', async () => {
    const onCheckpoint = vi.fn();
    const { user, last } = setup({ onCheckpoint, hasSealed: true });
    await addWords(user, NARRATIVE);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /^Edit/ }));
    expect(screen.getByText('Your earlier sealed version stays as it was.')).toBeInTheDocument();
    const box = screen.getByLabelText('Your words — change anything you like') as HTMLTextAreaElement;
    expect(box.value).toBe(NARRATIVE);
    await user.clear(box);
    await user.click(box);
    await user.paste('It was March 14.  ');
    expect(box.value).toBe('It was March 14.  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const e = last().entries![0];
    expect(e.text).toBe('It was March 14.  '); // verbatim, never trimmed
    expect(e.editedAt).toBeDefined();
    expect(document.querySelector('.space-entry-text')!.textContent).toBe('It was March 14.  ');
    expect(screen.getByText(/^edited /)).toBeInTheDocument();
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });

  it('marks a checkpoint when she keeps a suggestion or saves a topic page, not while typing', async () => {
    const onCheckpoint = vi.fn();
    const { user } = setup({ onCheckpoint });
    await user.type(screen.getByLabelText('What you would like to share'), 'abc');
    expect(onCheckpoint).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('What you would like to share'));
    await addWords(user, NARRATIVE);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    await user.click(within(document.querySelector('[data-suggestion-id^="date:"]') as HTMLElement).getByRole('button', { name: 'Keep' }));
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
    await openTopicCard(user, 'people');
    await user.click(screen.getByRole('button', { name: /^Skip$/ }));
    expect(onCheckpoint).toHaveBeenCalledTimes(3);
  });

  it('shows four topic cards, most useful gaps first, and the rest on request', async () => {
    setup();
    const ids = Array.from(document.querySelectorAll('[data-topic]')).map((el) => el.getAttribute('data-topic'));
    expect(ids).toEqual(['whenWhere', 'remember', 'person', 'people']);
    expect(screen.getByRole('button', { name: /Show all 12 topics/ })).toBeInTheDocument();
  });

  it('shows the shell\'s save status line instead of the on-device one', () => {
    setup({ saveStatus: <p data-testid="status">Saved to your private space · just now</p> });
    expect(screen.getByTestId('status')).toBeInTheDocument();
    expect(screen.queryByText('Saved privately on this device')).not.toBeInTheDocument();
  });

  it('keeps identifiers under "Ways to recognize them online", explaining a sealed match only once she fills one', async () => {
    const { user } = setup();
    await openTopicCard(user, 'person');
    const more = screen.getByRole('button', { name: 'More details, only if you know them' });
    // jsdom has no wide screen: collapsed by default, like on a phone.
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    const online = screen.getByRole('group', { name: 'Ways to recognize them online' });
    expect(within(online).getByLabelText('Their email')).toBeInTheDocument();
    expect(within(online).queryByText(/sealed match/)).not.toBeInTheDocument();
    await user.type(within(online).getByLabelText('Their phone number'), '555');
    expect(within(online).getByText(/sealed match/)).toBeInTheDocument();
  });
});
