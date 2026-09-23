"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ToastVariant = "error" | "success";
export type Toast = { id: number; variant: ToastVariant; message: string };

let nextToastId = 1;

// Small, self-contained toast/notification system. Messages appear fixed to
// the top of the viewport (not buried inside a scrolled form) and clear
// themselves automatically. Meant to be reused by any page that needs to
// surface one or several specific error/success messages at once, instead
// of a single generic banner.
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextToastId++;
      setToasts((current) => [...current, { id, variant, message }]);
      const timer = setTimeout(() => dismiss(id), 6000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const pushError = useCallback((message: string) => push("error", message), [push]);
  // One toast PER message, so several distinct problems (e.g. three empty
  // required fields) each get their own clearly separate notification
  // instead of being merged into a single sentence.
  const pushErrors = useCallback((messages: string[]) => messages.forEach((message) => push("error", message)), [push]);
  const pushSuccess = useCallback((message: string) => push("success", message), [push]);

  return { toasts, pushError, pushErrors, pushSuccess, dismiss };
}

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-lg ${
            toast.variant === "error" ? "border-destructive/40 text-destructive" : "border-success/40 text-success"
          }`}
        >
          {toast.variant === "error" ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <p className="flex-1 text-foreground">{toast.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="بستن پیام"
            className="shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
