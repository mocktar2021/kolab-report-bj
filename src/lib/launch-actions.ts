"use server";

import { emailSchema } from "@/lib/auth/schemas";
import { isPrelaunch } from "@/lib/launch";
import { saveLaunchReminder } from "@/lib/launch-reminder";

export type LaunchReminderState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; error: "emailInvalid" | "unavailable"; email: string };

/** Keeps the address for the launch e-mail (KRB-239). */
export async function requestLaunchReminder(
  _prev: LaunchReminderState,
  formData: FormData,
): Promise<LaunchReminderState> {
  // A field people never see: a bot that fills every field gets a thank-you and nothing is saved.
  if (String(formData.get("website") ?? "").trim()) return { status: "done" };

  const email = String(formData.get("email") ?? "");
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { status: "error", error: "emailInvalid", email };
  // The form only shows in production before the launch. Outside that window
  // nothing goes to the launch list, even from a direct post.
  if (!isPrelaunch()) return { status: "error", error: "unavailable", email };

  return (await saveLaunchReminder(parsed.data))
    ? { status: "done" }
    : { status: "error", error: "unavailable", email };
}
