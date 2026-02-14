const MAX_AVATAR_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_DIMENSION_PX = 320;
const MAX_AVATAR_DATA_URL_LENGTH = 900_000;

const JPEG_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];
const WEBP_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];

function isJpegFile(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/jpg';
}

function isImageDataUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read image file'));
    };
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Invalid image file'));
    image.src = dataUrl;
  });
}

async function readExifOrientation(file: File): Promise<number> {
  if (!isJpegFile(file)) return 1;

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) {
    return 1;
  }

  let offset = 2;
  while (offset + 3 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if ((marker & 0xFF00) !== 0xFF00) break;
    if (offset + 1 >= view.byteLength) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) break;

    if (marker === 0xFFE1) {
      const segmentStart = offset + 2;
      const segmentEnd = segmentStart + (segmentLength - 2);
      if (segmentEnd > view.byteLength) break;

      if (
        view.getUint8(segmentStart) === 0x45 // E
        && view.getUint8(segmentStart + 1) === 0x78 // x
        && view.getUint8(segmentStart + 2) === 0x69 // i
        && view.getUint8(segmentStart + 3) === 0x66 // f
      ) {
        const tiffOffset = segmentStart + 6;
        if (tiffOffset + 8 > view.byteLength) return 1;

        const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
        const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
        let ifdOffset = tiffOffset + firstIfdOffset;
        if (ifdOffset + 2 > view.byteLength) return 1;

        const entries = view.getUint16(ifdOffset, littleEndian);
        ifdOffset += 2;
        for (let i = 0; i < entries; i += 1) {
          const entryOffset = ifdOffset + i * 12;
          if (entryOffset + 12 > view.byteLength) break;
          const tag = view.getUint16(entryOffset, littleEndian);
          if (tag !== 0x0112) continue;

          const orientation = view.getUint16(entryOffset + 8, littleEndian);
          return orientation >= 1 && orientation <= 8 ? orientation : 1;
        }
      }
      return 1;
    }

    offset += segmentLength;
  }

  return 1;
}

function isOrientationSwapped(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

function applyOrientationTransform(
  context: CanvasRenderingContext2D,
  orientation: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, canvasWidth, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, canvasWidth, canvasHeight);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, canvasHeight);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, canvasWidth, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, canvasWidth, canvasHeight);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, canvasHeight);
      break;
    default:
      break;
  }
}

function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png',
  quality?: number,
): string | null {
  const dataUrl = quality === undefined
    ? canvas.toDataURL(mimeType)
    : canvas.toDataURL(mimeType, quality);
  if (!isImageDataUrl(dataUrl)) return null;
  if (mimeType === 'image/png') {
    return dataUrl.startsWith('data:image/png') ? dataUrl : null;
  }
  return dataUrl.startsWith(`data:${mimeType}`) ? dataUrl : null;
}

function buildOrientedCanvas(
  image: HTMLImageElement,
  orientation: number,
): HTMLCanvasElement {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxDimension = Math.max(sourceWidth, sourceHeight);
  const scale = maxDimension > MAX_AVATAR_DIMENSION_PX
    ? MAX_AVATAR_DIMENSION_PX / maxDimension
    : 1;
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  if (isOrientationSwapped(orientation)) {
    canvas.width = drawHeight;
    canvas.height = drawWidth;
  } else {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not process image');
  }

  applyOrientationTransform(context, orientation, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, drawWidth, drawHeight);
  return canvas;
}

export async function prepareAvatarUploadDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file');
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new Error('Image is too large (max 8MB)');
  }

  const sourceDataUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const orientation = await readExifOrientation(file);
  const canvas = buildOrientedCanvas(image, orientation);
  const hasTransparency = canvasHasTransparency(canvas);

  if (hasTransparency) {
    for (const quality of WEBP_QUALITIES) {
      const webp = encodeCanvas(canvas, 'image/webp', quality);
      if (webp && webp.length <= MAX_AVATAR_DATA_URL_LENGTH) return webp;
    }
    const png = encodeCanvas(canvas, 'image/png');
    if (png && png.length <= MAX_AVATAR_DATA_URL_LENGTH) return png;
    throw new Error('Image is too large after compression. Try a smaller image');
  }

  for (const quality of JPEG_QUALITIES) {
    const jpeg = encodeCanvas(canvas, 'image/jpeg', quality);
    if (jpeg && jpeg.length <= MAX_AVATAR_DATA_URL_LENGTH) return jpeg;
  }
  for (const quality of WEBP_QUALITIES) {
    const webp = encodeCanvas(canvas, 'image/webp', quality);
    if (webp && webp.length <= MAX_AVATAR_DATA_URL_LENGTH) return webp;
  }
  const png = encodeCanvas(canvas, 'image/png');
  if (png && png.length <= MAX_AVATAR_DATA_URL_LENGTH) return png;

  throw new Error('Image is too large after compression. Try a smaller image');
}
