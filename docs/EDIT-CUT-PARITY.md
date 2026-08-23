# Voxel Edit Cut — feature parity checklist

> **Why this file exists.** On 2026-08-23 the owner asked me to re-check the
> ~29 ChatCut screenshots they had supplied and confirm we match the
> functionality. I could not: the conversation had been compacted and the
> images were no longer in my context. Everything I knew was what I had
> happened to write into code comments and task #31.
>
> That is a bad way to hold a specification. **This file is the durable
> record.** Screenshots get lost; this does not. When the owner clarifies a
> control, it gets written here in the same commit.
>
> **Status honesty rule:** ✅ means built AND seen working in a real browser.
> 🟡 means built but unverified. ⬜ means not built. ❓ means *I do not know
> what this control does* and need the owner to tell me.

Last updated: 2026-08-23

---

## 1. Confirmed from the screenshots — recorded verbatim at the time

These strings were lifted directly from ChatCut's own tooltips while the
images were visible, and are in the code today.

| Control | ChatCut's wording | Ours | Status |
|---|---|---|---|
| Selection tool | `Selection Mode (V)` | same, key `V` | ✅ |
| Trim tool | `Trim Edit Mode (N)` | same, key `N` | ✅ |
| Blade tool | `Blade Edit Mode (B)` | same, key `B` | ✅ |
| Snapping | `Snapping (S)` | same, key `S` | ✅ |
| Track visibility | `Hide track` / `Show track` | same | ✅ |
| Track sound | `Mute track` / `Unmute track` | same | ✅ |
| Track lock | `Lock track` / `Unlock track` | same | ✅ |
| Zoom timeline | `⌘−` / `⌘=` | same | ✅ |
| Fullscreen / big picture | backtick `` ` `` | same | ✅ |
| Split at playhead | `C` | same | ✅ |
| Account menu | `My Projects` | project picker at `/edit` | ✅ |

## 2. Layout decisions taken FROM the screenshots

| Decision | Source | Status |
|---|---|---|
| Left column full height, composer pinned at its bottom | ChatCut's arrangement | ✅ |
| Library column reserves three tabs (assets / uploads / transcript) | ChatCut shows three | 🟡 tabs present, 2 of 3 disabled |
| Aspect ratio lives in the viewer header, not under it | ChatCut puts it there | ✅ |
| Timeline beneath both columns, full width | ChatCut | ✅ |

## 3. Explained by the owner, 2026-08-22 (from my notes, NOT re-verified)

> ⚠️ These come from the summary of a compacted conversation. The wording is
> mine, not the owner's. **Each needs confirming.**

| Control | What I recorded them saying | Status |
|---|---|---|
| "Agents" icon | The agent/chat feature — the ChatCut idea itself | ✅ built 2026-08-23 |
| Slider right of Agents | Motion quality / motion-graphic quality / "generate auto" | ⬜ not built, ❓ needs re-explaining |
| "Desktop" | ChatCut has a desktop app. **Not wanted** | n/a — deliberately skipped |
| "Upgrade" | Their paid plans. **Not wanted** | n/a — deliberately skipped |
| Create new timeline | First button on their timeline toolbar | ⬜ **blocked on the structural decision** |
| Library of Voxel media | Must hold the customer's own generations | ✅ built |

## 4. Known gaps — mine, not disputed

| Feature | Status | Note |
|---|---|---|
| Add a track (+) | ⬜ | `addTrack()` exists but NOTHING in the UI calls it |
| Delete a track | ⬜ | no `removeTrack()` at all |
| Multiple VIDEO layers export | ⬜ | export takes the FIRST video track only — extra ones vanish **silently** |
| Multiple AUDIO layers export | ✅ | already loops and mixes every audio track |
| Text / captions render | ⬜ | export NAMES them as missing rather than dropping them quietly |
| Recording (voiceover / camera / screen) | ⬜ | sources are already generic, so it is additive |
| Colour grading | ⬜ | OPERATIONS map exists for exactly this |
| Library toolbar (search / sort / filter / bins) | ⬜ | |
| Multiple timelines per project | ⬜ | **structural — decide before more server work** |

## 5. Things I need the owner to tell me

1. **Re-send the screenshots**, or confirm section 3 is right. It is the only
   way to do a real gap analysis rather than a remembered one.
2. **The slider right of "Agents"** — I recorded "motion quality, motion
   graphic quality, generate auto" and I do not understand what it does.
3. **Two video layers** — picture-in-picture/overlay, or a stack you cut
   between (B-roll over A-roll)? Different ffmpeg filters.
4. **Does a project hold several timelines?** Cheap now, a migration later.

---

## The rule this file earns

A specification that lives only in chat images is a specification that
evaporates. Anything the owner explains about a control gets written HERE, in
the same commit as the code that implements it — not left in a conversation
that will be summarised away.
