import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const handleI18nRouting = createIntlMiddleware(routing);

// The locale root (/fr) is the public landing page. Exact match only, so
// nothing nested under it becomes public by accident.
const PUBLIC_EXACT_PATHS = ["/"];

// Routes reachable without a session, with everything nested under them
// (paths without the locale prefix).
const PUBLIC_PATHS = [
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/auth/callback",
  "/hors-ligne",
  // The invitation page works signed out: the token in the link is the proof.
  "/invitations",
];

const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

function stripLocale(pathname: string) {
  return pathname.replace(LOCALE_PREFIX, "") || "/";
}

function isPublicPath(path: string) {
  return (
    PUBLIC_EXACT_PATHS.includes(path) || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
  );
}

// Signed-in users skip the landing, sign-in and sign-up pages.
const SIGNED_IN_REDIRECT_PATHS = ["/", "/connexion", "/inscription"];

export async function middleware(request: NextRequest) {
  const response = handleI18nRouting(request);

  // Locale redirect (e.g. "/" -> "/fr"): let it happen first.
  if (response.headers.has("location")) {
    return response;
  }

  const user = await updateSession(request, response);
  const path = stripLocale(request.nextUrl.pathname);
  const locale = routing.defaultLocale;

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/connexion`;
    url.search = "";
    if (path !== "/") {
      url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    }
    return redirectWithCookies(url, response);
  }

  if (user && SIGNED_IN_REDIRECT_PATHS.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/tableau-de-bord`;
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

// Keep refreshed auth cookies when replacing the response with a redirect.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // Skip API routes, Next internals, PWA assets and any file with an extension.
  matcher: [
    "/((?!api|_next/static|_next/image|_vercel|sw\\.js|workbox-.*|swe-worker-.*|fallback-.*|manifest\\.webmanifest|icons/|.*\\..*).*)",
  ],
};
