import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_DEBOUNCE_MS,
  VISIBLE_REFRESH_GAP_MS,
  useLiveSections,
  type LiveSectionsOptions,
} from "./use-live-sections";

type Handler = (payload: unknown) => void;
type StatusCallback = (status: string, error?: Error) => void;

/** A fake Realtime channel that records its binding and lets the test fire events. */
const realtime = vi.hoisted(() => {
  const state = {
    topics: [] as string[],
    binding: null as { type: string; filter: Record<string, string> } | null,
    handler: null as Handler | null,
    status: null as StatusCallback | null,
    system: null as Handler | null,
    channel: {} as Record<string, unknown>,
    removeChannel: vi.fn(async () => "ok"),
    channels: 0,
    disconnect: vi.fn(async () => "ok"),
    // The order of setAuth and the first channel, to check the token comes first.
    calls: [] as string[],
    setAuth: vi.fn(async () => {
      state.calls.push("setAuth");
    }),
  };
  state.channel = {
    on(type: string, filter: Record<string, string>, handler: Handler) {
      if (type === "system") {
        state.system = handler;
      } else {
        state.binding = { type, filter };
        state.handler = handler;
      }
      return state.channel;
    },
    subscribe(callback: StatusCallback) {
      state.status = callback;
      return state.channel;
    },
  };
  return state;
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string) => {
      realtime.topics.push(topic);
      realtime.calls.push("channel");
      return realtime.channel;
    },
    removeChannel: realtime.removeChannel,
    getChannels: () => Array.from({ length: realtime.channels }),
    realtime: { disconnect: realtime.disconnect, setAuth: realtime.setAuth },
  }),
}));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const TOPIC = `report-sections:${REPORT_ID}`;
const FILTER = `report_id=eq.${REPORT_ID}`;

/** Waits for supabase-js, which the hook imports lazily. */
async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

async function renderLive() {
  const onChange = vi.fn();
  const view = renderHook((options: LiveSectionsOptions) => useLiveSections(options), {
    initialProps: { topic: TOPIC, filter: FILTER, onChange },
  });
  await settle();
  return { ...view, onChange };
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
  realtime.removeChannel.mockClear();
  realtime.disconnect.mockClear();
  realtime.channels = 0;
  realtime.topics = [];
  realtime.binding = null;
  realtime.handler = null;
  realtime.status = null;
  realtime.system = null;
  realtime.calls = [];
  realtime.setAuth.mockClear();
});

describe("useLiveSections", () => {
  it("hands Realtime the user's token before it joins the channel", async () => {
    await renderLive();
    // Joined with the anon key, the subscription would be refused.
    expect(realtime.calls).toEqual(["setAuth", "channel"]);
  });

  it("gives up quietly when Realtime refuses the subscription", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { onChange } = await renderLive();
    act(() => realtime.status?.("SUBSCRIBED"));

    // Other system messages change nothing.
    await act(async () => realtime.system?.({ extension: "postgres_changes", status: "ok" }));
    expect(realtime.removeChannel).not.toHaveBeenCalled();

    await act(async () =>
      realtime.system?.({ extension: "postgres_changes", status: "error", message: "Unable to subscribe" }),
    );
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);

    // A late status from the removed channel is ignored.
    act(() => realtime.status?.("CLOSED"));
    act(() => realtime.status?.("SUBSCRIBED"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("listens to every change of the matching sections, on a topic of its own", async () => {
    await renderLive();
    await renderLive();

    expect(realtime.binding).toEqual({
      type: "postgres_changes",
      filter: { event: "*", schema: "public", table: "report_sections", filter: FILTER },
    });
    expect(realtime.topics).toHaveLength(2);
    expect(realtime.topics[0]).toMatch(new RegExp(`^${TOPIC}:`));
    expect(realtime.topics[1]).toMatch(new RegExp(`^${TOPIC}:`));
    expect(realtime.topics[0]).not.toBe(realtime.topics[1]);
  });

  it("calls onChange once for a burst of events, after a short wait", async () => {
    const { onChange } = await renderLive();
    act(() => realtime.status?.("SUBSCRIBED"));

    // A reorder of four sections sends four UPDATE events.
    for (let i = 0; i < 4; i++) {
      act(() => {
        realtime.handler?.({ eventType: "UPDATE" });
        vi.advanceTimersByTime(100);
      });
    }
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS));
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5000));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("calls onChange when the tab is shown again, at most once every few seconds", async () => {
    const { onChange } = await renderLive();

    act(() => setVisibility("hidden"));
    expect(onChange).not.toHaveBeenCalled();
    act(() => setVisibility("visible"));
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(VISIBLE_REFRESH_GAP_MS);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops a channel that never connects, quietly", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const error = vi.spyOn(console, "error");
    const { onChange, unmount } = await renderLive();

    await act(async () => realtime.status?.("CHANNEL_ERROR", new Error("websocket closed")));
    await act(async () => realtime.status?.("CHANNEL_ERROR", new Error("websocket closed")));

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    // No channel left: the socket stops retrying right away.
    expect(realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    // Unmounting does not remove it a second time.
    unmount();
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

  it("does not call onChange when the channel first connects", async () => {
    const { onChange } = await renderLive();
    act(() => realtime.status?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "calls onChange right away when the channel is back after %s",
    async (drop) => {
      const { onChange } = await renderLive();
      act(() => {
        realtime.status?.("SUBSCRIBED");
        realtime.status?.(drop, new Error("network"));
      });
      // A connected channel is left to reconnect by itself.
      expect(realtime.removeChannel).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      act(() => realtime.status?.("SUBSCRIBED"));
      expect(onChange).toHaveBeenCalledTimes(1);

      // Joined again with no drop in between: nothing to catch up on.
      act(() => realtime.status?.("SUBSCRIBED"));
      expect(onChange).toHaveBeenCalledTimes(1);
    },
  );

  it("resyncs once per reconnect, with the pending reload folded in", async () => {
    const { onChange } = await renderLive();
    act(() => {
      realtime.status?.("SUBSCRIBED");
      realtime.handler?.({ eventType: "UPDATE" });
      // Retries while the socket is down report more than one error.
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
      realtime.status?.("TIMED_OUT");
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
      realtime.status?.("SUBSCRIBED");
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2));
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
      realtime.status?.("SUBSCRIBED");
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps its channel when onChange changes, and calls the latest one", async () => {
    const { onChange, rerender } = await renderLive();
    const next = vi.fn();
    rerender({ topic: TOPIC, filter: FILTER, onChange: next });
    await settle();

    expect(realtime.topics).toHaveLength(1);
    expect(realtime.removeChannel).not.toHaveBeenCalled();

    act(() => {
      realtime.handler?.({ eventType: "INSERT" });
      vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens a new channel when the filter changes", async () => {
    const { onChange, rerender } = await renderLive();
    rerender({ topic: "report-sections:other", filter: "report_id=eq.other", onChange });
    await settle();

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.topics).toHaveLength(2);
    expect(realtime.topics[1]).toMatch(/^report-sections:other:/);
    expect(realtime.binding?.filter.filter).toBe("report_id=eq.other");
  });

  it("removes the channel, the pending reload and the listener on unmount", async () => {
    const { onChange, unmount } = await renderLive();
    act(() => {
      realtime.status?.("SUBSCRIBED");
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
      realtime.handler?.({ eventType: "INSERT" });
    });

    unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);

    act(() => {
      // Leaving reports CLOSED, and a late join reply can still arrive.
      realtime.status?.("CLOSED");
      realtime.status?.("SUBSCRIBED");
      vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens no channel when unmounted before supabase-js loads", async () => {
    const view = renderHook(() => useLiveSections({ topic: TOPIC, filter: FILTER, onChange: vi.fn() }));
    view.unmount();
    await settle();
    expect(realtime.topics).toHaveLength(0);
    expect(realtime.removeChannel).not.toHaveBeenCalled();
  });
});
