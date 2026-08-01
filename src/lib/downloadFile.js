// H1 (security audit 2026-07-28): /api/download now requires a JWT, so a
// plain <a href="/api/download?..."> can no longer work (anchors can't send
// an Authorization header). Every download goes through this helper: an
// authorized fetch → blob → programmatic save. Same UX, authenticated.

import { toast } from 'sonner';

const TOKEN_KEY = 'voxel_token';

export async function downloadViaApi(url, filename) {
  if (!url) return false;
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const qs = `url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename || '')}`;
    const res = await fetch(`/api/download?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'voxel-download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return true;
  } catch (err) {
    toast.error(err.message || 'Download failed');
    return false;
  }
}
