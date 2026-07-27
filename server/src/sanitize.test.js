import { describe, it, expect } from 'vitest';
import { publicReason } from './sanitize.js';

describe('publicReason (user-visible provider scrubbing)', () => {
  it('matches the owner-specified before/after examples exactly', () => {
    expect(publicReason('kie_threw: Your reference image could not be prepared — please try again in a moment'))
      .toBe('Voxel_threw: Your reference image could not be prepared — please try again in a moment');
    expect(publicReason("kie_seedance_threw: kie.ai error: Credits insufficient : Your current balance isn't enough to run this request. Please top up to continue."))
      .toBe("Voxel_seedance_threw: voxel-ai.ai error: Credits insufficient : Your current balance isn't enough to run this request. Please top up to continue.");
  });

  it('rewrites every provider tag variant the codebase writes', () => {
    const cases = {
      'kie_threw: x': 'Voxel_threw: x',
      'kie_video_threw: x': 'Voxel_video_threw: x',
      'kie_seedance_threw: x': 'Voxel_seedance_threw: x',
      'node_run_kie_threw: x': 'node_run_Voxel_threw: x',
      'node_async_kie_threw: x': 'node_async_Voxel_threw: x',
      'fal_threw: x': 'Voxel_threw: x',
      'fal_video_threw: x': 'Voxel_video_threw: x',
      'fal_tts_threw: x': 'Voxel_tts_threw: x',
      'fal_music_threw: x': 'Voxel_music_threw: x',
      'fal_motion_control_threw: x': 'Voxel_motion_control_threw: x',
      'fal_video_edit_omni_threw: x': 'Voxel_video_edit_omni_threw: x',
      'fal_empty_result: x': 'Voxel_empty_result: x',
    };
    for (const [input, want] of Object.entries(cases)) {
      expect(publicReason(input)).toBe(want);
    }
  });

  it('rewrites provider mentions in prose and domains', () => {
    expect(publicReason('the FAL call failed')).toBe('the Voxel call failed');
    expect(publicReason('refund from kie for failed video')).toBe('refund from Voxel for failed video');
    expect(publicReason('see FAL.ai and KIE.AI')).toBe('see voxel-ai.ai and voxel-ai.ai');
  });

  it('leaves clean strings and non-provider words untouched', () => {
    expect(publicReason('video: Kling 3.0')).toBe('video: Kling 3.0');
    expect(publicReason('image: Nano Banana Pro')).toBe('image: Nano Banana Pro');
    expect(publicReason('fallback logic ran')).toBe('fallback logic ran'); // "fallback" ≠ "fal"
    expect(publicReason('promo: VOXEL-AB12-CD34')).toBe('promo: VOXEL-AB12-CD34');
    expect(publicReason(null)).toBeNull();
  });
});
