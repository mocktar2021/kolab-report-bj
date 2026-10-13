import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "./server";

const profileSchema = z.object({
  full_name: z.string().nullable(),
  email: z.string(),
});

export type CurrentProfile = {
  id: string;
  name: string;
  email: string;
};

// cache() shares one result between the layout and the page of a request.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Signed-in user with a display name: profiles.full_name, or the e-mail when empty. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileSchema.safeParse(data);

  const email = profile.success ? profile.data.email : (user.email ?? "");
  const name = (profile.success ? profile.data.full_name?.trim() : undefined) || email;
  return { id: user.id, name, email };
});
