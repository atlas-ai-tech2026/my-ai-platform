async function uploadViaServer(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.url) throw new Error('Upload returned no URL');
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
