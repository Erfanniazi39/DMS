"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CornerUpLeft, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { toPersianDigits } from "@/lib/jalali";
import { LinkedText, extractCodeCandidates } from "../LinkedText";
import { formatDateTime, formatFileSize, notifyLettersChanged, personName, roleLabels, type LetterDetail } from "../shared";

export default function LetterDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const [letter, setLetter] = useState<LetterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "delete" | "archive">(null);

  // Bumped to re-fetch the letter in place after an action.
  const [reloadKey, setReloadKey] = useState(0);
  // Document/item codes found in the letter that this reader may open → their page.
  const [links, setLinks] = useState<Record<string, string>>({});
  const validId = Number.isInteger(id);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<LetterDetail>(`/letters/${id}`);
        if (cancelled) return;
        setLetter(data);
        // Opening a received letter marks it read (the sender opening their
        // own letter changes nothing).
        if (data.my && !data.my.readAt) {
          await apiFetch(`/letters/${id}/read`, { method: "POST" }).catch(() => undefined);
          notifyLettersChanged();
        }
      } catch (reason) {
        if (cancelled) return;
        if ((reason as ApiError).status === 404) setNotFound(true);
        else pushError((reason as ApiError).message ?? "دریافت نامه ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, validId, reloadKey]);

  // Codes in the subject/body become one-click links — only for records that
  // exist and pages this reader's own permissions allow.
  useEffect(() => {
    if (!letter) return;
    const codes = extractCodeCandidates(`${letter.subject}\n${letter.body}`);
    if (codes.length === 0) return;
    let cancelled = false;
    async function resolve() {
      try {
        const rows = await apiFetch<{ code: string; href: string }[]>("/letters/resolve-codes", { method: "POST", body: JSON.stringify({ codes }) });
        if (!cancelled) setLinks(Object.fromEntries(rows.map((row) => [row.code, row.href])));
      } catch {
        // Links are a convenience — the letter reads fine without them.
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [letter]);

  async function send() {
    setBusy("send");
    try {
      await apiFetch(`/letters/${id}/send`, { method: "POST" });
      notifyLettersChanged();
      pushSuccess("نامه ارسال شد.");
      setReloadKey((key) => key + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "ارسال نامه ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("این پیش‌نویس حذف شود؟")) return;
    setBusy("delete");
    try {
      await apiFetch(`/letters/${id}`, { method: "DELETE" });
      router.replace("/letters/drafts");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف پیش‌نویس ناموفق بود.");
      setBusy(null);
    }
  }

  async function toggleArchive(archive: boolean) {
    setBusy("archive");
    try {
      await apiFetch(`/letters/${id}/${archive ? "archive" : "unarchive"}`, { method: "POST" });
      notifyLettersChanged();
      pushSuccess(archive ? "نامه بایگانی شد." : "نامه به صندوق دریافت بازگشت.");
      setReloadKey((key) => key + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "تغییر وضعیت نامه ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  if (validId && loading) return <p className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری نامه...</p>;
  if (!validId || notFound || !letter) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">نامه پیدا نشد.</p>
      </div>
    );
  }

  const isDraft = letter.status === "DRAFT";
  const archived = letter.my?.archivedAt != null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight"><LinkedText text={letter.subject} links={links} /></h1>
              <StatusBadge label={isDraft ? "پیش‌نویس" : "ارسال‌شده"} tone={isDraft ? "warning" : "success"} />
              {archived ? <StatusBadge label="بایگانی‌شده" tone="muted" /> : null}
            </div>
            {letter.letterNumber ? <p className="mt-1 font-mono text-sm text-muted-foreground">{letter.letterNumber}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && letter.isSender ? (
              <>
                <Button variant="success" disabled={busy !== null || letter.recipients.length === 0} onClick={() => void send()}>
                  {busy === "send" ? "در حال ارسال..." : "ارسال نامه"}
                </Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/letters/${letter.id}/edit`)}>
                  ویرایش
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                  {busy === "delete" ? "در حال حذف..." : "حذف"}
                </Button>
              </>
            ) : null}
            {letter.canReply ? (
              <Button onClick={() => router.push(`/letters/new?replyTo=${letter.id}`)}>
                <CornerUpLeft className="size-4" aria-hidden="true" />
                پاسخ
              </Button>
            ) : null}
            {letter.my ? (
              <Button variant="outline" disabled={busy !== null} onClick={() => void toggleArchive(!archived)}>
                {archived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                {archived ? "بازگرداندن به صندوق" : "بایگانی"}
              </Button>
            ) : null}
          </div>
        </div>

        {letter.managementView ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            مشاهدهٔ مدیریتی — این نامه به شما ارسال نشده است. دسترسی شما فقط‌خواندنی است و این مشاهده ثبت می‌شود.
          </p>
        ) : null}

        {isDraft && letter.recipients.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">برای ارسال این نامه ابتدا از «ویرایش» حداقل یک گیرنده انتخاب کنید.</p>
        ) : null}

        <section className="rounded-lg border border-border bg-card">
          <dl className="grid gap-x-6 gap-y-3 border-b border-border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">فرستنده</dt>
              <dd className="mt-0.5">{personName(letter.sender)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{isDraft ? "آخرین ویرایش" : "تاریخ ارسال"}</dt>
              <dd className="mt-0.5">{formatDateTime(isDraft ? letter.updatedAt : letter.sentAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">گیرندگان ({toPersianDigits(letter.recipients.length)})</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {letter.recipients.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                {letter.recipients.map((recipient) => (
                  <span key={recipient.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs">
                    {personName(recipient)}
                    <span className="text-muted-foreground">({roleLabels[recipient.role] ?? recipient.role})</span>
                    {/* Read receipts: the sender's view, and management's. */}
                    {recipient.readAt !== undefined && !isDraft ? (
                      <span className={recipient.readAt ? "text-success" : "text-muted-foreground"}>
                        {recipient.readAt ? `خوانده شد ${formatDateTime(recipient.readAt)}` : "خوانده‌نشده"}
                      </span>
                    ) : null}
                  </span>
                ))}
              </dd>
            </div>
            {letter.inReplyTo ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">در پاسخ به</dt>
                <dd className="mt-0.5">
                  <Link href={`/letters/${letter.inReplyTo.id}`} className="text-primary hover:underline">
                    {letter.inReplyTo.letterNumber ? <span className="font-mono">{letter.inReplyTo.letterNumber} — </span> : null}
                    {letter.inReplyTo.subject}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="whitespace-pre-wrap p-4 text-sm leading-7"><LinkedText text={letter.body} links={links} /></div>
        </section>

        {letter.attachments.length > 0 ? (
          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-sm font-medium">پیوست‌ها</h2>
            <ul className="divide-y divide-border">
              {letter.attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <a className="flex-1 text-primary hover:underline" href={`/api/letters/attachments/${attachment.id}/file`} target="_blank" rel="noreferrer">
                    {attachment.originalName}
                  </a>
                  <span className="text-xs text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {letter.replies.length > 0 ? (
          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-sm font-medium">پاسخ‌ها</h2>
            <ul className="divide-y divide-border">
              {letter.replies.map((reply) => (
                <li key={reply.id}>
                  <Link href={`/letters/${reply.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm hover:bg-muted/40">
                    <span className="font-mono text-xs text-muted-foreground">{reply.letterNumber}</span>
                    <span className="flex-1">{reply.subject}</span>
                    <span className="text-xs text-muted-foreground">
                      {personName(reply.senderUser)} — {formatDateTime(reply.sentAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
