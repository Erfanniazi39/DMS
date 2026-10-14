import { apiFetch } from "@/lib/api";

// Prefills the code field of a "new record" form with the server's suggestion
// (PREFIX-000001, one past the highest existing). The suggestion is only a
// convenience: it is applied if the field is still empty, never replaces
// something the user already typed, and a failed request is silently ignored
// (the user just types a code as before). The code stays fully editable.
export function fillSuggestedCode(path: string, apply: (code: string) => void) {
  apiFetch<{ code: string }>(path)
    .then((result) => {
      if (result?.code) apply(result.code);
    })
    .catch(() => undefined);
}
