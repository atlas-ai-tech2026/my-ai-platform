# Handoff: Voxel Image & Video Pages

## Overview
Voxel is an AI media-generation platform (image, video, audio, studio, edit). This handoff covers the **Image generation page**, the **Video generation page (4 directions)**, the **Explore feed**, and the **global navbar with credit button**. All designs share one brand system: Anton display type, near-black backgrounds with red ambient glow, and red `#E01E1E` as the primary accent.

The hero pattern is a transparent **frosted-glass prompt panel** that floats over a gallery of generated media — heavy backdrop blur lets imagery bleed through.

## About the Design Files
The HTML/JSX files in this bundle are **design references**, not production code to ship as-is. They were prototyped in inline-Babel React for fast iteration in the design tool. Your job is to **recreate these designs in the Voxel codebase** using its existing framework, component library, design tokens, and routing — or, if no codebase exists yet, pick the most appropriate stack (Next.js + Tailwind + a headless UI lib is a sensible default for this aesthetic) and implement against that.

Treat the inline styles in the JSX as token specs, not as a styling approach to adopt. Move them into your design system (Tailwind classes, CSS variables, styled-components, etc.) per the team's conventions.

## Fidelity
**High-fidelity.** All colors, type, spacing, radii, shadows, and component states are final. Recreate pixel-perfectly using the codebase's component library.

## Screens / Views

### 1. Image generation page — `Image · GLASS prompt bar (full page)`
File: `voxel-image-glassbar.jsx` → `V_ImageGlassBar`
- **Purpose:** User describes a prompt and generates AI images. Recent generations populate a horizontal gallery; a frosted-glass prompt bar floats at the bottom.
- **Layout:** 1440 × 900. Top navbar (60 px) → hero block (`CREATE WITHOUT LIMITS` Anton 52 px + Flagship pill + History/Saved/Community pills) → horizontal scrolling thumbnail row (gap 12, thumb width 210, heights 290/340) → absolutely-positioned glass prompt bar bottom-center (`min(920px, 94%)`, bottom 28).
- **Glass prompt bar:** `bg rgba(20,18,20,0.38)`, `backdrop-filter: blur(36px) saturate(1.4)`, `border 1px solid rgba(255,255,255,0.08)`, `radius 24`, shadow `0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 60px rgba(224,30,30,0.08)`.
- Top row: `+` add button, red model pill `Cinema · ARRI 35 · 50mm`, T/← controls right.
- Prompt text (Inter/DM Sans 15 px white) with red caret.
- Bottom chip row: model selector (Nano Banana Pro), 16:9, 2K, count 1/4, Negative, Cinematic + GENERATE button.

### 2. Image · GLASS bar close-up
File: `voxel-image-glassbar.jsx` → `V_GlassBarCloseup` (1200 × 720). Same glass bar styling with a left sidebar icon column (square / play / music) and a "Drag to resize" tooltip — used to spec the bar in isolation.

### 3. Video generation page — `V1 · Split sidebar (transparent glass on right)` — **CHOSEN**
File: `voxel-video-pages.jsx` → `V_Video_V1`
- **Purpose:** Frame-to-Video workflow with Kling 3.0. Left side shows a generating hero card + 3-column grid of recent videos. Right side is a glass panel with the prompt + all controls (model, start/end frame, prompt textarea, camera motion, audio/res/duration/ratio, count, Generate).
- **Layout:** Top navbar (60 px). Below: flex row.
  - **Left main (flex:1, padding 24/28):** title block (`Kling 3.0 · Frame to Video` mono caption + `BRING IT TO LIFE` Anton 44) and Creations/Collections pills, then a 3-col grid (gap 12) of 16:9 video tiles. First tile is the generating card — 1 px solid red border, red glow, centered ✦ + progress 97 % bar.
  - **Right glass panel (380 px wide, transparent):** `bg rgba(20,18,20,0.38)`, `backdrop-filter blur(36px) saturate(1.4)`, `border 1px solid rgba(255,255,255,0.10)`, radius 22, margin `20 20 20 0`, padding `20 20 24`, shadow stack as on Image glass bar.
- **Right panel contents (top → bottom):**
  1. Back arrow + label "Frame to Video"
  2. 2-up mode tiles: `Start/End Frame` (red filled active) / `Text`
  3. Model row: blue avatar `K`, "Model / Kling 3.0", chevron
  4. Start / end frame row: filled thumbnail + ⇄ red square + dashed-border "Add end frame" with red `+` chip
  5. Prompt textbox with red ✦ enhance affordance
  6. Camera Motion dropdown row
  7. 4-col options grid: Audio (toggle Off), Res 1080p, Duration 5s, Ratio 16:9
  8. Footer: count stepper `1 / 4` + GENERATE button (red gradient, Anton uppercase)

### 4. Video page — V2, V3, V4 (alternates, kept for reference)
- **V2:** Bento feed + glass panel on the right with segmented Frame→Video / Text→Video, prominent K model row, side-by-side frame picker, chip row.
- **V3:** Cinematic single-preview stage (with timeline), recent strip below, tall right-side glass card with Frame/Text/Extend tabs and list-row options.
- **V4:** Streaming-style category rows (Your Creations / Trending / Cinematic) with a floating glass side-sheet on the right showing the new-video form.

### 5. Explore feed (4 directions) + Global navbar
- `voxel-image-onbrand.jsx`, `explore-v1-editorial.jsx`, `explore-v2-cinematic.jsx`, `explore-v3-rows.jsx`, `explore-v4-bento.jsx`, `voxel-navbar.jsx`. Use whichever the team picks — same brand system applies.

## Interactions & Behavior
- **Generate button:** disabled until prompt non-empty + start frame uploaded; shows credit cost (mono `150 ✦` for image, `400 ✦ / video` for video) on the left.
- **Generating card:** appears in feed slot 1 on submit; shows determinate progress bar (red, glowing) updating from server status; replaces with the finished media when ready.
- **Frame upload:** click `+` → file picker, accept image/*. Drag-to-rearrange between Start and End. ⇄ swaps them.
- **Model picker:** click row → modal/sheet listing models with PRO/NEW badges and per-model credit cost.
- **Camera Motion:** dropdown of presets (Slow push-in, Pan left, Orbit, Static, …) — single select.
- **Tabs (Frame / Text / Extend):** swap the body of the right panel; only Frame requires start-frame upload.
- **History / Saved / Community pills (Image page):** filter the gallery feed; client-side state.
- **Hover:** all chips/buttons gain `+1` brightness on bg via `filter: brightness(1.1)`; the GENERATE button glow intensifies.
- **Glass panel:** does NOT scroll the page; if its content overflows it scrolls internally (`overflow: auto`).

## State Management
- `prompt: string`
- `mode: 'frame' | 'text' | 'extend'`
- `startFrame: File | null`, `endFrame: File | null`
- `model: ModelId` (default `kling-3.0` for video, `nano-banana-pro` for image)
- `cameraMotion: MotionPreset`
- `audio: boolean`, `resolution: '720p' | '1080p' | '4K'`, `duration: 3|5|8|10`, `aspect: '16:9'|'9:16'|'1:1'|'4:5'`
- `count: 1..4`
- `generations: Generation[]` (with status `queued | rendering | done | failed`, progress 0–100)
- `feedFilter: 'all' | 'mine' | 'saved'`
- Server: POST to generation endpoint, poll/stream for progress, append to `generations` on success.

## Design Tokens

### Colors
| Name | Hex | Usage |
|---|---|---|
| `red` | `#E01E1E` | brand primary, accents, badges, GENERATE bg |
| `red-hot` | `#FF2A2A` | top of red gradient |
| `red-deep` | `#8B0F0F` | bottom of red gradient |
| `bg` | `#0A0A0A` | page background |
| `bg-deep` | `#050202` | preview/cinematic bg |
| `glass-fill` | `rgba(20,18,20,0.38)` | dark glass panel |
| `glass-fill-light` | `rgba(255,255,255,0.055)` | white glass (close-up) |
| `glass-border` | `rgba(255,255,255,0.10)` | hairline edge |
| `text` | `#FFFFFF` |  |
| `text-muted` | `rgba(255,255,255,0.65)` | nav inactive |
| `text-dim` | `rgba(255,255,255,0.5)` | captions |

### Typography
- Display: **Anton**, 0.04em letter-spacing, uppercase. Sizes 22/28/40/44/52.
- Body / UI: **DM Sans** (fallback Inter, system). Sizes 11/12/13/14/15.
- Mono / captions: **JetBrains Mono**, letter-spacing 0.10–0.14em, uppercase.
- Editorial italic accent: **Playfair Display** (rare — used for the `T` glyph in glass bar).

### Spacing
4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28. Component padding generally 14–20.

### Radii
4 (badges) / 6 (chips) / 8 / 10 / 12 / 14 / 16 / 18 / 22 (glass panel) / 999 (pills).

### Shadows
- Card: `0 12px 36px rgba(0,0,0,0.5)`
- Lifted card: `0 20px 50px rgba(0,0,0,0.6)`
- Glass panel: `0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 60px rgba(224,30,30,0.08)`
- Red glow CTA: `0 0 28px rgba(224,30,30,0.53), 0 4px 14px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset`
- Active red border accent: `1px solid #E01E1E` + `0 0 30px rgba(224,30,30,0.35)`

### Backdrop filters
- Glass panel: `blur(36px) saturate(1.4)` (dark) or `blur(40px) saturate(1.8)` (white)
- Chips: `blur(20px) saturate(1.4)`
- Navbar: `blur(24px)`

## Assets
- Voxel V-cube wordmark: inline SVG (see `Logo` component in any file). Replace with the official Voxel SVG asset when available.
- Video / image thumbnails in mocks are **placeholder gradients** with synthetic figure silhouettes — replace with real media URLs from the generations API.
- Icons (`+`, `›`, `▾`, `←`, `⇄`, `◎`, `♪`, `▦`, `◷`, `▭`, `✦`) are unicode placeholders — swap to your icon set (Lucide / Phosphor / custom).
- No raster assets ship in this bundle.

## Files
- `voxel-image-onbrand.jsx` — original image page (red border on prompt bar, for comparison)
- `voxel-image-glassbar.jsx` — **chosen image page** (glass prompt bar, full + close-up)
- `voxel-video-pages.jsx` — **all four video directions** (V1 chosen, V1's right panel is now transparent glass to match V2)
- `voxel-navbar.jsx` — global navbar with circular credit button
- `explore-v1-editorial.jsx`, `explore-v2-cinematic.jsx`, `explore-v3-rows.jsx`, `explore-v4-bento.jsx` — Explore page directions
- `direction-1-current.jsx` … `direction-4-glass.jsx` — earlier exploration set, kept for reference
- `Voxel Image Page Directions.html` — top-level canvas wiring all artboards together
- `VOXEL_IMAGE_PAGE_SPEC.md`, `VOXEL_NAVBAR_SPEC.md` — earlier spec docs, still useful for nav/credit-button details
