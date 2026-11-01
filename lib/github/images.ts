import { randomUUID } from "node:crypto";

import { githubFetch } from "@/lib/github/client";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, cleanName, sniffImage, type UploadedImage } from "@/lib/attachments";

/**
 * Images in a GitHub issue body (docs/features/16-github-sync-and-replies.md).
 * Dragging an image into a GitHub issue stores it on GitHub and writes
 * `![name](https://github.com/user-attachments/assets/…)` into the body. We
 * find those, copy them into Kanso (so they survive and show to agents), and
 * point the description at the copy. Only GitHub's own hosts are fetched, at
 * every redirect hop, so a body can't make the server request anything else.
 */

const HOSTS = new Set([
  "github.com",
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
]);

const isGitHubUrl = (url: URL) =>
  url.protocol === "https:" && !url.username && !url.password && HOSTS.has(url.hostname);

// ![alt](url "title") and <img ... src="url" ...>
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*<?(https:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi;

export type BodyImage = { url: string; alt: string; match: string };

/** Images in a Markdown/HTML body that live on GitHub, in order, without repeats. */
export function findBodyImages(body: string | null | undefined): BodyImage[] {
  if (!body) return [];
  const found: BodyImage[] = [];
  const seen = new Set<string>();
  const add = (url: string, alt: string, match: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!isGitHubUrl(parsed) || seen.has(url)) return;
    // github.com serves many things; only uploaded assets and raw files are images.
    if (parsed.hostname === "github.com" && !/^\/(user-attachments\/assets\/|[^/]+\/[^/]+\/(raw|blob)\/)/.test(parsed.pathname)) return;
    seen.add(url);
    found.push({ url, alt, match });
  };
  for (const m of body.matchAll(MARKDOWN_IMAGE)) add(m[2]!, m[1]!, m[0]);
  for (const m of body.matchAll(HTML_IMAGE)) {
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? "";
    add(m[1]!, alt, m[0]);
  }
  return found;
}

/** Download one image, following only GitHub redirects. Null if it isn't a usable image. */
async function download(url: string, budget: number): Promise<UploadedImage | null> {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!isGitHubUrl(current)) return null;
    let response: Response;
    try {
      response = await githubFetch(current, { redirect: "manual", headers: { "User-Agent": "Kanso" } });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > budget) return null;
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > budget) return null;
    const contentType = sniffImage(data);
    if (!contentType) return null;
    const last = decodeURIComponent(current.pathname.split("/").pop() ?? "");
    return { name: cleanName(last, contentType), contentType, data };
  }
  return null;
}

/**
 * Download up to MAX_ATTACHMENTS images from a body, within the size budget.
 * Returns each with the markup it came from, so the caller can rewrite it.
 */
export async function fetchBodyImages(body: string | null | undefined) {
  const out: { image: UploadedImage; source: BodyImage }[] = [];
  let budget = MAX_ATTACHMENT_BYTES;
  for (const source of findBodyImages(body)) {
    if (out.length >= MAX_ATTACHMENTS) break;
    const image = await download(source.url, budget);
    if (!image) continue;
    budget -= image.data.length;
    out.push({ image, source });
  }
  return out;
}

/** Replace each copied image's markup in the body with a Markdown image of our copy. */
export function rewriteBody(body: string, copies: { source: BodyImage; attachmentId: string; name: string }[]) {
  let next = body;
  for (const { source, attachmentId, name } of copies) {
    next = next.split(source.match).join(`![${source.alt || name}](/api/attachments/${attachmentId})`);
  }
  return next;
}

/**
 * A GitHub body with its images copied: the rewritten description, and the
 * new images to store. `existing` maps source URLs already copied for this
 * issue (a re-sync reuses them instead of downloading again).
 */
export async function copyBodyImages(
  body: string | null | undefined,
  existing: Map<string, { id: string; name: string }> = new Map(),
) {
  if (!body) return { description: null, images: [] as { id: string; image: UploadedImage; sourceUrl: string }[] };
  const copies: { source: BodyImage; attachmentId: string; name: string }[] = [];
  const images: { id: string; image: UploadedImage; sourceUrl: string }[] = [];
  const fresh: BodyImage[] = [];
  for (const source of findBodyImages(body)) {
    const known = existing.get(source.url);
    if (known) copies.push({ source, attachmentId: known.id, name: known.name });
    else fresh.push(source);
  }
  for (const { image, source } of await fetchBodyImages(fresh.map((s) => s.match).join("\n"))) {
    const id = randomUUID();
    images.push({ id, image, sourceUrl: source.url });
    copies.push({ source, attachmentId: id, name: image.name });
  }
  return { description: rewriteBody(body, copies), images };
}
