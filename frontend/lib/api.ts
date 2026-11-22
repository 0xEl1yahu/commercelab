// The only way server code talks to the FastAPI backend.
//
// API_URL is read here, on the server, at request time. It never reaches the
// browser: `server-only` makes importing this module from a Client Component a
// build error. The browser talks only to Next.js (pages, /api/*, /media/*).

import "server-only";

import { notFound } from "next/navigation";

const DEFAULT_API_URL = "http://127.0.0.1:8000";

function apiUrl(path: string): string {
  const base = (process.env.API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  return base + (path.startsWith("/") ? path : `/${path}`);
}

/** A non-2xx answer from the backend. `message` carries the backend's `detail` when it sent one. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Query = Record<string, string | string[] | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function errorMessage(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`.trim();
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const { detail } = body as { detail: unknown };
      return typeof detail === "string" ? detail : JSON.stringify(detail);
    }
  } catch {
    // Not JSON: the status line is all there is.
  }
  return fallback;
}

/**
 * GET a JSON resource, uncached (stock and prices change between requests).
 * Repeated values in `query` become repeated parameters (`brand=a&brand=b`);
 * undefined values are left out.
 *
 * Throws ApiError on a non-2xx response. If the backend can't be reached at all,
 * fetch's own error propagates, so the page fails and app/error.tsx is shown.
 */
export async function apiGet<T>(path: string, options?: { query?: Query }): Promise<T> {
  const res = await fetch(apiUrl(withQuery(path, options?.query)), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}

/** POST a JSON body and hand back the backend's Response as it is, whatever its status. */
export function apiPost(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Turns a backend 404 into the app's 404 page (not-found.tsx); every other failure is rethrown. */
export function notFoundOn404<T>(p: Promise<T>): Promise<T> {
  return p.catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
}

/** A plain fetch against the backend, for the media proxy. `init` is passed through. */
export function apiFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { cache: "no-store", ...init });
}
