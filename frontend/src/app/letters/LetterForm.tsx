"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import {
  ALLOWED_ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  formatFileSize,
  personName,
  roleLabels,
  type DirectoryUser,
  type LetterAttachment,
  type LetterDetail,
  notifyLettersChanged,
} from "./shared";

type Props = { mode: "create" } | { mode: "edit"; letterId: number };

const MAX_ATTACHMENTS = 10;

// Compose / edit a DRAFT letter. Saving never delivers anything — the letter
// reaches its addressees only on «ارسال نامه», which also assigns its number.
// Files are staged here and uploaded right after the draft is saved (the
// backend takes attachments only against an existing draft).
export function LetterForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const letterId = props.mode === "edit" ? props.letterId : null;

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  // Names for chips of people who may not be in the directory (a disabled user).
  const [extraPeople, setExtraPeople] = useState<Record<number, DirectoryUser>>({});
  const [search, setSearch] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [savedAttachments, setSavedAttachments] = useState<LetterAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<{ id: number; subject: string; letterNumber: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "send">(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const people = await apiFetch<DirectoryUser[]>("/letters/directory");
        if (cancelled) return;
        setDirectory(people);

        if (letterId !== null) {
          const letter = await apiFetch<LetterDetail>(`/letters/${letterId}`);
          if (cancelled) return;
          if (letter.status !== "DRAFT" || !letter.isSender) {
            setLoadError("فقط پیش‌نویس خودتان قابل ویرایش است.");
            return;
          }
          setSubject(letter.subject);
          setBody(letter.body);
          setRecipientIds(letter.recipients.map((recipient) => recipient.id));
          setExtraPeople(Object.fromEntries(letter.recipients.map((recipient) => [recipient.id, recipient])));
          setSavedAttachments(letter.attachments);
          return;
        }

        const replyId = new URLSearchParams(window.location.search).get("replyTo");
        if (replyId && /^\d+$/.test(replyId)) {
          const parent = await apiFetch<LetterDetail>(`/letters/${replyId}`);
          if (cancelled) return;
          if (!parent.canReply) {
            setLoadError("امکان پاسخ به این نامه وجود ندارد.");
            return;
          }
          setReplyTo({ id: parent.id, subject: parent.subject, letterNumber: parent.letterNumber });
          setSubject(parent.subject.startsWith("پاسخ:") ? parent.subject : `پاسخ: ${parent.subject}`);
          setRecipientIds([parent.sender.id]);
          setExtraPeople({ [parent.sender.id]: { ...parent.sender, role: "" } });
        }
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [letterId]);

  const peopleById = useMemo(() => {
    const map = new Map<number, DirectoryUser>(Object.entries(extraPeople).map(([id, person]) => [Number(id), person]));
    for (const person of directory) map.set(person.id, person);
    return map;
  }, [directory, extraPeople]);

  const filteredDirectory = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return directory;
    return directory.filter((person) => `${personName(person)} ${person.username} ${roleLabels[person.role] ?? person.role}`.toLocaleLowerCase().includes(term));
  }, [directory, search]);

  function toggleRecipient(id: number) {
    setRecipientIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...stagedFiles];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_ATTACHMENT_BYTES) problems.push(`«${file.name}» بزرگ‌تر از ۱۰ مگابایت است.`);
      else if (savedAttachments.length + next.length >= MAX_ATTACHMENTS) problems.push(`حداکثر ${MAX_ATTACHMENTS} پیوست مجاز است.`);
      else next.push(file);
    }
    setStagedFiles(next);
    if (problems.length > 0) pushErrors(problems);
  }

  async function removeSavedAttachment(attachment: LetterAttachment) {
    if (letterId === null) return;
    try {
      await apiFetch(`/letters/${letterId}/attachments/${attachment.id}`, { method: "DELETE" });
      setSavedAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف پیوست ناموفق بود.");
    }
  }

  // Saves the draft and uploads staged files. Returns the letter id, or null
  // when something failed (the user is told what).
  async function saveDraft(): Promise<number | null> {
    const payload = { subject: subject.trim(), body: body.trim(), recipientUserIds: recipientIds };
    let id = letterId;
    try {
      if (id === null) {
        const created = await apiFetch<LetterDetail>("/letters", {
          method: "POST",
          body: JSON.stringify({ ...payload, ...(replyTo ? { inReplyToId: replyTo.id } : {}) }),
        });
        id = created.id;
      } else {
        await apiFetch(`/letters/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ذخیرهٔ نامه ناموفق بود.");
      return null;
    }

    const failed: string[] = [];
    for (const file of stagedFiles) {
      try {
        await apiUpload(`/letters/${id}/attachments`, file);
      } catch (reason) {
        failed.push(`«${file.name}»: ${(reason as ApiError).message ?? "بارگذاری ناموفق بود."}`);
      }
    }
    if (failed.length > 0) {
      pushErrors(["نامه به‌صورت پیش‌نویس ذخیره شد اما این پیوست‌ها بارگذاری نشدند:", ...failed]);
      // Land on the draft's edit page so the user can retry the files.
      router.replace(`/letters/${id}/edit`);
      return null;
    }
    return id;
  }

  async function submit(event: { preventDefault: () => void }, action: "save" | "send") {
    event.preventDefault();
    if (!subject.trim()) return pushError("موضوع نامه را وارد کنید.");
    if (!body.trim()) return pushError("متن نامه را وارد کنید.");
    if (action === "send" && recipientIds.length === 0) return pushError("برای ارسال، حداقل یک گیرنده را انتخاب کنید.");

    setBusy(action);
    try {
      const id = await saveDraft();
      if (id === null) return;
      if (action === "send") {
        try {
          await apiFetch(`/letters/${id}/send`, { method: "POST" });
        } catch (reason) {
          pushError(`نامه به‌صورت پیش‌نویس ذخیره شد اما ارسال نشد: ${(reason as ApiError).message ?? ""}`);
          router.replace(`/letters/${id}/edit`);
          return;
        }
        notifyLettersChanged();
        pushSuccess("نامه ارسال شد.");
      } else {
        pushSuccess("پیش‌نویس ذخیره شد.");
      }
      router.push(`/letters/${id}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <form className="mx-auto max-w-4xl space-y-4" onSubmit={(event) => void submit(event, "save")} noValidate>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{letterId === null ? (replyTo ? "پاسخ به نامه" : "نامه جدید") : "ویرایش پیش‌نویس"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">نامه فقط پس از «ارسال» به گیرندگان می‌رسد و شماره می‌گیرد. نامهٔ ارسال‌شده دیگر قابل ویرایش یا حذف نیست.</p>
          {replyTo ? (
            <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              پاسخ به: {replyTo.letterNumber ? <span className="font-mono">{replyTo.letterNumber}</span> : null} — {replyTo.subject}
            </p>
          ) : null}
        </div>

        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-1.5">
            <Label>گیرندگان</Label>
            {recipientIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {recipientIds.map((id) => {
                  const person = peopleById.get(id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 ps-2.5 pe-1 text-xs text-primary">
                      {person ? personName(person) : `کاربر ${id}`}
                      <button type="button" className="rounded-full p-0.5 hover:bg-primary/20" aria-label="حذف گیرنده" onClick={() => toggleRecipient(id)}>
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">هنوز گیرنده‌ای انتخاب نشده است (برای ذخیرهٔ پیش‌نویس لازم نیست، برای ارسال لازم است).</p>
            )}
            <div className="overflow-hidden rounded-md border border-input">
              <label className="flex h-9 items-center border-b border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی گیرنده</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجوی کاربر (نام، نام کاربری یا نقش)"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <ul className="max-h-48 divide-y divide-border overflow-y-auto bg-background">
                {filteredDirectory.length === 0 ? (
                  <li className="px-3 py-4 text-center text-xs text-muted-foreground">کاربری یافت نشد.</li>
                ) : (
                  filteredDirectory.map((person) => (
                    <li key={person.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                        <input type="checkbox" className="size-4" checked={recipientIds.includes(person.id)} onChange={() => toggleRecipient(person.id)} />
                        <span className="flex-1">{personName(person)}</span>
                        <span className="text-xs text-muted-foreground">{roleLabels[person.role] ?? person.role}</span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="letter-subject">
              موضوع<RequiredMark />
            </Label>
            <Input id="letter-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="letter-body">
              متن نامه<RequiredMark />
            </Label>
            <textarea id="letter-body" className={`${textareaClass} min-h-56`} value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
            <p className="text-xs text-muted-foreground">
              به‌جای نوشتن اطلاعات، فقط کد سند را بنویسید (مثلاً SO-1405-000020 یا CUS-000003 یا کد کالا) — در نامه به‌صورت لینک نمایش داده می‌شود و گیرنده با یک کلیک به همان صفحه می‌رسد (در صورت داشتن دسترسی).
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="letter-files">پیوست‌ها (PDF، تصویر، Word یا Excel — حداکثر ۱۰ مگابایت)</Label>
            <input
              id="letter-files"
              type="file"
              multiple
              accept={ALLOWED_ATTACHMENT_ACCEPT}
              className="text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-sm"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {savedAttachments.length > 0 || stagedFiles.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {savedAttachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1">{attachment.originalName}</span>
                    <span className="text-xs text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
                    <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void removeSavedAttachment(attachment)}>
                      حذف
                    </Button>
                  </li>
                ))}
                {stagedFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{formatFileSize(file.size)} — پس از ذخیره بارگذاری می‌شود</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setStagedFiles((current) => current.filter((_, i) => i !== index))}>
                      برداشتن
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="success" disabled={busy !== null} onClick={(event) => void submit(event, "send")}>
            {busy === "send" ? "در حال ارسال..." : "ارسال نامه"}
          </Button>
          <Button type="submit" variant="outline" disabled={busy !== null}>
            {busy === "save" ? "در حال ذخیره..." : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => router.back()}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
