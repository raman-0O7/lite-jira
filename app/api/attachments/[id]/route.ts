import { ctxForAttachment } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getAttachment } from "@/lib/services/comments";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/attachments/[id] → the image, for members who can see its issue.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const attachment = await getAttachment(await ctxForAttachment(id), id);
  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
});
