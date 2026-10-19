import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { useLazyMenu, useLazyMenuFocus, type LazyMenuProps } from "./lazy-menu";

// A menu whose button says how it was opened before it loaded.
function FakeMenu(props: LazyMenuProps) {
  const { button } = useLazyMenuFocus(props);
  return (
    <button ref={button} type="button" data-testid="menu" data-opened={props.openedWith ?? "no"}>
      Thème
    </button>
  );
}

// The same with Radix, as the theme and workspace menus use it.
function RadixMenu(props: LazyMenuProps) {
  const { button, onContentFocus } = useLazyMenuFocus(props);
  return (
    <DropdownMenu defaultOpen={props.openedWith !== null}>
      <DropdownMenuTrigger asChild>
        <button ref={button} type="button">
          Thème
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onFocus={onContentFocus}>
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        <DropdownMenuItem>Clair</DropdownMenuItem>
        <DropdownMenuItem>Sombre</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

beforeAll(() => {
  // Radix menus measure themselves with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
function deferredLoad(menu: typeof FakeMenu = FakeMenu) {
  let resolve: () => void = () => {};
  let reject: () => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<typeof FakeMenu>((res, rej) => {
        resolve = () => res(menu);
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
    expect(screen.getByTestId("menu")).toHaveAttribute("data-opened", "no");
  });

  it.each([
    ["a click", "pointer", (user: ReturnType<typeof userEvent.setup>) => user.click(placeholder())],
    ["Enter", "keyboard", (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Enter}")],
    ["Space", "keyboard", (user: ReturnType<typeof userEvent.setup>) => user.keyboard(" ")],
    ["Arrow Down", "keyboard", (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{ArrowDown}")],
    [
      "a click without pointer down",
      "keyboard",
      async () => {
        fireEvent.click(placeholder());
      },
    ],
  ])("opens the menu once loaded when the button got %s", async (_, openedWith, use) => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    act(() => placeholder().focus());
    await use(user);
    await resolve();
    expect(screen.getByTestId("menu")).toHaveAttribute("data-opened", openedWith);
  });

  it("does not open on a right click or a Ctrl click", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad();
    render(<Harness load={load} />);
    await user.pointer({ keys: "[MouseRight]", target: placeholder() });
    await user.keyboard("{Control>}");
    await user.pointer({ keys: "[MouseLeft>]", target: placeholder() });
    await resolve();
    expect(screen.getByTestId("menu")).toHaveAttribute("data-opened", "no");
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

  it("starts a Radix menu opened from the keyboard on its first item, as Radix does", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad(RadixMenu);
    render(<Harness load={load} />);
    act(() => placeholder().focus());
    await user.keyboard("{Enter}");
    await resolve();
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Clair" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Thème" })).toHaveFocus();
  });

  it("starts a Radix menu opened with the pointer on the menu itself, as Radix does", async () => {
    const user = userEvent.setup();
    const { load, resolve } = deferredLoad(RadixMenu);
    render(<Harness load={load} />);
    await user.click(placeholder());
    await resolve();
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveFocus();
  });
});
