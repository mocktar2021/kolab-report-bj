// Request ids (KRB-138). Vercel gives every incoming request an id in
// x-vercel-id, the one its own request logs show, so the app reuses it and
// only makes one up when it is missing (locally). No imports: the
// middleware loads this file on the edge runtime.

/** Set by the middleware on the request (for pages and actions) and on the response (for the user). */
export const REQUEST_ID_HEADER = "x-request-id";

export const VERCEL_ID_HEADER = "x-vercel-id";

/** Anything else in these headers is ignored, so a client cannot fill the logs with junk. */
const ID_FORMAT = /^[\w.:-]{1,128}$/;

type HeaderSource = { get(name: string): string | null };

function validId(value: string | null): string | null {
  return value && ID_FORMAT.test(value) ? value : null;
}

/** The id of a request coming in from outside: Vercel's, else a new one. */
export function incomingRequestId(headers: HeaderSource): string {
  return validId(headers.get(VERCEL_ID_HEADER)) ?? crypto.randomUUID();
}

/** The id the middleware passed down, else Vercel's. Null when there is neither. */
export function forwardedRequestId(headers: HeaderSource): string | null {
  return validId(headers.get(REQUEST_ID_HEADER)) ?? validId(headers.get(VERCEL_ID_HEADER));
}
