"use client";

import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { useLazyMenu, type LazyMenuProps } from "@/components/ui/lazy-menu";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
// Listens for the browser's install event with the page, not with the menu:
// Chrome fires it once, often before the menu is first used (KRB-205).
import "@/lib/pwa/install";

export type AccountMenuProps = {
  user: { name: string; email: string };
  /**
   * "pill": the menu icon and the avatar, top right of the desktop bar.
   * "avatar": the avatar alone, in the top bar below lg, whose menu button
   * already opens the navigation.
   */
  variant: "pill" | "avatar";
  /** The desktop bar: the menu also collapses or expands the sidebar. */
  sidebarToggle?: boolean;
};

/** The button of the account menu, before and after the menu loads. */
export function AccountButton({
  user,
  variant,
  className,
  ...props
}: React.ComponentProps<"button"> & Pick<AccountMenuProps, "user" | "variant">) {
  const t = useTranslations("AppShell");

  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 items-center rounded-full outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
        variant === "pill"
          ? "h-10 gap-2.5 border bg-card pl-3 pr-1 text-muted-foreground shadow-sm hover:text-foreground hover:shadow-md data-[state=open]:text-foreground data-[state=open]:shadow-md"
          : "size-9 justify-center hover:bg-accent data-[state=open]:bg-accent",
        className,
      )}
      {...props}
    >
      {/* The name comes from this text, not aria-label: axe wants a label to
          contain the visible text, here the initials of the avatar. */}
      <span className="sr-only">{t("accountMenu")}</span>
      {variant === "pill" ? <Menu className="size-4" aria-hidden="true" /> : null}
      <UserAvatar name={user.name} />
    </button>
  );
}

// The menu, Radix and the sign-out action load when the button is pointed at
// or focused, not with the page (KRB-212).
const loadAccountDropdown = () => import("./account-dropdown").then((mod) => mod.AccountDropdown);

/**
 * The account menu, top right (KRB-227): Mon compte, the guide, the install
 * item, the theme, signing out, collapsing the sidebar and the legal pages.
 * A click on the avatar or on the menu icon opens it.
 */
export function AccountMenu(props: AccountMenuProps) {
  const {
    Menu: Dropdown,
    menuProps,
    placeholderProps,
  } = useLazyMenu<AccountMenuProps & LazyMenuProps>(loadAccountDropdown);

  return Dropdown ? (
    <Dropdown {...props} {...menuProps} />
  ) : (
    <AccountButton user={props.user} variant={props.variant} {...placeholderProps} />
  );
}
