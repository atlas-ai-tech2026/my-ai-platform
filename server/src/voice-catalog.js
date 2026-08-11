// ─── voice-catalog.js ────────────────────────────────────────────────────────
// N7 (recheck 2026-08-03): /api/tts/preview forwarded the caller's `voice`
// string straight to FAL, and cached the result under that same string. Since
// the route needs no login, anyone could send an endless stream of made-up
// voice ids — every one a cache MISS, so every one a real, billable FAL call,
// and every one a permanent entry in a Map that was never evicted.
//
// Validating against the real catalogue puts a hard ceiling on the damage:
// only these voices can ever be requested, so once each has been previewed
// once, every future request for the lifetime of the platform is a cache hit.
// That is a stronger guarantee than requiring a login would have given — a
// signed-up account could still have burned money — and it keeps the public
// preview, which exists on purpose so visitors can hear a voice before they
// sign up.
//
// GENERATED from src/components/audio/voices.js. voice-catalog.test.js fails
// if the two ever drift, so adding a voice to the UI cannot silently make it
// unpreviewable.

/** [voice_id, name] for every voice the picker offers. */
const CATALOG = [
  ['21m00Tcm4TlvDq8ikWAM', 'Rachel'],
  ['pNInz6obpgDQGcFmaJgB', 'Adam'],
  ['ErXwobaYiN019PkySvjV', 'Antoni'],
  ['AZnzlk1XvdvUeBnXmlld', 'Domi'],
  ['29vD33N1CtxCmqQRPOHJ', 'Drew'],
  ['2EiwWnXFnvU5JabPnv8n', 'Clyde'],
  ['5Q0t7uMcjvnagumLfvZi', 'Paul'],
  ['EXAVITQu4vr4xnSDxMaL', 'Sarah'],
  ['GBv7mTt0atIp3Br8iCZE', 'Thomas'],
  ['LcfcDJNUP1GQjkzn1xUU', 'Emily'],
  ['MF3mGyEYCl7XYWbV9V6O', 'Elli'],
  ['N2lVS1w4EtoT3dr4eOWO', 'Callum'],
  ['ODq5zmih8GrVes37Dizd', 'Patrick'],
  ['SOYHLrjzK2X1ezoPC6cr', 'Harry'],
  ['TX3LPaxmHKxFdv7VOQHJ', 'Liam'],
  ['TxGEqnHWrfWFTfGW9XjX', 'Josh'],
  ['VR6AewLTigWG4xSOukaG', 'Arnold'],
  ['XrExE9yKIg1WjnnlVkGX', 'Matilda'],
  ['bVMeCyTHy58xNoL34h3p', 'Jeremy'],
  ['flq6f7yk4E4fJM5XTYuZ', 'Michael'],
  ['g5CIjZEefAph4nQFvHAz', 'Ethan'],
  ['jBpfuIE2acCO8z3wKNLl', 'Gigi'],
  ['jsCqWAovK2LkecY7zXl4', 'Freya'],
  ['nPczCjzI2devNBz1zQrb', 'Brian'],
  ['oWAxZDx7w5VEj9dCyTzz', 'Grace'],
  ['pMsXgVXv3BLzUgSXRplE', 'Serena'],
  ['piTKgcLEGmPE4e6mEKli', 'Nicole'],
  ['pqHfZKP75CvOlQylNhV4', 'Bill'],
  ['z9fAnlkpzviPz146aGWa', 'Glinda'],
  ['CYw3kZ02Hs0563khs1Fj', 'Dave'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George'],
  ['ThT5KcBeYPX3keUQqHPh', 'Dorothy'],
  ['XB0fDUnXU5powFXDhCwa', 'Charlotte'],
  ['Yko7PKHZNXotIFUBG7I9', 'Matthew'],
  ['Zlb1dXrM653N07WRdFW3', 'Joseph'],
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel'],
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily'],
  ['IKne3meq5aSn9XLyUdCD', 'Charlie'],
  ['ZQe5CZNOzWyzPSCn5a3c', 'James'],
  ['D38z5RcWu1voky8WS1ja', 'Fin'],
  ['zrHiDhphv9ZnVXBqCLjz', 'Mimi'],
];

/** Accept either the stable id (what the picker sends) or the display name
 *  (what the FAL resolver also understands). Case-insensitive on names. */
const VALID = new Set([
  ...CATALOG.map(([id]) => id),
  ...CATALOG.map(([, name]) => name.toLowerCase()),
]);

export const VOICE_COUNT = CATALOG.length;

export function isKnownVoice(voice) {
  if (typeof voice !== 'string') return false;
  const v = voice.trim();
  if (!v) return false;
  return VALID.has(v) || VALID.has(v.toLowerCase());
}

export const VOICE_IDS = CATALOG.map(([id]) => id);
