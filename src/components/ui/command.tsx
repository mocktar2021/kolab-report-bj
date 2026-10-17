"use client";

import * as React from "react";
import { Command as CommandPrimitive, defaultFilter } from "cmdk";
import { Search } from "lucide-react";
import { foldForSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

/** cmdk's own ranking, without accents or case: "energie" finds "Énergie". */
function foldedFilter(value: string, search: string, keywords?: string[]) {
  return defaultFilter(foldForSearch(value), foldForSearch(search), keywords?.map(foldForSearch));
}

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, filter = foldedFilter, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    filter={filter}
    className={cn("flex h-full w-full flex-col overflow-hidden text-popover-foreground", className)}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

type CommandDialogProps = React.ComponentProps<typeof Dialog> & {
  title: string;
  description: string;
  /** Name of the search field. cmdk renders it as a hidden label; without it the field has no name. */
  label: string;
  footer?: React.ReactNode;
};

function CommandDialog({ title, description, label, footer, children, ...props }: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command loop label={label}>
          {children}
        </Command>
        {footer}
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-3 border-b px-4">
    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-12 w-full bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[min(60vh,22rem)] overflow-y-auto overscroll-contain p-2", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="px-4 py-10 text-center text-small text-muted-foreground"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  // Only a line between groups. Hidden from screen readers: a separator is not
  // allowed inside the listbox that cmdk renders.
  <CommandPrimitive.Separator
    ref={ref}
    aria-hidden="true"
    className={cn("-mx-2 my-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[selected=true]:[&_svg]:text-highlight",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
