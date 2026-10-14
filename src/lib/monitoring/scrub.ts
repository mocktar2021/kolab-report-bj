import type { Breadcrumb, Event, Exception, NodeOptions, RequestEventData, StackFrame } from "@sentry/nextjs";

// Every Sentry event, breadcrumb and span goes through these functions before
// it leaves the app (KRB-136). They keep the stack trace and the technical
// context, and drop or mask what can point to a person or hold customer
// text: cookies, request bodies, headers other than user-agent and
// content-type, query strings and fragments, invitation tokens, auth codes,
// e-mail addresses and the model output quoted by AI SDK errors. The user is
// cut down to its id. `extra` is dropped: the app never attaches report
// text, section content or AI prompts and outputs, and nothing else may.

export type StreamedSpan = Parameters<NonNullable<NodeOptions["beforeSendSpan"]>>[0];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// The token in /fr/invitations/<token> is the proof of the invitation.
const INVITATION_TOKEN = /(\/invitations\/)[^/?#\s"'<>]+/g;
// The query string and fragment of a URL or path written inside a text.
const URL_IN_TEXT = /((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;
// Auth values written outside a URL, as in a log line: "code=...".
const AUTH_PARAM = /\b(code|token|token_hash|access_token|refresh_token|provider_token)=[^&\s"'<>]+/gi;
// The AI SDK puts the model's output in the message of two errors (see
// @ai-sdk/provider): "JSON parsing failed: Text: <output>.\nError message: ..."
// and "Type validation failed: Value: <output>.\nError message: ...".
const AI_OUTPUT =
  /((?:JSON parsing failed: Text|Type validation failed: Value): )[\s\S]*?(?=\.\nError message:|$)/g;
// A longer text is a dump of data rather than a description of the error.
const MAX_TEXT_LENGTH = 1000;

const KEPT_HEADERS = new Set(["user-agent", "content-type"]);
// Keys dropped wherever they appear in contexts, tags and span attributes.
const DROPPED_KEYS = new Set(["cookie", "cookies", "set-cookie", "authorization", "headers"]);
// Breadcrumb data fields that hold a single URL.
const URL_KEYS = new Set(["url", "from", "to"]);
const MAX_DEPTH = 6;

/** Masks e-mails, invitation tokens, auth codes, AI output and URL query strings in free text. */
export function scrubText(text: string): string {
  const scrubbed = text
    .replace(AI_OUTPUT, "$1[Filtered]")
    .replace(EMAIL, "[email]")
    .replace(URL_IN_TEXT, "$1")
    .replace(INVITATION_TOKEN, "$1[token]")
    .replace(AUTH_PARAM, "$1=[Filtered]");
  return scrubbed.length > MAX_TEXT_LENGTH ? `${scrubbed.slice(0, MAX_TEXT_LENGTH)}[...]` : scrubbed;
}

/** A URL without its query string and fragment, and without an invitation token. */
export function scrubUrl(url: string): string {
  return url
    .replace(/[?#][\s\S]*$/, "")
    .replace(INVITATION_TOKEN, "$1[token]")
    .replace(EMAIL, "[email]");
}

/** Query strings and fragments stored apart from the URL: "http.query", "url.fragment"... */
function isQueryKey(key: string): boolean {
  return key === "query_string" || /(^|\.)(query|fragment)$/.test(key);
}

/** Strings scrubbed, cookies and headers dropped, at any depth. */
function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Filtered]";
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const scrubbed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DROPPED_KEYS.has(key.toLowerCase()) || isQueryKey(key)) continue;
    scrubbed[key] = scrubValue(item, depth + 1);
  }
  return scrubbed;
}

function scrubRequest(request: RequestEventData): RequestEventData {
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(([name]) => KEPT_HEADERS.has(name.toLowerCase())),
  );
  // No cookies, body (data), query_string or env.
  return {
    ...(request.url ? { url: scrubUrl(request.url) } : {}),
    ...(request.method ? { method: request.method } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function scrubFrame(frame: StackFrame): StackFrame {
  const kept = { ...frame };
  // Local variables can hold anything the code was working on.
  delete kept.vars;
  // An inline script's file name is the page URL. The same function runs on
  // debug_meta below, so frames still match their source maps.
  return {
    ...kept,
    ...(frame.filename ? { filename: scrubUrl(frame.filename) } : {}),
    ...(frame.abs_path ? { abs_path: scrubUrl(frame.abs_path) } : {}),
  };
}

function scrubException(exception: Exception): Exception {
  return {
    ...exception,
    ...(exception.value ? { value: scrubText(exception.value) } : {}),
    ...(exception.stacktrace?.frames
      ? { stacktrace: { ...exception.stacktrace, frames: exception.stacktrace.frames.map(scrubFrame) } }
      : {}),
  };
}

/** For beforeBreadcrumb, in the browser and on the server. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed: Breadcrumb = { ...breadcrumb };
  if (breadcrumb.message) {
    // Click and input breadcrumbs describe the element with a CSS selector.
    // Its [attribute] parts can repeat a label that holds a report title.
    const message = breadcrumb.category?.startsWith("ui.")
      ? breadcrumb.message.replace(/\[[^\]]*\]/g, "")
      : breadcrumb.message;
    scrubbed.message = scrubText(message);
  }
  if (breadcrumb.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(breadcrumb.data)) {
      // "arguments" holds what a console call printed; objects can be bodies.
      if (key === "arguments" || isQueryKey(key)) continue;
      if (typeof value === "string") data[key] = URL_KEYS.has(key) ? scrubUrl(value) : scrubText(value);
      else if (typeof value === "number" || typeof value === "boolean") data[key] = value;
    }
    scrubbed.data = data;
  }
  return scrubbed;
}

/** For beforeSend. */
export function scrubEvent<T extends Event>(event: T): T {
  const scrubbed: T = { ...event };
  delete scrubbed.extra;
  delete scrubbed.user;
  // The Supabase user id, set by setMonitoringUser. No e-mail, name or IP.
  if (event.user?.id !== undefined) scrubbed.user = { id: String(event.user.id) };
  if (event.request) scrubbed.request = scrubRequest(event.request);
  if (event.message) scrubbed.message = scrubText(event.message);
  if (event.logentry) {
    scrubbed.logentry = {
      ...(event.logentry.message ? { message: scrubText(event.logentry.message) } : {}),
      ...(event.logentry.params ? { params: event.logentry.params.map((param) => scrubValue(param)) } : {}),
    };
  }
  if (event.transaction) scrubbed.transaction = scrubText(event.transaction);
  if (event.exception?.values) {
    scrubbed.exception = { ...event.exception, values: event.exception.values.map(scrubException) };
  }
  if (event.debug_meta?.images) {
    scrubbed.debug_meta = {
      ...event.debug_meta,
      images: event.debug_meta.images.map((image) =>
        image.code_file ? { ...image, code_file: scrubUrl(image.code_file) } : image,
      ),
    };
  }
  if (event.breadcrumbs) scrubbed.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.contexts) scrubbed.contexts = scrubValue(event.contexts) as Event["contexts"];
  if (event.tags) scrubbed.tags = scrubValue(event.tags) as Event["tags"];
  return scrubbed;
}

/** For beforeSendSpan: browser page loads and navigations (v11 streams spans). */
export function scrubSpan(span: StreamedSpan): StreamedSpan {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(span.attributes ?? {})) {
    if (DROPPED_KEYS.has(key.toLowerCase()) || isQueryKey(key)) continue;
    // Keep user.id only, and no client IP address.
    if (key.startsWith("user.") && key !== "user.id") continue;
    if (/(^|\.)(client\.address|client_ip|peer\.address|peer\.ip)$/.test(key)) continue;
    attributes[key] = scrubValue(value);
  }
  return { ...span, name: scrubText(span.name), attributes: attributes as StreamedSpan["attributes"] };
}
