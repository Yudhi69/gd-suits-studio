/**
 * Photos arrive from phones at 4-12 MP. Storing them raw bloats the client
 * file and pushes the AI request past the inline-image limit, so everything is
 * downscaled on the way in. Capture quality is kept high enough to judge
 * cloth texture and skin tone.
 */

const MAX_SIDE = 1800;
const QUALITY = 0.92;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = src;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Downscales to a sane long edge and re-encodes as JPEG. */
export async function normaliseDataUrl(dataUrl, maxSide = MAX_SIDE, quality = QUALITY) {
  const img = await loadImage(dataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, maxSide / longest);

  // Already small enough and already a JPEG - leave it alone.
  if (scale === 1 && dataUrl.startsWith('data:image/jpeg')) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
}

export async function fileToDataUrl(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  return normaliseDataUrl(await readAsDataUrl(file));
}

/** Pulls the first image out of a paste or drop event. */
export function imageFileFrom(event) {
  const items = event.dataTransfer?.items ?? event.clipboardData?.items ?? [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  const files = event.dataTransfer?.files ?? [];
  return [...files].find((f) => f.type.startsWith('image/')) ?? null;
}
