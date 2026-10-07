/**
 * Fictional, non-graphic sample stories used to test the understanding engine.
 * Written in the varied ways people actually write: fragments, lowercase, out of order, mixed languages.
 */
import type { StoryEntry } from './types';

export const NOW = new Date('2026-10-07T15:00:00Z');

export function entry(id: string, text: string, createdAt = '2026-10-07T15:00:00Z', source: StoryEntry['source'] = 'typed'): StoryEntry {
  return { id, createdAt, text, source };
}

export const SAMPLES = {
  oneLiner: 'he choked me',
  oneLinerEx: 'it was my ex. i still have the texts',
  survivorPhrases:
    "i think it was a friday. maybe around 2am. my coworker R drove me back to his apartment on 5th st. i'd had 2 drinks and my drink tasted weird. he choked me. he said no one would believe me. he knows where i live. i texted my roommate the next morning. went to the ER at Robert Wood Johnson and they did a rape kit. i still have the texts.",
  rambling:
    'Okay. I have been trying to write this for weeks so I am just going to put everything down. It happened on September 12, 2026, at a party at his frat house near campus. ' +
    'I went with my friend Dana and we were drinking, I had maybe three beers over a few hours. His name was Tyler, he is in my statistics class and I had talked to him a few times before. ' +
    'Later he said he wanted to show me something upstairs and I followed him because I trusted him. He locked the door. He said "nobody can hear you up here" and I froze. ' +
    'I remember the music downstairs and the smell of cologne. He pinned my arms. Afterward I found Dana in the kitchen and she drove me home. ' +
    'I told my mom on Sunday. I have bruises on my wrists that I took photos of. I keep thinking I should have left earlier.',
  lowercaseRunOn:
    'so we were at his place on elm street i had like 3 beers and then he locked the door and wouldnt let me leave i didnt know what to do i called my sister when i got home and she came over',
  hedged:
    "i'm not sure what day it was, maybe a saturday? i think around 11pm. not sure if he put something in my drink. the guy was someone from work",
  identifiers:
    'His number is (732) 555-0148 and his email is dj.marsh@example.com. He messaged me from @djmarsh_ on snap. My number is 609-555-0199, please only text.',
  voiceTranscript:
    'um so it was like three weeks ago at a hotel in atlantic city new jersey and um he grabbed my wrists and i i just remember the carpet',
  threats:
    'He said if I told anyone he would post the pictures. He keeps texting me from new accounts. I blocked him but he showed up at my work last week.',
  reports:
    'I reported it to Title IX in March and I filed a police report too. Case number 2025-004417. Nothing has happened since.',
  negations:
    "I didn't go to the hospital and I never reported it. He didn't have a weapon and he didn't choke me. I haven't told anyone.",
  justFeelings: 'I was so scared. I keep thinking about it. I feel like it was my fault and I hate that I feel that way.',
  explicitDate: 'It happened on August 14, 2026 at his apartment. He pinned me down. My roommate Jess was home in the other room.',
  spanglish:
    'fui al hospital the next day. mi compañero de trabajo, Luis, me dijo que nadie me iba a creer. le conté a mi hermana. he knows where i live.',
} as const;

/** One story told in pieces, out of order, on different days. */
export const OUT_OF_ORDER: StoryEntry[] = [
  entry('ooo-1', 'the hospital part first because that is what i remember most. i went to urgent care the day after and they did a sane exam.', '2026-10-03T18:00:00Z'),
  entry('ooo-2', 'before that. it was last friday, we matched on hinge and met at a bar called the Blue Room on Main Street. his name was Cam.', '2026-10-03T18:20:00Z'),
  entry('ooo-3', "i forgot to say. he didn't let me leave his car. i told my best friend Priya the next morning.", '2026-10-05T09:00:00Z', 'voice'),
];
