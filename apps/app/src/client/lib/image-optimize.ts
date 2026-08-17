// Client-side image optimization for pasted/dropped images.
//
// Converts raster images (JPEG/PNG/etc.) to WebP and downsizes anything wider
// than MAX_DIM so uploads stay small and fast. Done in the browser with a
// canvas — no server-side decode needed. GIFs and already-WebP files pass
// through untouched.
const MAX_DIM = 1600;
const QUALITY = 0.82;

export async function optimizeImage(file: File): Promise<File> {
  // Non-raster formats pass through — animating GIFs must keep their frames
  // and WebP is already optimized.
  if (file.type === "image/gif" || file.type === "image/webp") return file;
  if (!file.type.startsWith("image/")) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (img.width <= MAX_DIM && img.height <= MAX_DIM && file.type === "image/jpeg") {
      // Small JPEG: re-encoding still buys a little (strips EXIF), but it's
      // not worth the cycles — keep the original.
      return file;
    }

    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Flatten PNG alpha onto white so the WebP encode doesn't darken edges.
    if (file.type === "image/png") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await canvasToBlob(canvas);
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
}
