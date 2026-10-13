import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Exchanges the code from Supabase e-mail links (sign-up confirmation,
// password recovery) for a session cookie.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/fr/tableau-de-bord";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/fr/tableau-de-bord";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/fr/connexion?erreur=lien-invalide`);
}
