// Shared by the route handlers in app/api/* and app/media/*: pass the backend's
// answer back unchanged, and turn "couldn't reach it at all" into a 502.

import "server-only";

import { apiPost } from "./api";

export function upstreamUnavailable(): Response {
  return Response.json({ detail: "upstream unavailable" }, { status: 502 });
}

/** The request's JSON body, or a 400 Response when it isn't JSON (our own pages always send JSON). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return Response.json({ detail: "request body is not valid JSON" }, { status: 400 });
  }
}

/** POSTs to the backend and returns its status, body and Content-Type unchanged. */
export async function forwardJson(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await apiPost(path, body, headers);
  } catch {
    return upstreamUnavailable();
  }
  const responseHeaders = new Headers({ "cache-control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  try {
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    // The connection dropped while the body was being read.
    return upstreamUnavailable();
  }
}
