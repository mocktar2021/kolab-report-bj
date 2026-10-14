"use client";

import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

type ErrorScreenProps = {
  title: string;
  description: string;
  reloadLabel: string;
  homeLabel: string;
  /** Digest of a server error, so it can be found in the server logs. */
  reference?: string;
};

/**
 * What a visitor sees when a page crashes. "Reload" is a full page load on
 * purpose: after a deploy the old page's scripts and form actions are gone,
 * and only a fresh load brings the new ones.
 */
export function ErrorScreen({ title, description, reloadLabel, homeLabel, reference }: ErrorScreenProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark className="size-10" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-md text-muted-foreground">{description}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={() => window.location.reload()}>
          {reloadLabel}
        </Button>
        <Button asChild variant="outline">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/fr/tableau-de-bord">{homeLabel}</a>
        </Button>
      </div>
      {reference ? <p className="text-xs text-muted-foreground">{reference}</p> : null}
    </main>
  );
}
