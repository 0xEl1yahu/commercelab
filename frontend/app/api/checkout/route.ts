import { forwardJson, readJsonBody } from "@/lib/proxy";

// POST /api/checkout -> POST /checkout, with the Idempotency-Key passed through.
// The backend's status and body come back unchanged, so the page can tell paid,
// pending, cancelled, 409 and 422 apart; an unreachable backend becomes
// 502 {"detail": "upstream unavailable"}, which the page treats as safe to retry
// with the same key.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const key = request.headers.get("idempotency-key");
  return forwardJson("/checkout", body, key === null ? undefined : { "Idempotency-Key": key });
}
