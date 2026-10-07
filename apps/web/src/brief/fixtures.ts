/**
 * Fictional demo records for the Matra brief engine. All names, places, numbers and hashes are invented.
 * Content is intentionally non-graphic.
 */
import type { IntakeRecord, LedgerEntry } from '@matra/shared';

const NARRATIVE = `I have worked at the same marketing agency in New Brunswick for about two years. Derek is a senior account manager on my team. Before that night we were friendly at work but we had never spent time together outside the office.

On Friday, August 14, our team had a dinner at a restaurant on George Street to celebrate a client launch. I had two glasses of wine over about three hours. I was not drunk. Around 11:30 Derek offered to drive me home because it had started raining and my apartment is about ten minutes away. I said yes because I knew him and I was tired.

When we got to my building he asked if he could come up and use the bathroom. I said okay. Once he was inside he sat down on my couch and would not leave. I told him I was going to bed and that he needed to go. He laughed and said "relax, just one drink."

I said no again and walked toward the door to open it for him. He came up behind me, turned me around and pushed me back onto the couch. He held both of my wrists down with one hand. I said "no" and "stop" more than once. I tried to pull my arms away and I couldn't.

Then I froze. I don't know how long it lasted. I remember staring at the ceiling fan and counting the blades over and over. I remember thinking that if I stayed still it would be over sooner. He sexually assaulted me on the couch.

Afterwards he stood up, fixed his shirt and said something like "nobody's going to believe you, you invited me up." Then he left. I locked the door and sat on the bathroom floor until it was light outside.

I did not go to work on Monday or Tuesday. I told my manager I was sick. I have not been back in the office since August 21 because I can't be in the same room as him.`;

export const sampleLedgerEntry: LedgerEntry = {
  seq: 1042,
  id: 'led_01J9Z3K7Q4M8D2X6',
  type: 'record.sealed',
  subjectId: 'rec_7f3a91c2e8b44d10',
  contentHash: 'ae2de6906e51fb3516f9f1dcda7dc85f3bb4cb3c8f222ad9d4a6f2aa73bb47ca',
  timestamp: '2026-08-19T14:22:07.381Z',
  prevHash: '84fd9bac333ad79154348296204fa7f8c537a96e08983e5f73b3f5aca8e8edf7',
  entryHash: '923fe53966c6cd9343e11af776cd4b05be315ea4b200b02e4d5dfb0f929b73bf',
};

export const sampleRecord: IntakeRecord = {
  schemaVersion: 1,
  completedAt: '2026-08-19T14:20:51.000Z',
  survivor: {
    preferredName: 'Maya',
    legalName: 'Maya R. Okafor',
    dateOfBirth: '1997-03-22',
    pronouns: 'she/her',
    preferredLanguage: 'English',
    phone: '(732) 555-0148',
    email: 'maya.okafor.demo@example.com',
    safeContact: { phone: true, text: true, email: false, voicemail: false },
    safeContactNotes: 'Text first. Please call only after 6pm on weekdays. Do not leave a voicemail — my roommate sometimes checks my phone.',
    residenceState: 'NJ',
    residenceCounty: 'Middlesex',
  },
  incident: {
    dateStart: '2026-08-14',
    dateIsApproximate: false,
    timeDescription: 'Late at night, between about 11:45pm and 12:30am',
    locationDescription: 'The living room of my apartment, on the couch',
    locationAddress: '200 Example Avenue, Apt 3B, New Brunswick, NJ (fictional address)',
    jurisdiction: { state: 'NJ', county: 'Middlesex', city: 'New Brunswick' },
    incidentTypes: ['sexual_assault'],
    isOngoing: false,
  },
  narrative: {
    freeRecall: NARRATIVE,
    sensory: {
      sight: 'The ceiling fan was on low. The lamp by the window was the only light on.',
      sound: 'Rain on the window. The TV was still on mute showing a cooking show.',
      smell: 'His cologne, and the wine from the restaurant on his breath.',
      touch: 'His hand pressing my wrists into the couch cushion. The next day both wrists were sore.',
    },
    contextBefore: 'At dinner he kept refilling my water glass and sat next to me. In the car he talked about work the whole time. Nothing he did before that made me feel unsafe.',
    contextAfter: 'I texted my best friend Priya at 7:12am the next morning. I took photos of my wrists that afternoon. He texted me on Sunday as if nothing happened.',
    additionalDetails: 'He sent me a text on Sunday at 4:03pm that said "had fun friday, our secret right?" I took a screenshot.',
    wordsSpoken: '"Relax, just one drink."\n"Nobody\'s going to believe you, you invited me up."\nIn a text on Sunday: "had fun friday, our secret right?"',
  },
  perpetrators: [
    {
      id: 'p1',
      name: 'Derek Lawson',
      relationship: 'Coworker (senior account manager on my team)',
      knownToSurvivor: true,
      physicalDescription: 'White man, early 30s, about 6\'1", short brown hair, beard. Was wearing a navy blazer and a gray shirt.',
      identifiers: [
        { kind: 'phone', value: '(732) 555-0193' },
        { kind: 'email', value: 'd.lawson@example-agency.com' },
        { kind: 'social_handle', platform: 'Instagram', value: '@derek.lawson.demo' },
      ],
      escrowOptIn: true,
    },
  ],
  witnesses: [
    {
      id: 'w1',
      name: 'Jordan Ellis',
      contact: 'jordan.ellis.demo@example.com',
      relationship: 'Coworker who was at the dinner',
      whatTheyKnow: 'Saw Derek offer me a ride and saw us leave the restaurant together around 11:30.',
    },
  ],
  disclosures: [
    {
      id: 'd1',
      toWhom: 'Priya Natarajan (best friend)',
      when: '2026-08-15',
      method: 'text',
      whatWasSaid: 'I texted "something really bad happened last night with Derek, can you come over" and when she came over I told her he held me down and I kept saying no.',
    },
    {
      id: 'd2',
      toWhom: 'My sister, Ada',
      when: 'Sunday, August 16, in the evening',
      method: 'phone',
      whatWasSaid: 'I told her a coworker assaulted me after the team dinner and that I was scared to go back to work.',
    },
  ],
  medical: {
    soughtCare: true,
    facility: 'Raritan Valley General Hospital Emergency Department (fictional)',
    date: '2026-08-15',
    forensicExamCompleted: true,
    injuries: 'Bruising on both wrists. The nurse photographed them.',
  },
  priorReports: [
    {
      id: 'r1',
      agency: 'Agency HR department (internal complaint)',
      date: '2026-08-24',
      reportNumber: 'HR-2026-0311',
      outcome: 'Open — HR said they are "looking into it"',
    },
  ],
  evidence: [
    {
      id: 'e1', kind: 'screenshot', fileName: 'text-from-derek-2026-08-16.png', mimeType: 'image/png', sizeBytes: 412_337,
      sha256: '4509a91b35d658006acc415229da7e8a366af240781370a585acb3b8838f8fc6',
      description: 'Screenshot of the text he sent on Sunday ("our secret right?")', capturedAt: '2026-08-16T20:05:00Z', metadataStripped: true,
    },
    {
      id: 'e2', kind: 'photo', fileName: 'wrists-left-right.jpg', mimeType: 'image/jpeg', sizeBytes: 2_847_119,
      sha256: 'd2be2a9278191b3e111ca494ff17e304ef197be378226cb33eceaaadefb44e04',
      description: 'Photo of bruising on both wrists', capturedAt: '2026-08-15', metadataStripped: true,
    },
    {
      id: 'e3', kind: 'message_export', fileName: 'priya-texts-aug-15.txt', mimeType: 'text/plain', sizeBytes: 6_204,
      sha256: '9cc8b4c7562db6fcb74692f89ee8ab2cef2238d862d80dc8d4c41a695bc38066',
      description: 'Export of my texts with Priya the morning after', capturedAt: '2026-08-15', metadataStripped: false,
    },
    {
      id: 'e4', kind: 'document', fileName: 'rideshare-receipt-hospital.pdf', mimeType: 'application/pdf', sizeBytes: 88_410,
      sha256: 'e4d21b910632f6a56b521b715883c2fe421755ff2987ed435a82a6a83898afd4',
      description: 'Receipt for my ride to the hospital', capturedAt: '2026-08-15', metadataStripped: false,
    },
  ],
  safety: {
    inImmediateDanger: false,
    perpetratorHasAccess: true,
    wantsProtectiveOrder: 'unsure',
    notes: 'He knows where I live because he drove me home. We work on the same floor.',
  },
  financialImpact: {
    medicalCosts: '$340 ER co-pay',
    counselingCosts: '$150 per week for therapy, started August 27',
    lostWages: 'About $2,600 so far (unpaid leave since August 21)',
    otherCosts: '$38 rideshare to the hospital; $210 to change my locks',
    hasInsurance: 'yes',
  },
  goals: { policeReport: 'undecided', attorney: 'yes', compensation: 'yes', protectiveOrder: 'undecided' },
};

/** Almost everything skipped — what a survivor who answered only the required minimum produces. */
export const minimalRecord: IntakeRecord = {
  schemaVersion: 1,
  completedAt: '2026-09-30T02:11:00.000Z',
  survivor: { safeContact: { phone: false, text: false, email: false, voicemail: false } },
  incident: { dateIsApproximate: true, jurisdiction: {}, incidentTypes: [], isOngoing: false },
  narrative: { freeRecall: '', sensory: {} },
  perpetrators: [],
  witnesses: [],
  disclosures: [],
  medical: { soughtCare: false },
  priorReports: [],
  evidence: [],
  safety: { inImmediateDanger: false },
  financialImpact: {},
  goals: { policeReport: 'undecided', attorney: 'undecided', compensation: 'undecided', protectiveOrder: 'undecided' },
};

export const sampleBriefOptions = {
  recordId: sampleLedgerEntry.subjectId,
  recordContentHash: sampleLedgerEntry.contentHash,
  ledgerEntry: sampleLedgerEntry,
  generatedAt: new Date('2026-10-06T15:30:00Z'),
  preparedFor: 'Middlesex County Prosecutor’s Office — Special Victims Unit',
};
