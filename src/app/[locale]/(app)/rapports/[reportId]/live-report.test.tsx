import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveReport, LIVE_DEBOUNCE_MS, VISIBLE_REFRESH_GAP_MS } from "./live-report";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

type Handler = (payload: unknown) => void;
type StatusCallback = (status: string, error?: Error) => void;

/** A fake Realtime channel that records its binding and lets the test fire events. */
const realtime = vi.hoisted(() => {
  const state = {
    created: 0,
    topic: "",
    binding: null as { type: string; filter: Record<string, string> } | null,
    handler: null as Handler | null,
    status: null as StatusCallback | null,
    channel: {} as Record<string, unknown>,
    removeChannel: vi.fn(async () => "ok"),
    channels: 0,
    disconnect: vi.fn(async () => "ok"),
  };
  state.channel = {
    on(type: string, filter: Record<string, string>, handler: Handler) {
      state.binding = { type, filter };
      state.handler = handler;
      return state.channel;
    },
    subscribe(callback: StatusCallback) {
      state.status = callback;
      return state.channel;
    },
  };
  return state;
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string) => {
      realtime.created += 1;
      realtime.topic = topic;
      return realtime.channel;
    },
    removeChannel: realtime.removeChannel,
    getChannels: () => Array.from({ length: realtime.channels }),
    realtime: { disconnect: realtime.disconnect },
  }),
}));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

/** Renders the hook and waits for supabase-js, which it imports lazily. */
async function renderLive() {
  const view = render(<LiveReport reportId={REPORT_ID} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return view;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  router.refresh.mockReset();
  realtime.removeChannel.mockClear();
  realtime.disconnect.mockClear();
  realtime.channels = 0;
  realtime.handler = null;
  realtime.status = null;
  realtime.created = 0;
});

describe("LiveReport", () => {
  it("listens to every change of the report's sections", async () => {
    await renderLive();
    expect(realtime.topic).toMatch(new RegExp(`^report-sections:${REPORT_ID}:`));
    expect(realtime.binding).toEqual({
      type: "postgres_changes",
      filter: {
        event: "*",
        schema: "public",
        table: "report_sections",
        filter: `report_id=eq.${REPORT_ID}`,
      },
    });
  });

  it("refreshes once for a burst of events, after a short wait", async () => {
    await renderLive();
    act(() => realtime.status?.("SUBSCRIBED"));

    // A reorder of four sections sends four UPDATE events.
    for (let i = 0; i < 4; i++) {
      act(() => {
        realtime.handler?.({ eventType: "UPDATE" });
        vi.advanceTimersByTime(100);
      });
    }
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS));
    expect(router.refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5000));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the tab is shown again, at most once every few seconds", async () => {
    await renderLive();

    act(() => setVisibility("hidden"));
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => setVisibility("visible"));
    expect(router.refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(VISIBLE_REFRESH_GAP_MS);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("drops a channel that never connects, quietly", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const error = vi.spyOn(console, "error");
    const view = await renderLive();

    await act(async () => realtime.status?.("CHANNEL_ERROR", new Error("websocket closed")));
    await act(async () => realtime.status?.("CHANNEL_ERROR", new Error("websocket closed")));

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    // No channel left: the socket stops retrying right away.
    expect(realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    // Unmounting does not remove it a second time.
    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("keeps the socket open for other channels", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    realtime.channels = 1;
    await renderLive();
    await act(async () => realtime.status?.("TIMED_OUT"));
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.disconnect).not.toHaveBeenCalled();
  });

  it("lets a connected channel reconnect by itself", async () => {
    await renderLive();
    act(() => {
      realtime.status?.("SUBSCRIBED");
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
    });
    expect(realtime.removeChannel).not.toHaveBeenCalled();
  });

  it("removes the channel, the pending refresh and the listener on unmount", async () => {
    const view = await renderLive();
    act(() => realtime.handler?.({ eventType: "INSERT" }));

    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2);
      setVisibility("visible");
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("opens no channel when the page is left before supabase-js loads", async () => {
    const view = render(<LiveReport reportId={REPORT_ID} />);
    view.unmount();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(realtime.created).toBe(0);
    expect(realtime.removeChannel).not.toHaveBeenCalled();
  });
});
