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
    res = await fetch('/api/upload', { method: 'POST', body: formData });
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
      const file = new File([blob], `image_${index}_${Date.now()}.png`, { type: 'image/png' });
      const uploadedUrl = await uploadViaServer(file);
      console.log(`[FAL UPLOAD] ✅ Image ${index + 1} uploaded:`, uploadedUrl);
      return uploadedUrl;
    }

    // Base64 data URI
    if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
      console.log(`[FAL UPLOAD] Converting base64 for image ${index + 1}`);
      const response = await fetch(imageSource);
      const blob = await response.blob();
      const file = new File([blob], `image_${index}_${Date.now()}.png`, { type: 'image/png' });
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
