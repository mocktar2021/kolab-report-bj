import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { reloadPage } from "@/lib/pwa/reload-page";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { UPDATE_CHECK_INTERVAL, UpdateBanner, VISIBLE_CHECK_GAP } from "./update-banner";

vi.mock("@/lib/pwa/reload-page", () => ({ reloadPage: vi.fn() }));

const TITLE = "Nouvelle version disponible";
const UNSAVED = "Vous avez des modifications non enregistrées. Enregistrez-les, puis mettez à jour.";

type WaitingListener = (event: { sw?: ServiceWorker }) => void;

/** Service workers only need an identity here. */
function worker(name: string) {
  return { name } as unknown as ServiceWorker;
}

/** Stands in for next-pwa's window.workbox and the browser's service worker container. */
function fakeServiceWorker({ controlled = true, waiting = null as ServiceWorker | null } = {}) {
  const listeners = new Set<WaitingListener>();
  const registration = { waiting };
  const workbox = {
    register: vi.fn(async () => registration),
    update: vi.fn(async () => undefined),
    messageSkipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, listener: WaitingListener) => {
      if (type === "waiting") listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: WaitingListener) => listeners.delete(listener)),
  };
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? worker("current") : null,
  });
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  window.workbox = workbox as unknown as Window["workbox"];

  return {
    workbox,
    registration,
    /** A new version finished installing and waits. */
    wait(sw: ServiceWorker) {
      registration.waiting = sw;
      act(() => listeners.forEach((listener) => listener({ sw })));
    },
    /** A new version took over the page. */
    takeOver(sw: ServiceWorker) {
      registration.waiting = null;
      container.controller = sw;
      act(() => {
        container.dispatchEvent(new Event("controllerchange"));
      });
    },
  };
}

function Editor({ dirty }: { dirty: boolean }) {
  useUnsavedWork(dirty);
  return null;
}

async function renderBanner({ dirty = false } = {}) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <UpdateBanner />
      <Editor dirty={dirty} />
    </NextIntlClientProvider>,
  );
  // Lets the registration promise settle.
  await act(async () => undefined);
}

function updateButton() {
  return screen.getByRole("button", { name: "Mettre à jour" });
}

describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reloadPage).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { workbox?: unknown }).workbox;
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("registers the service worker and stays hidden while nothing waits", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    expect(sw.workbox.register).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing when the service worker is off", async () => {
    await renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers the new version, then reloads once after it takes over", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    const next = worker("next");
    sw.wait(next);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(TITLE);
    expect(banner).not.toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(updateButton());
    expect(sw.workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Mise à jour…" })).toHaveAttribute("aria-disabled", "true");
    expect(reloadPage).not.toHaveBeenCalled();

    sw.takeOver(next);
    sw.takeOver(next);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("never reloads before the new version takes over, however long it takes", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    const next = worker("next");
    sw.wait(next);
    fireEvent.click(updateButton());

    act(() => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(reloadPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mise à jour…" }));
    expect(sw.workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);

    sw.takeOver(next);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("shows a version that was already waiting when the page loaded", async () => {
    fakeServiceWorker({ waiting: worker("next") });
    await renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(TITLE);
  });

  it("does not reload while the page holds unsaved work", async () => {
    const sw = fakeServiceWorker();
    await renderBanner({ dirty: true });
    sw.wait(worker("next"));

    fireEvent.click(updateButton());
    expect(screen.getByRole("status")).toHaveTextContent(UNSAVED);
    expect(sw.workbox.messageSkipWaiting).not.toHaveBeenCalled();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("leaves the page alone when another tab updates, and reloads on click", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    const next = worker("next");
    sw.wait(next);

    sw.takeOver(next);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(TITLE);

    fireEvent.click(updateButton());
    expect(sw.workbox.messageSkipWaiting).not.toHaveBeenCalled();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the first service worker takes over a first visit", async () => {
    const sw = fakeServiceWorker({ controlled: false });
    await renderBanner();
    sw.takeOver(worker("first"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("stays hidden after Plus tard until a newer version waits", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    sw.wait(worker("next"));
    fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(screen.queryByRole("status")).toBeNull();

    // The hourly check finds the same waiting version: still hidden.
    await act(async () => vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL));
    expect(sw.workbox.update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();

    sw.wait(worker("newer"));
    expect(screen.getByRole("status")).toHaveTextContent(TITLE);
  });

  it("checks for a new version when the tab comes back, at most once a minute", async () => {
    const sw = fakeServiceWorker();
    await renderBanner();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    const comeBack = () => act(() => document.dispatchEvent(new Event("visibilitychange")));

    comeBack();
    expect(sw.workbox.update).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(VISIBLE_CHECK_GAP));
    comeBack();
    comeBack();
    expect(sw.workbox.update).toHaveBeenCalledTimes(1);

    // A check that finds a waiting version shows the banner, even without the event.
    sw.registration.waiting = worker("next");
    act(() => vi.advanceTimersByTime(VISIBLE_CHECK_GAP));
    await act(async () => comeBack());
    expect(screen.getByRole("status")).toHaveTextContent(TITLE);
    Reflect.deleteProperty(document, "visibilityState");
  });
});
