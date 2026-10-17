import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { createLogger } from "./format";
import { forwardedRequestId, incomingRequestId, REQUEST_ID_HEADER } from "./request-id";

// Server logs (KRB-138). Every line of a request carries the same request
// id, so the id a user quotes finds all of them in the Vercel logs:
// - pages and server actions: the id the proxy passes in x-request-id,
//   read with headers();
// - route handlers, which the proxy skips: the id withRequestId gives.
// What reaches a line, and what never does, is in ./format.ts.

export type { LogFields, Logger } from "./format";

const routeRequestIds = new AsyncLocalStorage<string>();

async function idFromHeaders(): Promise<string | null> {
  try {
    return forwardedRequestId(await headers());
  } catch {
    // Outside a request (startup, tests), or in after() of a page, where
    // headers() throws.
    return null;
  }
}

function currentRequestId(): string | null | Promise<string | null> {
  return routeRequestIds.getStore() ?? idFromHeaders();
}

/**
 * The id of the request being served: the one the proxy set for pages
 * and server actions, the one withRequestId set for route handlers. Null
 * outside a request. Like headers(), calling it (or logging) while a page
 * renders makes that page dynamic.
 */
export async function getRequestId(): Promise<string | null> {
  return currentRequestId();
}

/**
 * Gives a route handler under /api its request id: Vercel's x-vercel-id,
 * else a new one. It holds for everything the handler starts, streamed work
 * and after() included, and goes back in the x-request-id response header.
 */
export function withRequestId<Req extends Request, Rest extends unknown[]>(
  handler: (request: Req, ...rest: Rest) => Response | Promise<Response>,
) {
  return async (request: Req, ...rest: Rest): Promise<Response> => {
    const id = incomingRequestId(request.headers);
    const response = await routeRequestIds.run(id, () => handler(request, ...rest));
    try {
      response.headers.set(REQUEST_ID_HEADER, id);
    } catch {
      // Redirects have read-only headers.
    }
    return response;
  };
}

/** Server logger: `log.error("exports: could not store the file", { error: error.message })`. */
export const log = createLogger(currentRequestId);
