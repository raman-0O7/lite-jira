import { badRequest } from "@/lib/services/errors";

/**
 * Comment images (docs/features/16-github-sync-and-replies.md "Images"). Only
 * raster formats browsers render safely, identified by their bytes, never by
 * the name or the type the client claims. SVG is excluded: it can carry script.
 */

export const MAX_ATTACHMENTS = 3;
/** Total per comment: Vercel caps request bodies at 4.5 MB. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type UploadedImage = { name: string; contentType: ImageType; data: Buffer };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/** The image type from its magic bytes, or null. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const EXTENSION: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** A display name: no path, no control characters, a sane length, the right extension. */
export function cleanName(name: string, type: ImageType) {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .slice(0, 80);
  return `${base || "image"}.${EXTENSION[type]}`;
}

/** Validate uploaded files into images, or throw a 400 the user can act on. */
export async function readImages(files: File[]): Promise<UploadedImage[]> {
  if (files.length > MAX_ATTACHMENTS) throw badRequest(`Attach at most ${MAX_ATTACHMENTS} images`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw badRequest("Images can be at most 4 MB in total");
  const images: UploadedImage[] = [];
  for (const file of files) {
    const data = Buffer.from(await file.arrayBuffer());
    if (!data.length) throw badRequest(`${file.name || "A file"} is empty`);
    const contentType = sniffImage(data);
    if (!contentType) throw badRequest("Only PNG, JPEG, GIF, and WebP images can be attached");
    images.push({ name: cleanName(file.name, contentType), contentType, data });
  }
  return images;
}
