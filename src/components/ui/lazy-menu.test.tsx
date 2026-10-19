import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useLazyMenu, useLazyMenuFocus, type LazyMenuProps } from "./lazy-menu";

// A menu whose button says whether it started open.
function FakeMenu(props: LazyMenuProps) {
  const button = useLazyMenuFocus(props);
  return (
    <button ref={button} type="button" data-testid="menu" data-open={String(props.defaultOpen)}>
      Thème
    </button>
  );
}

function Harness({ load }: { load: () => Promise<typeof FakeMenu> }) {
  const { Menu, menuProps, placeholderProps } = useLazyMenu(load);
  return (
    <>
      <button type="button">Avant</button>
      {Menu ? (
        <Menu {...menuProps} />
      ) : (
        <button type="button" data-testid="placeholder" {...placeholderProps}>
          Thème
        </button>
      )}
    </>
  );
}

/** A load that resolves when the test says so. */
function deferredLoad() {
  let resolve: () => void = () => {};
  let reject: () => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<typeof FakeMenu>((res, rej) => {
        resolve = () => res(FakeMenu);
        reject = () => rej(new Error("offline"));
      }),
  );
  return {
    load,
    resolve: () => act(async () => resolve()),
    reject: () => act(async () => reject()),
  };
}

const placeholder = () => screen.getByTestId("placeholder");

describe("useLazyMenu (KRB-212)", () => {
  it("renders the placeholder, with what Radix puts on a closed menu button", () => {
    const { load } = deferredLoad();
    render(<Harness load={load} />);
    expect(placeholder()).toHaveAttribute("aria-haspopup", "menu");
    expect(placeholder()).toHaveAttribute("aria-expanded", "false");
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once, when the button is pointed at or focused, and the menu starts closed", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    await user.hover(placeholder());
    await user.tab();
    await user.tab();
    expect(load).toHaveBeenCalledTimes(1);

    await resolve();
    expect(screen.getByTestId("menu")).toHaveAttribute("data-open", "false");
  });

  it.each([
    ["a pointer down", (user: ReturnType<typeof userEvent.setup>) => user.click(placeholder())],
    ["Enter", (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Enter}")],
    ["Space", (user: ReturnType<typeof userEvent.setup>) => user.keyboard(" ")],
    ["Arrow Down", (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{ArrowDown}")],
  ])("opens the menu once loaded when the button got %s", async (_, use) => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    placeholder().focus();
    await use(user);
    await resolve();
    expect(screen.getByTestId("menu")).toHaveAttribute("data-open", "true");
  });

  it("does not open on a right click or a Ctrl click", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    await user.pointer({ keys: "[MouseRight]", target: placeholder() });
    await user.keyboard("{Control>}");
    await user.pointer({ keys: "[MouseLeft>]", target: placeholder() });
    await resolve();
    expect(screen.getByTestId("menu")).toHaveAttribute("data-open", "false");
  });

  it("gives the focus to the menu's button when the placeholder had it", async () => {
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    act(() => placeholder().focus());
    await resolve();
    expect(screen.getByTestId("menu")).toHaveFocus();
  });

  it("leaves the focus alone when the placeholder did not have it", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    await user.hover(placeholder());
    await resolve();
    expect(screen.getByTestId("menu")).not.toHaveFocus();
  });

  it("tries again on the next use when the load failed", async () => {
    const user = userEvent.setup();
    const { load, reject } = deferredLoad();
    render(<Harness load={load} />);
    await user.hover(placeholder());
    await reject();
    expect(placeholder()).toBeInTheDocument();

    await user.unhover(placeholder());
    await user.hover(placeholder());
    expect(load).toHaveBeenCalledTimes(2);
  });
});
