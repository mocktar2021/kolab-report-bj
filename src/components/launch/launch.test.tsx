import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLaunchReminder } from "@/lib/launch-actions";
import messages from "../../../messages/fr.json";
import { timeLeft } from "./countdown";
import { LaunchPanel } from "./launch-panel";
import { launchInitScript } from "./launch-script";
import { LaunchWatch } from "./launch-watch";
import { UntilLaunch } from "./until-launch";

vi.mock("@/lib/launch-actions", () => ({ requestLaunchReminder: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// The panel is a Server Component in the app. Here it renders in the
// provider, which gives the same text.

const LAUNCH = "2026-10-27T08:00:00.000Z";

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      {node}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.launched;
});

describe("timeLeft", () => {
  it("splits a duration and stops at zero", () => {
    expect(timeLeft(((3 * 24 + 4) * 3600 + 5 * 60 + 6) * 1000 + 999)).toEqual({
      days: 3,
      hours: 4,
      minutes: 5,
      seconds: 6,
    });
    expect(timeLeft(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("LaunchPanel countdown", () => {
  it("renders dashes on the server, so hydration matches", () => {
    const html = renderToString(withIntl(<LaunchPanel until={LAUNCH} />));
    expect(html).toContain("--");
    expect(html).not.toMatch(/>\d\d</);
  });

  it("counts down in the browser, with French unit names", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-26T07:59:58.000Z"));
    render(withIntl(<LaunchPanel until={LAUNCH} />));

    const timer = screen.getByRole("timer", { name: "Temps restant avant l'ouverture" });
    expect(timer).toHaveTextContent("01jours00heures00minutes02secondes");

    act(() => vi.advanceTimersByTime(1000));
    expect(timer).toHaveTextContent("01jours00heures00minutes01secondes");
  });
});

describe("UntilLaunch", () => {
  it("swaps to the content at the launch second, without a reload", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-27T07:59:58.000Z"));
    render(
      <UntilLaunch until={LAUNCH} before={<p>Bientôt</p>}>
        <p>Ouvert</p>
      </UntilLaunch>,
    );
    expect(screen.getByText("Bientôt")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("Ouvert")).toBeInTheDocument();
    expect(screen.queryByText("Bientôt")).not.toBeInTheDocument();
  });
});

describe("hero switch", () => {
  const runScript = () => new Function(launchInitScript(LAUNCH))();

  it("marks the page as launched before first paint, only once the launch has passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T07:59:59.000Z"));
    runScript();
    expect(document.documentElement.dataset.launched).toBeUndefined();

    vi.setSystemTime(new Date(LAUNCH));
    runScript();
    expect(document.documentElement.dataset.launched).toBe("");
  });

  it("marks an open page at the launch second", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-27T07:59:58.000Z"));
    render(<LaunchWatch until={LAUNCH} />);
    expect(document.documentElement.dataset.launched).toBeUndefined();

    act(() => vi.advanceTimersByTime(2000));
    expect(document.documentElement.dataset.launched).toBe("");
  });
});

describe("LaunchPanel reminder form", () => {
  it("hides the bot trap from people and screen readers", () => {
    const { container } = render(withIntl(<LaunchPanel until={LAUNCH} />));
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("sends the address and confirms", async () => {
    vi.mocked(requestLaunchReminder).mockResolvedValue({ status: "done" });
    const user = userEvent.setup();
    render(withIntl(<LaunchPanel until={LAUNCH} />));

    await user.type(screen.getByLabelText("Recevez un e-mail à l'ouverture"), "aicha@kolab.test");
    await user.click(screen.getByRole("button", { name: "Me prévenir" }));

    expect(await screen.findByRole("status")).toHaveTextContent("C'est noté.");
    expect(screen.getByRole("status")).toHaveFocus();
    const sent = vi.mocked(requestLaunchReminder).mock.calls[0]![1];
    expect(sent.get("email")).toBe("aicha@kolab.test");
    expect(sent.get("website")).toBe("");
  });

  it("keeps the address and names the support address when saving fails", async () => {
    vi.mocked(requestLaunchReminder).mockResolvedValue({
      status: "error",
      error: "unavailable",
      email: "aicha@kolab.test",
    });
    const user = userEvent.setup();
    render(withIntl(<LaunchPanel until={LAUNCH} />));

    await user.type(screen.getByLabelText("Recevez un e-mail à l'ouverture"), "aicha@kolab.test");
    await user.click(screen.getByRole("button", { name: "Me prévenir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("support@mocktar.com");
    expect(screen.getByLabelText("Recevez un e-mail à l'ouverture")).toHaveValue("aicha@kolab.test");
  });

  it("ties an invalid address to the field", async () => {
    vi.mocked(requestLaunchReminder).mockResolvedValue({
      status: "error",
      error: "emailInvalid",
      email: "aicha@",
    });
    const user = userEvent.setup();
    render(withIntl(<LaunchPanel until={LAUNCH} />));

    await user.type(screen.getByLabelText("Recevez un e-mail à l'ouverture"), "aicha@");
    await user.click(screen.getByRole("button", { name: "Me prévenir" }));

    const field = await screen.findByLabelText("Recevez un e-mail à l'ouverture");
    await vi.waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAccessibleDescription(/Saisissez une adresse e-mail valide\./);
    expect(field).toHaveFocus();
  });
});
