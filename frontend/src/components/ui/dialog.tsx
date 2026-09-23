"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "cn";

// A real popup: fixed to the screen, centered, with its own backdrop — it
// never becomes part of the page's own scroll flow, and (being "modal" by
// default) the page behind it can't scroll while it's open either.
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogBackdrop({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn("fixed inset-0 z-50 bg-black/60 transition-opacity", className)}
      {...props}
    />
  );
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </div>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base font-semibold", className)} {...props} />;
}

// Placed as a normal flex sibling of the title inside DialogHeader (not
// absolutely positioned with left/right), so it lands on the correct side
// automatically in this RTL app without any physical-direction CSS.
function DialogCloseButton({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      aria-label="بستن"
      className={cn("shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
      {...props}
    >
      <X className="size-4" />
    </DialogPrimitive.Close>
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 items-center justify-start gap-2 border-t border-border bg-muted/40 px-5 py-3", className)}
      {...props}
    />
  );
}

export { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogHeader, DialogTitle, DialogCloseButton, DialogBody, DialogFooter };
