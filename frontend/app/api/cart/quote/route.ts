import { forwardJson, readJsonBody } from "@/lib/proxy";

// POST /api/cart/quote -> POST /cart/quote. The backend's status and body come back
// unchanged; an unreachable backend becomes 502 {"detail": "upstream unavailable"}.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  return forwardJson("/cart/quote", body);
}
