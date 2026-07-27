// ─── sanitize.js ─────────────────────────────────────────────────────────────
// User-facing text scrubbing. Ledger `reason` strings carry INTERNAL provider
// tags ("kie_threw:", "fal_video_threw:", "kie.ai error: …") that the admin
// CRM needs for cost debugging — but end users must never learn which
// upstream providers power Voxel. publicReason() rewrites every provider
// mention to Voxel branding at the API boundary (/api/me/usage), which
// covers ALL history for ALL users instantly without mutating stored data.
//
//   kie_threw: Your reference image could not be prepared…
//     → Voxel_threw: Your reference image could not be prepared…
//   kie_seedance_threw: kie.ai error: Credits insufficient…
//     → Voxel_seedance_threw: voxel-ai.ai error: Credits insufficient…
//   node_run_kie_threw: …  → node_run_Voxel_threw: …
//   fal_video_threw: …     → Voxel_video_threw: …

export function publicReason(reason) {
  if (reason == null) return reason;
  return String(reason)
    // Provider domains first (most specific).
    .replace(/kie\.ai/gi, 'voxel-ai.ai')
    .replace(/fal\.ai/gi, 'voxel-ai.ai')
    // Provider tokens inside snake_case tags: kie_threw, node_run_kie_threw,
    // fal_video_threw, … (underscores are word chars, so \b alone misses
    // the mid-tag case).
    .replace(/(^|_)kie(?=_|\b)/gi, '$1Voxel')
    .replace(/(^|_)fal(?=_|\b)/gi, '$1Voxel')
    // Standalone provider words in prose ("the FAL call failed").
    .replace(/\bkie\b/gi, 'Voxel')
    .replace(/\bfal\b/gi, 'Voxel');
}
