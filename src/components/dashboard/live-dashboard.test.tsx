import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_DEBOUNCE_MS } from "@/lib/realtime/use-live-sections";
import { LiveDashboard } from "./live-dashboard";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

type Handler = (payload: unknown) => void;
type StatusCallback = (status: string, error?: Error) => void;

/** A fake Realtime channel that records its binding and lets the test fire events. */
const realtime = vi.hoisted(() => {
  const state = {
    topic: "",
    binding: null as { type: string; filter: Record<string, string> } | null,
    handler: null as Handler | null,
    status: null as StatusCallback | null,
    channel: {} as Record<string, unknown>,
    removeChannel: vi.fn(async () => "ok"),
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
      realtime.topic = topic;
      return realtime.channel;
    },
    removeChannel: realtime.removeChannel,
    getChannels: () => [],
    realtime: { disconnect: vi.fn(async () => "ok") },
  }),
}));

const WORKSPACE_ID = "7d6e5f40-3b2a-4c1d-8e9f-0a1b2c3d4e5f";

/** Renders the component and waits for supabase-js, which it imports lazily. */
async function renderLive() {
  const view = render(<LiveDashboard workspaceId={WORKSPACE_ID} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  router.refresh.mockReset();
  realtime.removeChannel.mockClear();
  realtime.handler = null;
  realtime.status = null;
});

describe("LiveDashboard", () => {
  it("listens to every change of the workspace's sections and renders nothing", async () => {
    const { container } = await renderLive();
    expect(container).toBeEmptyDOMElement();
    expect(realtime.topic).toMatch(new RegExp(`^workspace-sections:${WORKSPACE_ID}:`));
    expect(realtime.binding).toEqual({
      type: "postgres_changes",
      filter: {
        event: "*",
        schema: "public",
        table: "report_sections",
        filter: `workspace_id=eq.${WORKSPACE_ID}`,
      },
    });
  });

  it("refreshes the dashboard when a section changes", async () => {
    await renderLive();
    act(() => {
      realtime.status?.("SUBSCRIBED");
      realtime.handler?.({ eventType: "UPDATE" });
    });
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(LIVE_DEBOUNCE_MS));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes right away when Realtime is back after a drop", async () => {
    await renderLive();
    act(() => {
      realtime.status?.("SUBSCRIBED");
      realtime.status?.("CHANNEL_ERROR", new Error("network"));
    });
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => realtime.status?.("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("removes the channel on unmount", async () => {
    const view = await renderLive();
    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });
});
