"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { useFocusOnError, useFocusWhenShown } from "@/components/auth/use-focus-on-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestLaunchReminder, type LaunchReminderState } from "@/lib/launch-actions";
import { cn } from "@/lib/utils";

export type LaunchReminderText = {
  emailLabel: string;
  submit: string;
  honeypot: string;
  done: string;
  errors: Record<"emailInvalid" | "unavailable", string>;
  privacy: React.ReactNode;
};

/**
 * One e-mail field: we write once, when sign-up opens (KRB-239). The text
 * comes from the server, so no message goes to the browser for it.
 */
export function LaunchReminderForm({ text, className }: { text: LaunchReminderText; className?: string }) {
  const [state, formAction, pending] = useActionState<LaunchReminderState, FormData>(requestLaunchReminder, {
    status: "idle",
  });
  const formRef = useFocusOnError(state, state.status === "error", "email");
  const doneRef = useFocusWhenShown<HTMLParagraphElement>(state.status === "done");

  if (state.status === "done") {
    return (
      <p
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className={cn(
          "flex items-start justify-center gap-2 text-sm text-foreground outline-none",
          className,
        )}
      >
        <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        {text.done}
      </p>
    );
  }

  const error = state.status === "error" ? state.error : undefined;

  return (
    <form ref={formRef} action={formAction} noValidate className={cn("relative text-left", className)}>
      <Label htmlFor="launch-email">{text.emailLabel}</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="launch-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.status === "error" ? state.email : ""}
          required
          aria-invalid={error === "emailInvalid"}
          aria-describedby={error ? "launch-email-error launch-email-note" : "launch-email-note"}
          className="h-11"
        />
        <Button type="submit" shape="pill" className="h-11 px-6" disabled={pending}>
          {text.submit}
        </Button>
      </div>
      {/* Out of sight and out of the tab order. A bot that fills every field fills this one too. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 size-px overflow-hidden">
        <label htmlFor="launch-website">{text.honeypot}</label>
        <input id="launch-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {error ? (
        <p id="launch-email-error" role="alert" className="mt-2 text-sm text-destructive">
          {text.errors[error]}
        </p>
      ) : null}
      <p id="launch-email-note" className="mt-2 text-xs text-muted-foreground">
        {text.privacy}
      </p>
    </form>
  );
}
