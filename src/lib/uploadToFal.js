// File extension matching a MIME type. Only used for a human-friendly
// filename — the server validates the real bytes, not the extension.
export function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('avif')) return 'avif';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') && m.startsWith('audio')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'png';
}

/**
 * Turn a `data:` URI into a File WITHOUT fetch().
 *
 * fetch('data:…') is blocked by our CSP (connect-src is "'self' blob:
 * https:"), which surfaced as an opaque "Failed to fetch" and made pasted
 * / base64 images impossible to upload. Decoding with atob needs no network
 * request, so it is immune to CSP — and avoids a pointless round trip.
 *
 * The declared MIME type is taken FROM THE URI rather than hardcoded, so it
 * always matches the real bytes; the server rejects a mismatch with 415.
 */
export function dataUriToFile(dataUri, baseName = 'image') {
  const comma = dataUri.indexOf(',');
  if (comma === -1) throw new Error('Malformed data URI');
  const header = dataUri.slice(5, comma);          // strip leading "data:"
  const payload = dataUri.slice(comma + 1);
  const mime = (header.split(';')[0] || 'image/png').trim() || 'image/png';
  const isBase64 = /;base64/i.test(header);

  let bytes;
  if (isBase64) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    // Percent-encoded (e.g. data:image/svg+xml,<svg …>)
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return new File([bytes], `${baseName}.${extForMime(mime)}`, { type: mime });
}

async function uploadViaServer(file) {
  // Pre-check: warn locally before the request even goes out
  const MAX_BYTES = 100 * 1024 * 1024; // backend multer limit
  if (file?.size > MAX_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 100 MB.`);
  }

  const formData = new FormData();
  formData.append('file', file);

  let res, data;
  try {
    // H2: /api/upload requires auth. Only the Authorization header is set —
    // the browser must supply its own multipart boundary Content-Type.
    const token = localStorage.getItem('voxel_token');
    res = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
  } catch (netErr) {
    throw new Error(`Network error: ${netErr.message}`);
  }

  // Handle non-JSON responses (e.g. multer file-too-large = HTML 413)
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(
      res.status === 413
        ? 'File too large (server rejected). Max 100 MB.'
        : `Upload failed (HTTP ${res.status}): ${text.slice(0, 160) || 'server error'}`
    );
  }

  data = await res.json().catch(() => ({}));

  if (!res.ok || !data.url) {
    // Surface the actual server error message instead of a generic line
    const reason = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return data.url;
}

export async function prepareImageForFal(imageSource, index) {
  console.log(`[FAL UPLOAD] Processing image ${index + 1}:`, typeof imageSource);

  try {
    // Already a fal URL
    if (typeof imageSource === 'string' &&
        (imageSource.includes('fal.media') || imageSource.includes('fal.run'))) {
      console.log(`[FAL UPLOAD] Image ${index + 1} already on fal storage`);
      return imageSource;
    }

    // Blob URL
    if (typeof imageSource === 'string' && imageSource.startsWith('blob:')) {
      console.log(`[FAL UPLOAD] Converting blob URL for image ${index + 1}`);
      const response = await fetch(imageSource);
      const blob = await response.blob();
      // Keep the blob's REAL type. Hardcoding image/png here would make the
      // declared type disagree with the actual bytes, which the server's
      // content-type check (H2) correctly rejects with a 415.
      const type = blob.type || 'image/png';
      const file = new File([blob], `image_${index}_${Date.now()}.${extForMime(type)}`, { type });
      const uploadedUrl = await uploadViaServer(file);
      console.log(`[FAL UPLOAD] ✅ Image ${index + 1} uploaded:`, uploadedUrl);
      return uploadedUrl;
    }

    // Base64 data URI
    if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
      console.log(`[FAL UPLOAD] Converting base64 for image ${index + 1}`);
      // Decoded in JS rather than via fetch(dataUri): the CSP's connect-src
      // is "'self' blob: https:", so fetching a data: URI is BLOCKED and
      // surfaced as an opaque "Failed to fetch". Decoding locally needs no
      // network request at all, so it works regardless of CSP — and is
      // faster. (Production bug, 2026-08-01.)
      const file = dataUriToFile(imageSource, `image_${index}_${Date.now()}`);
      const uploadedUrl = await uploadViaServer(file);
      console.log(`[FAL UPLOAD] ✅ Image ${index + 1} uploaded:`, uploadedUrl);
      return uploadedUrl;
    }

    // File or Blob object
    if (imageSource instanceof File || imageSource instanceof Blob) {
      console.log(`[FAL UPLOAD] Uploading File object for image ${index + 1}`);
      const uploadedUrl = await uploadViaServer(imageSource);
      console.log(`[FAL UPLOAD] ✅ Image ${index + 1} uploaded:`, uploadedUrl);
      return uploadedUrl;
    }

    // Regular public URL — return as-is
    if (typeof imageSource === 'string' && imageSource.startsWith('http')) {
      console.log(`[FAL UPLOAD] Image ${index + 1} is public URL, passing through`);
      return imageSource;
    }

    console.error(`[FAL UPLOAD] ❌ Unknown image source type for image ${index + 1}:`, typeof imageSource);
    return null;

  } catch (error) {
    console.error(`[FAL UPLOAD] ❌ Failed to upload image ${index + 1}:`, error);
    throw error;
  }
}

export async function uploadAllToFal(imageSources) {
  console.log(`[FAL UPLOAD] Starting upload of ${imageSources.length} image(s)`);
  const results = await Promise.all(
    imageSources.map((src, i) => prepareImageForFal(src, i))
  );
  const valid = results.filter(Boolean);
  console.log(`[FAL UPLOAD] ✅ ${valid.length}/${imageSources.length} images ready`);
  return valid;
}
