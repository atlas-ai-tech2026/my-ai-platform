# Voxel Edit Cut — feature parity checklist

> **Why this file exists.** On 2026-08-23 the owner asked me to re-check the
> ChatCut screenshots. I could not — the conversation had been compacted and
> the images were gone. They re-sent them, and this file is now the durable
> record so it never has to happen again.
>
> **Everything in section 1–8 was read from the screenshots directly**, tooltip
> by tooltip. Section 9 is what I still do not understand.
>
> **Status rule:** ✅ built AND seen working in a real browser · 🟡 built,
> unverified · ⬜ not built · ⛔ deliberately skipped · ❓ I do not understand it

Last read from screenshots: 2026-08-23

---

## 1. Top bar

| ChatCut | Ours | Status |
|---|---|---|
| Home icon | Voxel nav | ✅ |
| `Desktop` (their desktop app) | — | ⛔ owner said not wanted |
| Project name, centre (`Alert Purple Dingo`) | project name in header | ✅ |
| People icon — collaborators / share | — | ⬜ |
| Undo / Redo | Undo / Redo | ✅ |
| `Versions (⌘S)` — named version history | undo/redo stack only | ⬜ |
| `Workspace` — layout switcher | panel collapse (`` ` ``) | 🟡 different shape |
| `Export` | `Export` | ✅ |
| `Upgrade -51%` + credits + avatar | Voxel account menu | ⛔ their pricing |
| Orange promo banner | — | ⛔ |

## 2. Left column — "AI"

### 2.1 Preset cards — "What do you want to create today?"
Eight cards, then `More >`:
`Talking Head Editing` · `Motion Graphics` · `Seedance 2.5 (PRO)` ·
`Voice Cloning` · `Collage B-roll` · `Product / App Promo` ·
`AI Short Film` · `Explainer Video`

**Ours:** ⬜ not built. Our left column opens straight into the chat.

### 2.2 The composer
| ChatCut | Ours | Status |
|---|---|---|
| `Describe what you'd like to create…` | `Cut the first 3 seconds…` | ✅ |
| **MODE dropdown**: `Agent` / `Video Gen` | Agent only | ⬜ |
| Send button | Send | ✅ |

Six icon buttons along the composer:

| Icon | ChatCut tooltip | Ours | Status |
|---|---|---|---|
| `+` | `Upload` | — | ⬜ |
| cube | `Video generation model` | — | ⬜ |
| waveform | `Voices` | — | ⬜ |
| palette | `Design Style` | — | ⬜ |
| book | `Skills` | — | ⬜ |
| sparkle | `Selection Mode (⌥S)` | — | ❓ see §9 |

### 2.3 `Video Gen` mode
Composer becomes: `+ First Frame`, `+ Last Frame`,
`Describe the video you want Seedance 2.5 to generate…`,
model picker, `Pro` send.

**Ours:** ⬜ — Voxel generates on /video instead. **This is the slider question
the owner asked about — answered below.**

### 2.4 ⭐ AGENT SETTINGS (the slider right of `Agent`)
**This is the control I did not understand.** Now read directly:

| Setting | Options | Ours |
|---|---|---|
| `Thinking Mode` | toggle (off by default) | ⬜ |
| `Motion Graphics Quality` | `Speed` · **`Balance`** · `Quality` | ⬜ |
| `Generation Auto-Allow` | `Motion Graphics` **ON** (badge: `Global`) · `Video Generation` OFF · `Image Generation` OFF | ⬜ ⚠️ |

⚠️ **Generation Auto-Allow is the most important control in these screenshots
for Voxel**, and it is not a cosmetic setting. It decides whether the agent may
spend money WITHOUT ASKING. ChatCut's defaults are exactly right: the free
local thing is on, and both of the things that call a paid model are off.
See the recommendation in §10.

## 3. Middle column — media

| ChatCut | Ours | Status |
|---|---|---|
| Tabs `MY ASSETS` / `LIBRARY` / `TRANSCRIPT` | `From Voxel` / `Uploads` / `Transcript` | ✅ three tabs reserved |
| `Search` box | — | ⬜ |
| `Upload` | — | ⬜ |
| `New Bin` | — | ⬜ |
| `Switch to list view` | grid only | ⬜ |
| `Sort media` | — | ⬜ |
| `Filter media` | — | ⬜ |
| Empty state `This bin is empty` | empty state present | ✅ |

## 4. Viewer

| ChatCut | Ours | Status |
|---|---|---|
| `VIEWER` label | `VIEWER` | ✅ |
| `Drop media here` drag-drop | click-to-add from library | 🟡 no drag-drop |

## 5. Timeline toolbar (left→right, exactly as read)

| Icon | ChatCut tooltip | Ours | Status |
|---|---|---|---|
| `+` | **`Create new timeline`** | — | ⬜ **structural, see §10** |
| arrow | `Selection Mode (V)` | same, key V | ✅ |
| ⧉ | `Trim Edit Mode (N)` | same, key N | ✅ |
| ▤ | `Blade Edit Mode (B)` | same, key B | ✅ |
| ✂ | *(not captured — likely split at playhead)* | `C` splits | 🟡 ❓ |
| 🔗 | `Snapping (S)` | same, key S | ✅ |
| 🎤 + ⌄ | `Record voiceover` | — | ⬜ |
| ▶ | play | Space | ✅ |
| `00:00.00 / 00:00.00` | timecode | ✅ |
| zoom − | `Zoom out (⌘ -)` | same | ✅ |
| slider | zoom slider | continuous zoom | ✅ |
| zoom + | `Zoom in (⌘ =)` | same | ✅ |
| ↔ | `Fit to view (⇧ Z)` | same | ✅ |
| ⧉ | `Aspect Ratio` | in viewer header | ✅ |
| `CC OFF ⌄` | `Show captions` | — | ⬜ |
| ⛶ | `Enter fullscreen (` `)` | same | ✅ |

### 5.1 The `Record` menu (microphone ⌄)
```
RECORD
  ● Voiceover
    Camera
    Screen
  ─────────────
  Microphone  >  System default ✓
  Camera      >  System default ✓
  ─────────────
  3-second countdown ✓
```
**Ours:** ⬜ none of it.

## 6. Track header — ⭐ the owner's question

ChatCut's single track `V1` carries **exactly three** controls:

| Icon | Tooltip | Ours | Status |
|---|---|---|---|
| eye | `Hide track` | `Hide track` / `Show track` | ✅ |
| speaker | `Mute track` | `Mute track` / `Unmute track` | ✅ |
| **trash** | **`Delete track`** | — | ⬜ **CONFIRMED GAP** |

**We also have a lock toggle that ChatCut does not.** Keep it — it is what
makes "the agent refused to cut a locked track" meaningful.

### ⚠️ THE FINDING THE OWNER WILL WANT
**ChatCut has NO "add track" button.** The `+` in the timeline toolbar is
`Create new timeline`, not `add layer`. Their tracks appear when media is
dropped. So the owner's instinct ("I did not see the plus icon to add a
layer") is right that ours is missing something — but what ChatCut actually
ships is **delete per track + tracks created implicitly**, not a + button.

## 7. Account menu

`ATLAS AI / atlas@saltcons…` · `Invite friend` · `Free — Upgrade — 5 credits` ·
`My Projects` ✅ · `Language` ⬜ · `Skin` ⬜ · `Feedback` ⬜ ·
`Keyboard shortcuts` (we show them under the timeline ✅) · `Credits history` ⬜ ·
`Desktop App` ⛔ ·
**`Agent Plugin` → `ChatGPT/Codex` (Copy) · `Claude Code` (Copy)** —
*"Copy an install prompt and paste it into a local ChatGPT/Codex or Claude
Code session."* · `Sign out` ✅

⭐ **`Agent Plugin` is task #32** (the MCP server) already on the board.
Worth knowing a competitor shipped it.

## 8. Misc
`Report a bug or send feedback` (bottom-right) — ⬜

---

## 9. What I still do not understand

1. **The scissors icon** between Blade and Snapping — I never saw its tooltip.
   Probably "split at playhead", but I am not going to guess in a doc whose
   whole point is not guessing.
2. **`Selection Mode (⌥S)`** on the composer's sparkle icon. There is already
   a `Selection Mode (V)` on the timeline. Two different controls, same name,
   different keys. What does the composer one select?
3. **`Skills`** (book icon) — a library of saved instructions? Presets?
4. **`Design Style`** (palette) — applies to motion graphics, or to the whole
   project?
5. **Two video layers** — picture-in-picture, or a stack you cut between?
   (still open, shapes Phase 2's ffmpeg filters)

---

## 10. My recommendation, module by module

**Ranked by value to a Voxel workshop, not by how close it is to ChatCut.**

### Do now — Phase 1 (already started)
| # | Module | Why |
|---|---|---|
| 1 | **Delete track** | Confirmed in ChatCut. Ours has no way to remove a layer at all. |
| 2 | **Add track (+)** | ChatCut has none, but ours needs one: our tracks are NOT created implicitly, so without it a customer is stuck with Video 1 + Audio 1 forever. **Ship it even though ChatCut lacks it.** |
| 3 | **Extra video layers warn on export** | Today they would vanish from the file silently. Non-negotiable. |

### Do next — highest value per hour
| # | Module | Why |
|---|---|---|
| 4 | ⭐ **Generation Auto-Allow** | The agent can spend the customer's credits. `edit-ops.js` already separates free local edits from metered model calls, so the wiring exists. Copy ChatCut's defaults exactly: free ON, paid OFF. **This is the one I would not ship the agent to production without.** |
| 5 | **Library toolbar** — Search / Sort / Filter | The library is the reason to use Voxel's editor over anyone else's, and right now you cannot find anything in it. |
| 6 | **Record: Voiceover / Camera / Screen** | Highest-value missing feature for teaching. Sources are already generic, so it is additive. |
| 7 | **Multiple video layers composite** (Phase 2) | Makes #2 honest. |

### Do after
| # | Module | Why |
|---|---|---|
| 8 | **Bins** (`New Bin`) | Matters once the library is large — same problem as #5, one level up. |
| 9 | **Show captions / captions render** | Export already NAMES captions as missing; this closes it. |
| 10 | **Versions (⌘S)** | We have undo/redo; named versions are a different, weaker need. |
| 11 | **Drag-and-drop onto the viewer** | Nice, not load-bearing. |
| 12 | **Preset cards** | Build LAST and do NOT copy theirs. Ours should be workshop shapes ("Turn my generations into a 30-second reel"), not "Talking Head Editing". |

### Skip
`Desktop App` · `Upgrade` / promo banner / plans · `Skin` · `Invite friend` —
all either owner-rejected or ChatCut's own commercial furniture.

### Already on the board
`Agent Plugin` = task **#32** (MCP server) · `Create new timeline` = the
**structural decision** still open.

---

## The rule this file earns

A specification that lives only in chat images is a specification that
evaporates. Anything the owner explains about a control gets written HERE, in
the same commit as the code that implements it.
