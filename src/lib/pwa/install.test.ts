import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps the browser's event in module state, so each test loads a
// fresh copy of it.
async function load() {
  vi.resetModules();
  return import("./install");
}

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_OLD =
  "Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

function installEvent() {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
  });
  return { event, prompt };
}

function standalone(matches: boolean) {
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: matches && query.includes("standalone") }) as MediaQueryList,
  );
}

beforeEach(() => standalone(false));
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("isIos", () => {
  it("knows an iPhone and an older iPad by their user agent", async () => {
    const { isIos } = await load();
    expect(isIos({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_OLD, platform: "iPad", maxTouchPoints: 5 })).toBe(true);
  });

  it("knows an iPad that presents itself as a Mac, by its touch screen", async () => {
    const { isIos } = await load();
    expect(isIos({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("leaves Android out", async () => {
    const { isIos } = await load();
    expect(isIos({ userAgent: ANDROID_CHROME, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("installMode", () => {
  it("offers nothing in a browser that cannot install the app", async () => {
    const { installMode } = await load();
    expect(installMode()).toBe("none");
  });

  it("keeps the browser's event, without Chrome's own banner, and prompts once", async () => {
    const { installMode, promptInstall, subscribeToInstall } = await load();
    const listener = vi.fn();
    const unsubscribe = subscribeToInstall(listener);
    const { event, prompt } = installEvent();

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installMode()).toBe("prompt");
    expect(listener).toHaveBeenCalledTimes(1);

    await promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
    // The event is spent: the item hides until the browser fires a new one.
    expect(installMode()).toBe("none");
    await promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("offers it again when the browser fires a new event after a refusal", async () => {
    const { installMode, promptInstall } = await load();
    window.dispatchEvent(installEvent().event);
    await promptInstall();
    window.dispatchEvent(installEvent().event);
    expect(installMode()).toBe("prompt");
  });

  it("stops once the app is installed", async () => {
    const { installMode } = await load();
    window.dispatchEvent(installEvent().event);
    window.dispatchEvent(new Event("appinstalled"));
    expect(installMode()).toBe("none");
  });

  it("offers nothing when the page already runs as the installed app", async () => {
    standalone(true);
    const { installMode } = await load();
    window.dispatchEvent(installEvent().event);
    expect(installMode()).toBe("none");
  });

  it("offers the share menu steps on an iPhone, unless opened from the home screen", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const { installMode } = await load();
    expect(installMode()).toBe("ios");

    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    try {
      expect(installMode()).toBe("none");
    } finally {
      Reflect.deleteProperty(window.navigator, "standalone");
    }
  });
});
