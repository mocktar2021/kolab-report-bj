"use client";

import type {} from "@ducanh2912/next-pwa/workbox";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reloadPage } from "@/lib/pwa/reload-page";
import { hasUnsavedWork } from "@/lib/unsaved-work";

// KRB-156: each deploy ships a new service worker. It installs in the
// background, then waits (skipWaiting is off in next.config.mjs). Open tabs
// show this banner, and a page reloads only when its user asks for it.

type Workbox = Window["workbox"];

/** An open tab asks the server for a new version this often. */
export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;
/** A tab coming back into view asks too, at most this often. */
export const VISIBLE_CHECK_GAP = 60 * 1000;
/** After "Mettre à jour", reload anyway if the new version has not taken over by then. */
export const TAKEOVER_TIMEOUT = 10 * 1000;

type Status = "hidden" | "shown" | "unsaved" | "updating";

// One registration per page, even when React runs the effect twice (Strict Mode).
const registrations = new WeakMap<Workbox, Promise<ServiceWorkerRegistration | undefined>>();

function register(workbox: Workbox) {
  let registration = registrations.get(workbox);
  if (!registration) {
    // Fails in some private windows. The app still works, without offline pages.
    registration = workbox.register().catch(() => undefined);
    registrations.set(workbox, registration);
  }
  return registration;
}

function reloadOnce(reloading: RefObject<boolean>) {
  if (reloading.current) return;
  reloading.current = true;
  reloadPage();
}

/**
 * Registers the service worker and shows "Nouvelle version disponible" when a
 * new one waits. Mounted once in the locale layout.
 */
export function UpdateBanner() {
  const t = useTranslations("Pwa");
  const [status, setStatus] = useState<Status>("hidden");
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  // The new worker the banner is about, and the one the user put off.
  const offered = useRef<ServiceWorker | null>(null);
  const dismissed = useRef<ServiceWorker | null>(null);
  // Only a click on "Mettre à jour" in this tab makes a takeover reload it.
  const requested = useRef(false);
  const reloading = useRef(false);

  useEffect(() => {
    // next-pwa defines window.workbox only when the service worker is on.
    const workbox = window.workbox as Workbox | undefined;
    if (!workbox || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let controlled = container.controller !== null;
    let lastCheck = Date.now();

    const offer = (worker: ServiceWorker | null | undefined) => {
      if (!worker || worker === dismissed.current) return;
      offered.current = worker;
      setStatus((current) => (current === "hidden" ? "shown" : current));
    };

    // A new version installed and waits for the open pages.
    const onWaiting = (event: { sw?: ServiceWorker }) => offer(event.sw);

    // A new version controls the page: after a click here, or in another tab.
    // The other tab's choice does not reload this one, which may hold text.
    // On a first visit, the first worker taking over is no update.
    const onControllerChange = () => {
      if (requested.current) return reloadOnce(reloading);
      if (controlled) offer(container.controller);
      controlled = true;
    };

    const check = () => {
      const current = registration.current;
      if (!current || !navigator.onLine) return;
      lastCheck = Date.now();
      // Looking at `waiting` afterwards also catches an event that was missed.
      workbox.update().then(
        () => offer(current.waiting),
        () => undefined,
      );
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck >= VISIBLE_CHECK_GAP) check();
    };

    workbox.addEventListener("waiting", onWaiting);
    container.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL);
    void register(workbox).then((result) => {
      registration.current = result;
      offer(result?.waiting);
    });

    return () => {
      workbox.removeEventListener("waiting", onWaiting);
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, []);

  function update() {
    if (status === "updating") return;
    if (hasUnsavedWork()) {
      setStatus("unsaved");
      return;
    }
    setStatus("updating");
    if (!registration.current?.waiting) {
      // Another tab already switched to the new version: a reload is enough.
      reloadOnce(reloading);
      return;
    }
    requested.current = true;
    // The waiting worker takes over, then onControllerChange reloads the page.
    window.workbox.messageSkipWaiting();
    window.setTimeout(() => reloadOnce(reloading), TAKEOVER_TIMEOUT);
  }

  function dismiss() {
    dismissed.current = offered.current;
    setStatus("hidden");
  }

  if (status === "hidden") return null;

  const updating = status === "updating";
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm flex-col gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 sm:inset-x-auto sm:bottom-6 sm:right-6"
    >
      <div className="space-y-1 text-sm">
        <p className="font-semibold">{t("updateTitle")}</p>
        <p className="text-muted-foreground">
          {status === "unsaved" ? t("updateUnsaved") : t("updateDescription")}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {t("later")}
        </Button>
        <Button
          type="button"
          size="sm"
          aria-disabled={updating || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-70"
          onClick={update}
        >
          {updating ? t("updating") : t("update")}
        </Button>
      </div>
    </div>
  );
}
