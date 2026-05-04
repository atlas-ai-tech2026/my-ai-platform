// Full ElevenLabs premade voice catalogue (May 2026 snapshot).
//
// All ~35 official library voices with their stable voice_ids. We pass
// the `name` to the FAL `voice` field — FAL accepts both names and IDs
// for premade voices. The `voice_id` is here for posterity and for the
// inevitable future "select by ID" flow.
//
// IMPORTANT — Arabic / multilingual support:
// Every voice in this list works with Eleven V3 and Multilingual V2.
// Both models speak ~30 languages including Arabic, Spanish, French,
// German, Hindi, Japanese, etc. The voice = the timbre/personality of
// the speaker. The language picker decides what language they speak.
// So to hear Rachel speak Arabic: pick "Rachel" + Language → Arabic.
//
// `gradient` is purely decorative for the avatar — gives each voice a
// distinct hue so the picker reads at a glance.

export const VOICES = [
  // Featured (top of list — well-known defaults)
  { name: 'Rachel',    voice_id: '21m00Tcm4TlvDq8ikWAM', desc: 'Warm, conversational',     gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #d96b3a, #6e2a14)', seed: 33  },
  { name: 'Adam',      voice_id: 'pNInz6obpgDQGcFmaJgB', desc: 'Deep, calm',               gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #5a3a8e, #2a1a4e)', seed: 7   },
  // Bella was removed: her voice_id was duplicated with Sarah's, and we
  // can't verify the current canonical ID without ElevenLabs API access.
  // Add back once xi-api-key integration lands and we fetch /v1/voices.
  { name: 'Antoni',    voice_id: 'ErXwobaYiN019PkySvjV', desc: 'Smooth, mid-range',        gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #4a7ad9, #1a2e6b)', seed: 41  },
  { name: 'Domi',      voice_id: 'AZnzlk1XvdvUeBnXmlld', desc: 'Confident, narrative',     gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #3aa8b0, #1a4a4e)', seed: 21  },

  // American
  { name: 'Drew',      voice_id: '29vD33N1CtxCmqQRPOHJ', desc: 'Well-rounded, news',       gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #3a8edb, #1a4e8e)', seed: 49  },
  { name: 'Clyde',     voice_id: '2EiwWnXFnvU5JabPnv8n', desc: 'War veteran, gritty',      gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #8e3a3a, #4e1a1a)', seed: 57  },
  { name: 'Paul',      voice_id: '5Q0t7uMcjvnagumLfvZi', desc: 'Live commentator',         gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #b07a3a, #4e3a1a)', seed: 65  },
  { name: 'Sarah',     voice_id: 'EXAVITQu4vr4xnSDxMaL', desc: 'Soft, news anchor',        gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #d99c5a, #6e5024)', seed: 73  },
  { name: 'Thomas',    voice_id: 'GBv7mTt0atIp3Br8iCZE', desc: 'Calm, meditation',         gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #3a8e8e, #1a4e4e)', seed: 81  },
  { name: 'Emily',     voice_id: 'LcfcDJNUP1GQjkzn1xUU', desc: 'Calm, meditation',         gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #b04ad9, #4e1a6e)', seed: 89  },
  { name: 'Elli',      voice_id: 'MF3mGyEYCl7XYWbV9V6O', desc: 'Young, emotional',         gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #b0c54a, #4e5a1a)', seed: 53  },
  { name: 'Callum',    voice_id: 'N2lVS1w4EtoT3dr4eOWO', desc: 'Hoarse, gravelly',         gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #6e6e6e, #2e2e2e)', seed: 97  },
  { name: 'Patrick',   voice_id: 'ODq5zmih8GrVes37Dizd', desc: 'Shouty, intense',          gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #c93a3a, #5e1414)', seed: 105 },
  { name: 'Harry',     voice_id: 'SOYHLrjzK2X1ezoPC6cr', desc: 'Anxious, edgy',            gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #8e4a3a, #4e1e14)', seed: 113 },
  { name: 'Liam',      voice_id: 'TX3LPaxmHKxFdv7VOQHJ', desc: 'Articulate',               gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #4a8e6e, #1e4e3a)', seed: 121 },
  { name: 'Josh',      voice_id: 'TxGEqnHWrfWFTfGW9XjX', desc: 'Deep, authoritative',      gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #3a5edc, #1a2e8e)', seed: 65  },
  { name: 'Arnold',    voice_id: 'VR6AewLTigWG4xSOukaG', desc: 'Crisp, narrator',          gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #6b3a8e, #2a1a4e)', seed: 77  },
  { name: 'Matilda',   voice_id: 'XrExE9yKIg1WjnnlVkGX', desc: 'Pleasant',                 gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #d96bb0, #6e2a4e)', seed: 137 },
  { name: 'Jeremy',    voice_id: 'bVMeCyTHy58xNoL34h3p', desc: 'Excited',                  gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #d9b03a, #6e5414)', seed: 145 },
  { name: 'Michael',   voice_id: 'flq6f7yk4E4fJM5XTYuZ', desc: 'Orotund',                  gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #4a3aae, #1e1a4e)', seed: 153 },
  { name: 'Ethan',     voice_id: 'g5CIjZEefAph4nQFvHAz', desc: 'Whispery',                 gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #6e6ea0, #2e2e4e)', seed: 161 },
  { name: 'Gigi',      voice_id: 'jBpfuIE2acCO8z3wKNLl', desc: 'Childish, animated',       gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #d99c5a, #6e3a1a)', seed: 169 },
  { name: 'Freya',     voice_id: 'jsCqWAovK2LkecY7zXl4', desc: 'Energetic, expressive',    gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #c54aa0, #5a1a4e)', seed: 177 },
  { name: 'Brian',     voice_id: 'nPczCjzI2devNBz1zQrb', desc: 'Deep, mature',             gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #3a4a8e, #1a1e4e)', seed: 185 },
  { name: 'Grace',     voice_id: 'oWAxZDx7w5VEj9dCyTzz', desc: 'Southern, gentle',         gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #d9b06b, #6e5024)', seed: 193 },
  { name: 'Serena',    voice_id: 'pMsXgVXv3BLzUgSXRplE', desc: 'Pleasant, narrator',       gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #b03a8e, #4e1a3e)', seed: 201 },
  { name: 'Nicole',    voice_id: 'piTKgcLEGmPE4e6mEKli', desc: 'Whispery, ASMR',           gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #b0498a, #4e1a3e)', seed: 89  },
  { name: 'Bill',      voice_id: 'pqHfZKP75CvOlQylNhV4', desc: 'Friendly, mature',         gender: 'M', accent: 'American',   gradient: 'linear-gradient(135deg, #3a8e6b, #1a4e3e)', seed: 113 },
  { name: 'Glinda',    voice_id: 'z9fAnlkpzviPz146aGWa', desc: 'Witch, theatrical',        gender: 'F', accent: 'American',   gradient: 'linear-gradient(135deg, #6e3a8e, #2e1a4e)', seed: 209 },

  // British
  { name: 'Dave',      voice_id: 'CYw3kZ02Hs0563khs1Fj', desc: 'Conversational',           gender: 'M', accent: 'British',    gradient: 'linear-gradient(135deg, #4a6ea0, #1e2e4e)', seed: 217 },
  { name: 'George',    voice_id: 'JBFqnCBsd6RMkjVDRZzb', desc: 'Warm, raconteur',          gender: 'M', accent: 'British',    gradient: 'linear-gradient(135deg, #b06b3a, #4e2a14)', seed: 225 },
  { name: 'Dorothy',   voice_id: 'ThT5KcBeYPX3keUQqHPh', desc: 'Pleasant',                 gender: 'F', accent: 'British',    gradient: 'linear-gradient(135deg, #b0d96b, #4e6e2a)', seed: 233 },
  { name: 'Charlotte', voice_id: 'XB0fDUnXU5powFXDhCwa', desc: 'Sultry, mature',           gender: 'F', accent: 'British',    gradient: 'linear-gradient(135deg, #a83a3a, #4e1414)', seed: 101 },
  { name: 'Matthew',   voice_id: 'Yko7PKHZNXotIFUBG7I9', desc: 'Casual',                   gender: 'M', accent: 'British',    gradient: 'linear-gradient(135deg, #6b8e3a, #2e4e1a)', seed: 241 },
  { name: 'Joseph',    voice_id: 'Zlb1dXrM653N07WRdFW3', desc: 'Articulate',               gender: 'M', accent: 'British',    gradient: 'linear-gradient(135deg, #3a8eb0, #1a4e6e)', seed: 249 },
  { name: 'Daniel',    voice_id: 'onwK4e9ZLuTAKqWW03F9', desc: 'Strong, news',             gender: 'M', accent: 'British',    gradient: 'linear-gradient(135deg, #2e4a8e, #14264e)', seed: 257 },
  { name: 'Lily',      voice_id: 'pFZP5JQG7iQjIQuC4Bku', desc: 'Young, expressive',        gender: 'F', accent: 'British',    gradient: 'linear-gradient(135deg, #d96b8a, #6e2a3e)', seed: 265 },

  // Australian
  { name: 'Charlie',   voice_id: 'IKne3meq5aSn9XLyUdCD', desc: 'Casual, conversational',   gender: 'M', accent: 'Australian', gradient: 'linear-gradient(135deg, #d99c3a, #6e5014)', seed: 125 },
  { name: 'James',     voice_id: 'ZQe5CZNOzWyzPSCn5a3c', desc: 'Husky, calm',              gender: 'M', accent: 'Australian', gradient: 'linear-gradient(135deg, #6e3a3a, #2e1414)', seed: 273 },

  // Irish
  { name: 'Fin',       voice_id: 'D38z5RcWu1voky8WS1ja', desc: 'Old, wise sailor',         gender: 'M', accent: 'Irish',      gradient: 'linear-gradient(135deg, #4a8e3a, #1e4e14)', seed: 281 },

  // Swedish
  { name: 'Mimi',      voice_id: 'zrHiDhphv9ZnVXBqCLjz', desc: 'Childish',                 gender: 'F', accent: 'Swedish',    gradient: 'linear-gradient(135deg, #b0c5d9, #4e6e8e)', seed: 289 },
];

export const ACCENTS = ['All', 'American', 'British', 'Australian', 'Irish', 'Swedish'];

// Short text used when previewing a voice from the picker (▶ button).
// Kept short on purpose — TTS billing is per character, and the user
// usually clicks several voices while shopping for one.
export const PREVIEW_TEXT = 'Hi! This is a quick voice preview. You can pick this voice to read your script.';
