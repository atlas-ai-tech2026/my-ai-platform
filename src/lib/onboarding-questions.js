// ─── onboarding-questions.js ─────────────────────────────────────────────────
// Every question the first-run flow asks, in ONE place.
//
// ── WHY ONE FILE ───────────────────────────────────────────────────────────
// Answers are stored as jsonb keyed by these ids, so adding, removing or
// rewording a question is an edit here and nothing else. No migration, no
// column, no deploy coordination. Amr will want to change these once he sees
// what people actually answer, and that must not be a database change.
//
// ── THE ORDER IS DELIBERATE AND WAS DECIDED BY THE OWNER ───────────────────
// Attribution comes FIRST, on a screen of its own. Amr asked for it twice, and
// he is right for a reason I did not have: people reach voxel-ai.ai from
// outside the workshops, so this is the only way to learn where from. A
// question buried third in a list is a question people tap past.

/** Stored instead of null when somebody REACHES a question and declines it.
 *
 *  ── THIS CONSTANT IS THE WHOLE SKIP STATISTIC ────────────────────────────
 *  Without it, "never got this far" and "saw it and said no" are both null,
 *  and the skip rate Amr asked for cannot be computed at all. Two different
 *  facts must not share one representation. */
export const SKIPPED = '__skipped';

/** Bumped if the shape of a stored answer ever changes, so old rows stay
 *  readable rather than being silently misread as the new shape. */
export const SCHEMA_VERSION = 1;

export const SCREENS = [
  {
    id: 'source',
    title: 'How did you find Voxel?',
    sub: 'One tap, and we are moving.',
    skippable: true,
    art: 'dune',
    caption: 'Desert dunes at first light, wind-carved ridges, warm haze',
    questions: [{
      id: 'found',
      kind: 'chips',
      multi: false,
      // A Voxel workshop first: the commonest answer should cost no reading.
      // It is also the one that splits customers you already know about from
      // the ones who arrived on their own — the reason this question exists.
      options: [
        'A Voxel workshop', 'Instagram', 'Google', 'A friend or colleague',
        'LinkedIn', 'TikTok', 'An event or conference', 'Somewhere else',
      ],
    }],
  },
  {
    id: 'use',
    title: 'What will you use Voxel for?',
    sub: 'Pick as many as you like — everything stays available either way.',
    // The ONLY screen with no skip: its answers decide where we send them and
    // how much help they get. Skipping leaves us guessing.
    skippable: false,
    art: 'tide',
    caption: 'Slow tide over black volcanic sand, drone pulling back',
    questions: [
      {
        id: 'products',
        kind: 'cards',
        multi: true,
        options: [
          { value: 'images', label: 'Images', hint: 'Photos, art, product shots', to: '/Image' },
          { value: 'videos', label: 'Videos', hint: 'Clips from a description', to: '/Video' },
          { value: 'audio', label: 'Audio', hint: 'Music and voice', to: '/Audio' },
          { value: 'node', label: 'Node canvas', hint: 'Chain steps together', to: '/node' },
        ],
      },
      {
        id: 'experience',
        kind: 'chips',
        multi: false,
        label: 'Used tools like this before?',
        // Plain words, not Beginner / Intermediate / Advanced. People misjudge
        // those labels, and "beginner" is a word nobody enjoys choosing about
        // themselves in a room full of colleagues.
        options: [
          { value: 'first', label: 'First time' },
          { value: 'some', label: 'Tried a few' },
          { value: 'confident', label: 'I know what I’m doing' },
        ],
      },
    ],
  },
  {
    id: 'about',
    title: 'A little about you',
    sub: 'All optional. Skip the lot if you would rather get on with it.',
    skippable: true,
    art: 'atrium',
    caption: 'Glass atrium at dusk, long reflections, one figure walking',
    questions: [
      {
        id: 'usage', kind: 'chips', multi: false, label: 'Work or personal',
        options: ['Work', 'Personal', 'Both', 'I’m a student'],
      },
      // ── THE SHORT ONES FIRST, AND THAT IS THE FIX ────────────────────────
      // The company field used to be last, under two long chip lists — ten
      // roles wrap to three rows and six more wrap to two, so on a normal
      // window it sat below the fold. Amr: "nobody see it... I need to scroll
      // down, so maybe the users cannot see it."
      //
      // An optional field nobody scrolls to is a field nobody fills, and this
      // is the single most valuable answer on the screen: Voxel invoices
      // ORGANISATIONS and holds no record of them.
      //
      // So the two SHORT questions lead — four chips and one input, both one
      // row — and the long lists follow. It reads better as well: work or
      // personal, then which organisation, then what you do there.
      {
        id: 'org', kind: 'text', label: 'Your company or organisation',
        optional: true, placeholder: 'Optional',
        // The most valuable answer on the screen. Voxel invoices ORGANISATIONS
        // and the system holds no record of them, so this links a person to a
        // company from day one instead of rebuilding it from workshop lists.
        max: 120,
      },
      {
        id: 'role', kind: 'chips', multi: false, label: 'What you do',
        // Voxel's roles, not Magnific's. Theirs lists 3D Artist, Illustrator
        // and Developer/IT — a list for an upscaler used by Western studios.
        // These are the jobs people in Amr's rooms actually have.
        options: [
          'Marketing or advertising', 'Social media', 'Business owner', 'Designer',
          'Photographer or videographer', 'Content creator', 'Teacher or trainer',
          'Architecture or real estate', 'Events or production', 'Something else',
        ],
      },
      {
        id: 'making', kind: 'chips', multi: true, label: 'What you will be making',
        options: [
          'Social media content', 'Marketing and ads', 'Product photos',
          'Teaching and training', 'Client work', 'Just exploring',
        ],
      },
    ],
  },
  // ── SCREEN 4 IS NOT HERE YET, AND THAT IS DELIBERATE ─────────────────────
  // It was built and tested: "Now make one yourself", a written prompt and a
  // Generate button. It is not shipping because THE BUTTON DOES NOT GENERATE
  // ANYTHING — it records the answer and closes.
  //
  // On dev that was fine; Amr was testing the questions. On production it would
  // be a brand-new customer pressing a red button labelled Generate, on a
  // prompt we wrote for them, and getting nothing. The product promising
  // something it does not do, on the first screen anybody ever sees.
  //
  // Amr's call, 2026-08-31: ship the three that are finished, then bring this
  // back when the generation is real. It needs a route that runs one free
  // generation, once per account, enforced on the server, on a fixed cheap
  // model — about 25 cents a customer, already approved.
  //
  // Removed from DEV as well as production on purpose. Dev exists so that what
  // he tests is what customers get; a flow that differs between them is how
  // surprises reach people who are paying.
  //
  // To restore: put the screen object back here. STARTER_PROMPTS below is kept
  // ready for it.
];

/**
 * The starter prompts for the last screen.
 *
 * ── PLACEHOLDERS. AMR IS WRITING THE REAL ONES. ────────────────────────────
 * Three rather than one on purpose: twenty people in the same workshop room
 * must not all generate the identical picture. That looks broken, and it kills
 * the one moment this whole flow exists to create.
 *
 * These are mine and should be replaced with prompts Amr knows produce
 * something good — ideally the ones he teaches with.
 */
export const STARTER_PROMPTS = [
  'A calm desert at sunrise, long shadows across the sand, shot on a 35 mm lens',
  'A glass office tower at dusk, warm light in the windows, reflections on wet stone',
  'A close-up of fresh dates and coffee on a brass tray, soft window light',
];

/** Deterministic per user, so a reload shows the same one and two people in a
 *  room are unlikely to share it. */
export function starterFor(userId) {
  const n = Number(userId);
  if (!Number.isFinite(n)) return STARTER_PROMPTS[0];
  return STARTER_PROMPTS[Math.abs(Math.trunc(n)) % STARTER_PROMPTS.length];
}

/** Every question id, flattened — used by the statistics so the chart list and
 *  the question list can never drift apart. */
export const ALL_QUESTIONS = SCREENS.flatMap((s) =>
  s.questions.map((q) => ({ screen: s.id, ...q })));

export const SCREEN_COUNT = SCREENS.length;
