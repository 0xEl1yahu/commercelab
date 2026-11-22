import { apiFetchRaw } from "@/lib/api";
import { upstreamUnavailable } from "@/lib/proxy";

// GET /media/{key} -> GET /images/{key}. The image bytes live in PostgreSQL; this
// proxy keeps the backend URL out of the browser. If-None-Match goes through, and
// the status, body, Content-Type, Cache-Control and ETag come back unchanged
// (the backend marks images immutable: a key is the sha256 of its bytes).
const PASSED_BACK = ["content-type", "cache-control", "etag"] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const headers = new Headers();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null) headers.set("if-none-match", ifNoneMatch);

  let upstream: Response;
  try {
    // Encoded, so a key can never climb out of /images/ ("..%2Fproducts").
    upstream = await apiFetchRaw(`/images/${encodeURIComponent(key)}`, { headers });
  } catch {
    return upstreamUnavailable();
  }

  const responseHeaders = new Headers();
  for (const name of PASSED_BACK) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  const bodyless = upstream.status === 304 || upstream.status === 204;
  try {
    return new Response(bodyless ? null : await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return upstreamUnavailable();
  }
}
