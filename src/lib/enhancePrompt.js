const COMPOSITION_KEYWORDS = [
  'add', 'put', 'place', 'insert', 'move', 'transfer', 'swap', 'replace',
  'second image', 'first image', 'image 1', 'image 2', 'image 3',
  'background', 'character', 'person', 'subject', 'object',
  'into', 'onto', 'from the', 'take the', 'combine',
];

export function detectCompositionIntent(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  return COMPOSITION_KEYWORDS.some(kw => lower.includes(kw));
}

export function buildCompositionPrompt(userPrompt, imageCount) {
  if (imageCount < 2) return userPrompt;

  const isComposition = detectCompositionIntent(userPrompt);
  if (!isComposition) return userPrompt;

  return `You have ${imageCount} reference images provided in the image_urls array.
Image 1: This is the BACKGROUND SCENE — the environment, lighting, and setting to preserve.
Image 2: This is the SUBJECT — the exact person or character to composite into Image 1.
${imageCount > 2 ? `Images 3 to ${imageCount}: Additional style or reference images.` : ''}

CRITICAL INSTRUCTIONS:
- You MUST use the EXACT person from Image 2. Do NOT generate or imagine a new person.
- Place the person from Image 2 into the scene from Image 1.
- Match the lighting direction, shadows, color temperature, and perspective of Image 1 exactly.
- The person's face, body, and clothing must be preserved exactly as they appear in Image 2.
- Do not alter the background from Image 1.

User request: ${userPrompt}`;
}

// Keep old name as alias for backward compatibility
export const enhancePrompt = buildCompositionPrompt;
