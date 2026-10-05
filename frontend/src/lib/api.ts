// `code`/`details` are set when the backend returns a machine-readable error
// (e.g. code "RECORD_MODIFIED" for an optimistic-locking conflict, or
// "PURCHASE_QUANTITY_EXCEEDS_REQUEST" with details.overages) so a page can
// react to that specific case instead of just showing the message.
export type ApiError = { message: string; status: number; messages?: string[]; code?: string; details?: unknown };

function collectZodMessages(data: unknown): string[] {
  const errors = (data as { errors?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } | undefined)?.errors;
  if (!errors) return [];
  const fieldMessages = Object.values(errors.fieldErrors ?? {}).flat();
  const formMessages = errors.formErrors ?? [];
  return [...formMessages, ...fieldMessages];
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "include",
  });

  if (!res.ok) {
    let message = "خطایی رخ داد. لطفاً دوباره تلاش کنید.";
    let messages: string[] | undefined;
    let code: string | undefined;
    let details: unknown;
    try {
      const data = await res.json();
      if (typeof data?.code === "string") code = data.code;
      details = data?.details;
      if (typeof data?.message === "string") {
        message = data.message;
      } else if (Array.isArray(data?.message)) {
        messages = data.message;
        message = data.message.join("، ");
      }
      // Zod validation failures (see ZodValidationPipe) carry the specific,
      // per-field messages under `errors`, not in `message`. Surface those
      // individually when present so the user sees exactly what was wrong,
      // not just a generic "invalid data" sentence.
      const zodMessages = collectZodMessages(data);
      if (zodMessages.length > 0) {
        messages = zodMessages;
        message = zodMessages.join("، ");
      }
    } catch {
      // ignore JSON parse errors, fall back to the default message
    }
    throw { message, messages, status: res.status, code, details } satisfies ApiError;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// For endpoints that accept a file (multipart/form-data) instead of JSON —
// e.g. uploading an employee photo. Deliberately separate from apiFetch,
// which always sends "Content-Type: application/json"; a FormData body
// needs the browser to set its own multipart boundary instead.
export async function apiUpload<T>(path: string, file: File, fieldName = "file"): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const res = await fetch(`/api${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    let message = "بارگذاری فایل ناموفق بود.";
    let messages: string[] | undefined;
    try {
      const data = await res.json();
      if (typeof data?.message === "string") {
        message = data.message;
      } else if (Array.isArray(data?.message)) {
        messages = data.message;
        message = data.message.join("، ");
      }
    } catch {
      // ignore JSON parse errors, fall back to the default message
    }
    throw { message, messages, status: res.status } satisfies ApiError;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
