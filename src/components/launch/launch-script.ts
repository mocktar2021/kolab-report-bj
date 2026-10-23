// Shared by the hero (inline script) and LaunchWatch. Keep this module free
// of "use client".

/**
 * Inline script for the hero: sets <html data-launched> before first paint
 * once the launch has passed. The home page is static, so one built before
 * the launch still holds the countdown; with the attribute set, it shows the
 * buttons from the first frame. The launched: and prelaunch: variants
 * (tailwind.config.ts) read it.
 */
export function launchInitScript(until: string): string {
  return `if(Date.now()>=${Date.parse(until)}){document.documentElement.dataset.launched=""}`;
}
