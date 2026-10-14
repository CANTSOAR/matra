/**
 * Every word the story space says around her story. Same style guide as src/intake/script.ts:
 * short sentences, plain words, warm, never judging. Never "alleged", never "why".
 */
import { NOTICES } from '../lib/disclosures';

export const COPY = {
  title: 'Your story',
  saved: 'Saved privately on this device',
  vault: {
    saved: 'Saved to your private space',
    saving: 'Saving…',
    notYet: 'Kept privately on this device',
    failed: 'Couldn’t save — we’ll try again',
    retry: 'Try again',
    saveNow: 'Save now',
    justNow: 'just now',
    minutesAgo: (n: number) => (n === 1 ? '1 min ago' : `${n} min ago`),
  },
  saving: 'Saving…',
  savedVault: 'Saved privately in your vault',
  takeBreak: 'Take a break',
  backToStory: 'Back to your story',

  safety: {
    title: 'Before anything else — are you somewhere safe right now?',
    lead: 'There is no wrong answer. We just want to check on you.',
    yes: 'Yes',
    no: 'No',
    unsure: 'Not sure',
    skip: "I'd rather not say",
    helpTitle: 'Thank you for telling us. Your safety comes first.',
    helpBody: 'If you are in danger, please call 911. You can also talk to someone right now, for free, any time.',
    keepGoing: "I'd like to keep going",
    leave: 'Leave this page now',
  },

  start: {
    title: 'Start wherever feels right.',
    lead: 'Share as much or as little as you want — a sentence is enough. You can always come back.',
    label: 'What you would like to share',
    placeholder: 'Write anything you remember, in any order…',
    add: 'Add to my story',
    talk: 'Talk',
    files: 'Add files',
    private: 'Matra can’t read this. It is locked on this device before it is saved, and your words are kept exactly as you write them.',
    addMore: 'Add more',
    cancel: 'Not now',
  },

  voice: {
    reviewTitle: 'Here is what we heard',
    reviewLead: 'Read it over. You can fix anything before it is added. Your recording never leaves this device.',
    reviewLabel: 'What we heard — you can edit it',
    add: 'Add to my story',
    discard: 'Discard',
    unsupported: "Talking isn't available in this browser yet. You can type instead — even a few words is enough.",
  },

  files: {
    inputLabel: 'Choose files to add',
    working: 'Removing hidden details and locking your files on this device…',
    added: (n: number) =>
      `${n === 1 ? '1 file added and locked.' : `${n} files added and locked.`} ${NOTICES.keepOriginals.body[0]}`,
    failed: "Some files couldn't be added. Nothing else was changed.",
    count: (n: number) => (n === 1 ? '1 file kept safely' : `${n} files kept safely`),
  },

  journal: {
    title: 'Your words',
    typed: 'Written',
    voice: 'Spoken',
    fromInterview: 'From the interview',
    remove: 'Remove',
    edit: 'Edit',
    editLabel: 'Your words — change anything you like',
    editSave: 'Save changes',
    editCancel: 'Cancel',
    editSealedNote: 'Your earlier sealed version stays as it was.',
    editNote: 'Only you can change your words. Nothing is changed for you.',
    edited: (when: string) => `edited ${when}`,
    editedAnnounce: 'Your changes are saved.',
    removeConfirm:
      'Remove this part from your story? It will be taken off your list. Earlier saved versions of your draft may still include it until you delete your account.',
    removeConfirmSealed:
      'Remove this part from your draft? Your earlier sealed version stays as it was, and earlier saved versions of your draft may still include it until you delete your account.',
    removeYes: 'Yes, remove it',
    removeNo: 'Keep it',
    empty: 'Nothing here yet. When you add something, it will show here, just as you wrote it.',
  },

  picked: {
    title: 'Here’s what I picked up',
    lead: 'Check anything that’s off. Nothing is kept unless you say so.',
    from: 'From your words',
    keep: 'Keep',
    change: 'Change',
    notRight: 'Not right',
    save: 'Save',
    cancel: 'Cancel',
    changeLabel: 'Change it to',
    kept: 'Kept. You can change it any time.',
    setAside: 'Set aside. It won’t come up again.',
    announce: (n: number) => (n === 1 ? 'I picked up 1 thing from your words.' : `I picked up ${n} things from your words.`),
    openTopic: 'Change it there',
    showMore: (n: number) => (n === 1 ? 'Show 1 more' : `Show ${n} more`),
    keptCount: (n: number) => (n === 1 ? '1 thing kept' : `${n} things kept`),
  },

  topics: {
    title: 'Only if you want',
    lead: 'A few more things that can help later. Open any of them, in any order — or none.',
    leadEmpty: 'Or, if it’s easier, start with a few gentle questions. Open any of them, in any order.',
    open: 'Open',
    revisit: 'Look again',
    allDone: 'You’ve looked at everything here. Thank you.',
    showAll: (n: number) => `Show all ${n} topics`,
    leadMore: 'A few more things that can help later — the most useful first. Open any of them, in any order, or none.',
    showFewer: 'Show fewer',
  },

  panel: {
    save: 'Save',
    next: 'Save and continue',
    skip: 'Skip',
    enough: 'That’s enough for now',
    back: 'Back',
    skipTopic: 'Skip this part',
    step: (n: number, total: number) => `${n} of ${total}`,
    done: 'That’s everything here. Thank you.',
    doneLead: 'You can come back and change any of it, any time.',
    alsoHere: 'Also in this part',
    notSure: "I'm not sure",
    pickDate: 'Pick a date',
    describe: 'Describe it in words',
    escrowMore: 'What is a sealed match?',
    filesAdded: (n: number) => `${n === 1 ? '1 file added' : `${n} files added`}. ${NOTICES.keepOriginals.body[0]}`,
    moreDetails: 'More details, only if you know them',
    online: 'Ways to recognize them online',
    onlineWhy:
      'If you add one of these, you can choose a sealed match next. It is sealed on this device before it is sent. Only if someone else names the same person would a Legal Options Counselor (a licensed attorney) see it and reach out to you, privately.',
    noPeople: 'This is for the people you named in “The person”. Add someone there first, if you want to.',
  },

  map: {
    title: 'Your story map',
    summary: (n: number, total: number) => `${n} of ${total} started`,
    open: 'Show map',
    close: 'Hide map',
  },

  review: {
    title: 'Here is everything you shared',
    lead: 'Take your time. Your words are shown exactly as you wrote them. You can change anything.',
    words: 'Your words',
    edit: 'Edit',
    nothing: 'Nothing here yet — that’s okay.',
    skipped: 'Skipped',
    seal: 'Seal my account',
    sealExplain:
      'Sealing locks this version of your account. It is still only yours, and nothing is sent to anyone. You can add to it later, and this version stays as it is.',
    sealing: 'Sealing your account…',
    sealingBody: 'Locking it on this device and saving it to your vault. Please keep this page open.',
    sealError: "We couldn't seal your account just now. Nothing is lost — everything is still here.",
    retry: 'Try again',
    goReview: 'Look it over',
    goReviewLead: 'When you’re ready, you can look everything over and seal it. There’s no rush.',
  },

  interview: {
    offer: 'Prefer to be asked one question at a time?',
    offerButton: 'Switch to one question at a time',
    back: 'Back to the open story space',
  },
} as const;
