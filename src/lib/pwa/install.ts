// KRB-205: installing KolabReport from the app. Chrome, Edge and Samsung
// Internet fire `beforeinstallprompt` when the app can be installed; the
// event is kept so a click on "Installer l'application" can show the
// browser's own install dialog. iOS never fires it: there the app shows the
// steps of Safari's share menu instead.

/** The event Chromium browsers fire when the app can be installed. Not in the DOM types yet. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/** "prompt": the browser's install dialog. "ios": the share menu steps. "none": nothing to offer. */
export type InstallMode = "prompt" | "ios" | "none";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let listening = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Listens once per page. Called when this module loads in the browser, so an
 * event fired before the menu mounts is not lost.
 */
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // No mini-infobar from Chrome: the app offers the install itself, and
    // only when asked.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

listen();

/** The page runs as the installed app: opened from the home screen or its own window. */
export function isStandalone(win: Window) {
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || win.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** iPhone, iPod or iPad, including an iPad that presents itself as a Mac with a touch screen. */
export function isIos(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">) {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

/** What the install item does on this page now. */
export function installMode(): InstallMode {
  if (typeof window === "undefined" || installed || isStandalone(window)) return "none";
  if (deferred) return "prompt";
  return isIos(window.navigator) ? "ios" : "none";
}

/** For useSyncExternalStore. */
export function subscribeToInstall(listener: () => void) {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shows the browser's install dialog. An event prompts once only, so the item
 * hides until the browser fires a new one (after a refusal) or the app is
 * installed.
 */
export async function promptInstall() {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
}
