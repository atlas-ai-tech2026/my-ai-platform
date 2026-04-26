# Voxel Image Page — Design Spec for Claude Code

**Goal:** Bring the real `src/pages/Image.jsx` and `src/components/image/ImagePromptBar.jsx` to match the on-brand mockup below, **exactly**. Do not invent new behavior — only change visuals, copy, and structure. All existing state, API calls (base44, FAL upload, generate), camera selection, smart compose, and history logic must be preserved.

---

## Brand tokens (use these exact values)

```js
const red     = '#E01E1E';   // brand primary
const redHot  = '#FF2A2A';   // bright highlight
const redDeep = '#8B0F0F';   // shadow / deep
const bg      = '#0A0A0A';   // page background
```

**Fonts in use:**
- Anton — display (big model name, GENERATE button)
- DM Sans — body + UI
- JetBrains Mono — monospace / credit counters / category labels / "Rendering 67%"

**No grain / noise anywhere.** The final design is clean — flat color and gradient surfaces only. Do not apply any noise textures, SVG turbulence overlays, or film-grain effects to the background, cards, or any other surface.

---

## Changes to `src/pages/Image.jsx`

### 1. Page background — add red ambient glow layer

Replace the current `background: '#141414'` root with `#0A0A0A` AND add a zero-z-index background layer containing two radial red glows + noise overlay. Content sits above it at `zIndex: 2`.

```jsx
{/* Red ambient glow bg — behind everything */}
<div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
  <div style={{
    position: 'absolute', top: '-20%', right: '-10%', width: 900, height: 900,
    background: 'radial-gradient(circle, rgba(224,30,30,0.28), transparent 60%)',
    filter: 'blur(60px)',
  }} />
  <div style={{
    position: 'absolute', bottom: '-20%', left: '-10%', width: 700, height: 700,
    background: 'radial-gradient(circle, rgba(139,15,15,0.4), transparent 65%)',
    filter: 'blur(60px)',
  }} />
  {/* No noise overlay — keep background clean */}
</div>
```

### 2. Empty state — replace entirely

The current empty state has an isometric SVG cube + huge Anton model name. Replace the whole empty-state block with this **"Model Hero"** layout:

```jsx
{/* Model hero — left-aligned, not centered */}
<div style={{
  position: 'relative', zIndex: 2,
  padding: '20px 28px 0',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
}}>
  <div>
    {/* Small eyebrow label with pulsing dot */}
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontSize: 10.5, color: '#E01E1E',
      fontFamily: '"JetBrains Mono", monospace',
      letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10,
      fontWeight: 600,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: '#E01E1E',
        boxShadow: '0 0 10px #E01E1E',
      }} />
      Flagship · {selectedModel.name}
    </div>

    {/* Huge Anton headline */}
    <div style={{
      fontFamily: 'Anton, sans-serif',
      fontSize: 52, letterSpacing: '0.01em', lineHeight: 0.95,
      color: '#FFF', textTransform: 'uppercase',
    }}>
      CREATE WITHOUT LIMITS
    </div>

    {/* Subtitle */}
    <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', maxWidth: 560 }}>
      {MODEL_SUBTITLES[selectedModel.name] || '4K image generation with cinematic control. Describe anything, generate in seconds.'}
    </div>
  </div>

  {/* Tabs on the right, not top bar */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {['history', 'saved', 'community'].map(tab => (
      <button key={tab} onClick={() => setActiveTab(tab)} style={{
        padding: '7px 14px', fontSize: 12, fontWeight: 500, borderRadius: 999,
        background: activeTab === tab ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${activeTab === tab ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        color: activeTab === tab ? '#FFF' : 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(14px)', cursor: 'pointer', textTransform: 'capitalize',
        fontFamily: '"DM Sans", sans-serif',
      }}>{tab}</button>
    ))}
  </div>
</div>
```

**Important:** Remove the old sticky tabs row at the top. Tabs now live inline with the model hero.

### 3. Image cards — polish

- Card border: `1px solid rgba(255,255,255,0.06)` at rest (not red)
- Card border-radius: `12px` (not 14)
- Card shadow: `'0 12px 36px rgba(0,0,0,0.5)'`
- Each card gets a faint inner radial highlight:
  ```jsx
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: `radial-gradient(ellipse at 30% 70%, rgba(255,255,255,0.18), transparent 55%)`,
  }} />
  ```
- **No noise overlay on cards** — keep card surfaces clean

### 4. "NEW MODEL" pill on first card

If `selectedModel.badge === 'NEW'` and card index is 0, show a small red pill top-left of the card:
```jsx
<div style={{
  position: 'absolute', top: 10, left: 10, zIndex: 3,
  padding: '4px 9px', borderRadius: 4,
  background: '#E01E1E', fontSize: 9, fontWeight: 800,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  fontFamily: '"DM Sans", sans-serif', color: '#FFF',
}}>NEW MODEL</div>
```

### 5. Loading card — red glow treatment

Replace the current shimmer-gradient loading card with:
- Background: `'rgba(20,10,10,0.6)'` + `backdropFilter: 'blur(20px)'`
- Border: `'1px solid #E01E1E'`
- Shadow: `'0 0 30px rgba(224,30,30,0.35), 0 12px 36px rgba(0,0,0,0.5)'`
- Inside: a radial red glow blob (40×40, `filter: blur(8px)`) centered, with a white `✦` on top
- Footer label uses JetBrains Mono: `'RENDERING {pct}%'` in red
- Progress bar: 2px tall, red fill with `boxShadow: '0 0 10px #E01E1E'`

---

## Changes to `src/components/image/ImagePromptBar.jsx`

### 1. Bar container — deeper glass + red tint

```jsx
// REPLACE the outer bar style:
{
  position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
  width: 'min(900px, 94%)',
  background: 'rgba(15,8,8,0.65)',             // ← red-tinted dark glass
  backdropFilter: 'blur(50px) saturate(1.6)',
  WebkitBackdropFilter: 'blur(50px) saturate(1.6)',
  border: '1px solid rgba(224,30,30,0.2)',     // ← faint red border
  borderRadius: 20,
  boxShadow: `
    0 24px 70px rgba(0,0,0,0.6),
    0 0 40px rgba(224,30,30,0.15),              /* red halo */
    0 1px 0 rgba(255,255,255,0.08) inset
  `,
  padding: '14px 16px 12px',
  overflow: 'visible',
  zIndex: 100,
}
```

### 2. Drag handle — brand red at rest

Change default drag-handle color from `rgba(255,255,255,0.22)` to `rgba(224,30,30,0.55)`, width 48px.

### 3. Camera badge — Anton-style red pill

Replace the "INJECTING:" label + small pills treatment with a SINGLE compact red pill summarizing the camera selection:

```jsx
{(cameraSelection?.camera || cameraSelection?.focalLength || cameraSelection?.lens) && (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 9px', borderRadius: 4, marginBottom: 8,
    background: '#E01E1E', color: '#FFF',
    fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    fontFamily: '"DM Sans", sans-serif',
  }}>
    {[cameraSelection.camera?.name, cameraSelection.focalLength, cameraSelection.lens?.name]
      .filter(Boolean).join(' · ')}
  </div>
)}
```

### 4. Textarea — add red blinking caret hint

After the textarea, append a small red underline cursor accent (purely visual):
```jsx
// No change to textarea itself — just make caretColor red:
caretColor: '#E01E1E',
```

### 5. Generate button — Anton red capsule (MAJOR CHANGE)

Replace the current gradient-rectangle Generate button with a **large Anton-uppercase capsule**:

```jsx
<button onClick={handleGenerate} disabled={isGenerating} style={{
  height: 40, padding: '0 22px', borderRadius: 999, border: 'none',
  background: isGenerating
    ? 'rgba(139,15,15,0.6)'
    : 'linear-gradient(180deg, #FF2A2A, #8B0F0F)',
  color: '#FFF', fontSize: 13, fontWeight: 700,
  fontFamily: 'Anton, sans-serif',                // ← Anton!
  letterSpacing: '0.06em', textTransform: 'uppercase',
  display: 'flex', alignItems: 'center', gap: 8,
  cursor: isGenerating ? 'not-allowed' : 'pointer',
  boxShadow: isGenerating ? 'none' : `
    0 0 30px rgba(224,30,30,0.55),
    0 6px 20px rgba(139,15,15,0.5),
    0 1px 0 rgba(255,255,255,0.25) inset
  `,
  transition: 'all 0.2s',
}}>
  <span>{isGenerating ? 'GENERATING' : 'GENERATE'}</span>
  <span style={{ fontSize: 14 }}>→</span>
</button>
```

### 6. Credit indicator beside Generate

Just LEFT of the Generate button, add a small monospace credit counter:
```jsx
<div style={{
  fontSize: 10, color: 'rgba(255,255,255,0.55)',
  fontFamily: '"JetBrains Mono", monospace',
}}>{model.credits} ✦</div>
```
(Pull `credits` from the `IMAGE_MODELS` array entry for the selected model — it's already there: `credits: 150` for Nano Banana Pro, etc.)

### 7. Chips row — tighten red accent on active model chip

On the **model chip only**, when selected, use a red-tinted background:
```jsx
// Model chip when NOT modal-open:
background: 'rgba(224,30,30,0.16)',
border: '1px solid rgba(224,30,30,0.5)',
color: '#FFB5B5',
```
Leave other chips with their current white-transparent style.

---

## What NOT to change

- All FAL upload logic (`uploadAllToFal`, `/api/upload`, `uploadedImages` state)
- `handleGenerate`, `buildFinalPrompt`, `buildCompositionPrompt`, `detectCompositionIntent`
- Base44 `History_` calls
- `CameraSelector` component (just the badge that shows the selection)
- `ModelModal`, `StylePopup`, `AspectDropdown`, `SimpleDropdown` components — they stay as-is
- Image count stepper behavior
- Negative prompt zone behavior (only restyle if trivial)
- `PageSwitcher` component
- Keyboard handling (`handleKey`)
- Drag-to-resize logic

---

## Reference: full mockup source

The canonical React component this spec is derived from lives in the design exploration project and renders exactly what you should match. Key visual contract:

1. Black page (#0A0A0A) with two big red radial glow blobs in corners — clean, no noise
2. Left-aligned model hero: red eyebrow with pulsing dot, huge Anton headline, muted subtitle
3. Tabs (History / Saved / Community) sit right-aligned, inline with hero — NOT a top strip
4. Horizontal scrolling gallery of 200×260 and 200×320 cards, mixed heights
5. First card has "NEW MODEL" red pill top-left, all cards have monospace category label bottom-left
6. Glassy prompt bar at bottom: red-tinted dark glass, red border hairline, Anton red GENERATE capsule
7. Every accent (progress bars, dots, borders, glows) uses `#E01E1E`

When in doubt: **make it feel like a cinema tool, not an AI app**. Anton + red + deep blacks, clean flat surfaces (no grain).
