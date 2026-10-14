import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hasUnsavedWork, useUnsavedWork } from "./unsaved-work";

function leaveIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedWork", () => {
  it("holds the page while one part of it is active", () => {
    const editor = renderHook(({ active }) => useUnsavedWork(active), { initialProps: { active: false } });
    const upload = renderHook(({ active }) => useUnsavedWork(active), { initialProps: { active: false } });
    expect(hasUnsavedWork()).toBe(false);
    expect(leaveIsBlocked()).toBe(false);

    editor.rerender({ active: true });
    upload.rerender({ active: true });
    expect(hasUnsavedWork()).toBe(true);
    expect(leaveIsBlocked()).toBe(true);

    editor.rerender({ active: false });
    expect(hasUnsavedWork()).toBe(true);

    upload.unmount();
    expect(hasUnsavedWork()).toBe(false);
    expect(leaveIsBlocked()).toBe(false);
  });
});
