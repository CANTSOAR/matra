/**
 * The "one question at a time" alternative, reached from the story space: it walks every step
 * (including the sensory questions) to review and seals. All data is fictional.
 */
import { RUN, addToStory, expect, nav, registerSurvivor, runIntake, sealFromReview, storySafety, test, type } from './helpers';

test('interview alternative: switch from the story space, walk past the sensory steps, seal', async ({ page }) => {
  await registerSurvivor(page, `wren-${RUN}`);
  await nav(page, 'My story');
  await storySafety(page, 'Yes');
  await addToStory(page, 'It was at his place on a friday. I still have the texts.');
  await page.getByRole('button', { name: 'Switch to one question at a time' }).click();
  const seen = await runIntake(page, {
    'recall.sight': type('a blue lamp by the door'),
    'recall.sound': type('loud music'),
  });
  for (const id of ['recall.sight', 'recall.sound', 'recall.smell', 'recall.touch', 'recall.taste', 'recall.more']) expect(seen).toContain(id);
  expect(seen).not.toContain('safety.now');
  await sealFromReview(page);
});
