"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DatabaseBackup, FolderOpen, HardDriveDownload, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/audit-labels";
import { backupToDrive, driveSupport, pickDriveFolder, planForDrive, readDrive, uploadForRestore, waitForRun, type PlanLike, type RunLike } from "@/lib/backup-drive";
import { useHasPermission } from "@/lib/session";

type Mode = "server" | "browser";
type DriveBackup = { backupId: string; kind: "FULL" | "INCREMENTAL"; ordinal: number; createdAt: string; rows: number; files: number; bytes: number; generationId: string };
type Status = {
  system: { databaseId: string; lastBackupId: string | null; lastBackupAt: string | null; lastPath: string | null; pendingChanges: number };
  drive: { path: string; usable: boolean; problems: string[]; empty: boolean; foreign: boolean; freeBytes: number | null; backups: DriveBackup[] } | null;
  plan: PlanLike | null;
  running: { id: string; kind: string } | null;
};
type Run = RunLike & { startedAt: string; finishedAt: string | null; targetPath: string | null; ordinal: number | null; rowCount: number | null; fileCount: number | null; bytes: number | null };
type Progress = { message: string; done?: number; total?: number };

const RESTORE_WORD = "بازیابی";
const kindLabel: Record<string, string> = { FULL: "کامل", INCREMENTAL: "تغییرات", RESTORE: "بازیابی" };
const statusLabel: Record<string, string> = { RUNNING: "در حال اجرا", OK: "موفق", FAILED: "ناموفق" };

function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${value.toLocaleString("fa-IR")} بایت`;
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلوبایت`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
  return `${(value / 1024 / 1024 / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 2 })} گیگابایت`;
}

function ProgressBar({ progress }: { progress: Progress }) {
  const percent = progress.total ? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100)) : null;
  return (
    <div className="space-y-1.5" role="status">
      <p className="text-sm">{progress.message}</p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full bg-primary transition-all ${percent === null ? "w-1/3 animate-pulse" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}

function BackupContent() {
  const canRestore = useHasPermission("backup.restore");
  const [path, setPath] = useState("");
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [browserDrive, setBrowserDrive] = useState<{ backups: DriveBackup[]; plan: PlanLike; problems: string[] } | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DriveBackup | null>(null);
  const [confirmWord, setConfirmWord] = useState("");
  const [restored, setRestored] = useState(false);
  const support = driveSupport();
  // One way to choose the drive: the browse button. It works on whichever computer the admin sits at (the server
  // itself too). Only where the browser cannot open a folder picker (plain http on the LAN) is a typed server path offered.
  const mode: Mode = support.ok ? "browser" : "server";
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Start with the folder the last backup went to (kept by the server), so the admin only presses «بررسی».
    apiFetch<Status>("/backup/status")
      .then((first) => mounted.current && setPath((current) => current || first.system.lastPath || ""))
      .catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadRuns = useCallback(() => {
    apiFetch<Run[]>("/backup/runs").then((rows) => mounted.current && setRuns(rows)).catch(() => undefined);
  }, []);
  useEffect(loadRuns, [loadRuns]);

  const drive = mode === "server" ? status?.drive ?? null : browserDrive ? { backups: browserDrive.backups, usable: true, problems: browserDrive.problems } : null;
  const plan = mode === "server" ? status?.plan ?? null : browserDrive?.plan ?? null;

  async function check(chosen?: FileSystemDirectoryHandle) {
    const folder = chosen ?? handle;
    setError(null);
    setNotice(null);
    setChecking(true);
    try {
      if (mode === "server") {
        if (!path.trim()) {
          setError("مسیر پوشهٔ حافظه را وارد کنید.");
          return;
        }
        setStatus(await apiFetch<Status>(`/backup/status?path=${encodeURIComponent(path.trim())}`));
      } else {
        if (!folder) {
          setError("ابتدا پوشهٔ حافظه را انتخاب کنید.");
          return;
        }
        const state = await readDrive(folder);
        const nextPlan = await planForDrive(state);
        setBrowserDrive({
          backups: state.manifests
            .map((m) => ({ backupId: m.backupId, kind: m.kind, ordinal: m.ordinal, createdAt: m.createdAt, rows: (m.totals as { rows: number }).rows, files: (m.totals as { files: number }).files, bytes: (m.totals as { bytes: number }).bytes, generationId: String(m.generationId) }))
            .sort((a, b) => b.ordinal - a.ordinal),
          plan: nextPlan,
          problems: state.hasOtherContent ? ["این پوشه خالی نیست و پشتیبان این سیستم هم در آن نیست؛ یک پوشهٔ خالی انتخاب کنید"] : state.invalid.map((name) => `پوشهٔ «${name}» پشتیبان کامل و معتبری نیست و نادیده گرفته شد`),
        });
        setStatus(await apiFetch<Status>("/backup/status"));
      }
      loadRuns();
    } catch (reason) {
      setError((reason as ApiError).message ?? "بررسی ناموفق بود.");
    } finally {
      setChecking(false);
    }
  }

  async function chooseFolder() {
    setError(null);
    try {
      const chosen = await pickDriveFolder();
      setHandle(chosen);
      setBrowserDrive(null);
      setStatus(null);
      await check(chosen);
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError") setError("انتخاب پوشه ناموفق بود.");
    }
  }

  function follow(run: RunLike, onDone: (finished: RunLike) => void) {
    waitForRun(run.id, null, (current) => mounted.current && current.progress?.message && setProgress({ message: current.progress.message, done: current.progress.done, total: current.progress.total }))
      .then(onDone)
      .catch((reason) => mounted.current && setError((reason as Error).message));
  }

  async function startBackup() {
    setError(null);
    setNotice(null);
    setBusy(true);
    setProgress({ message: "در حال شروع..." });
    try {
      if (mode === "server") {
        const run = await apiFetch<RunLike>("/backup/run", { method: "POST", body: JSON.stringify({ path: path.trim() }) });
        follow(run, (finished) => {
          setBusy(false);
          setProgress(null);
          if (finished.status === "OK") setNotice("پشتیبان‌گیری با موفقیت انجام شد.");
          else setError(finished.error ?? "پشتیبان‌گیری ناموفق بود.");
          void check();
        });
        return;
      }
      if (!handle) throw new Error("پوشهٔ حافظه انتخاب نشده است.");
      const finished = await backupToDrive(handle, (message, done, total) => mounted.current && setProgress({ message, done, total }));
      setNotice(finished.status === "OK" ? "پشتیبان‌گیری با موفقیت انجام شد." : (finished.error ?? "پشتیبان‌گیری ناموفق بود."));
      await check();
    } catch (reason) {
      setError((reason as ApiError).message ?? "پشتیبان‌گیری ناموفق بود.");
    } finally {
      if (mode === "browser") {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function startRestore() {
    if (!restoreTarget) return;
    setError(null);
    setBusy(true);
    setProgress({ message: "در حال شروع..." });
    const target = restoreTarget;
    setRestoreTarget(null);
    try {
      let run: RunLike;
      if (mode === "server") {
        run = await apiFetch<RunLike>("/backup/restore", { method: "POST", body: JSON.stringify({ path: path.trim(), backupId: target.backupId, confirmText: confirmWord.trim() }) });
      } else {
        if (!handle) throw new Error("پوشهٔ حافظه انتخاب نشده است.");
        const { jobId } = await uploadForRestore(handle, target.backupId, (message, done, total) => mounted.current && setProgress({ message, done, total }));
        run = await apiFetch<RunLike>(`/backup/remote/restore/${jobId}/start`, { method: "POST", body: JSON.stringify({ confirmText: confirmWord.trim() }) });
      }
      setConfirmWord("");
      pollRestore(run.id);
    } catch (reason) {
      setError((reason as ApiError).message ?? "بازیابی ناموفق بود.");
      setBusy(false);
      setProgress(null);
    }
  }

  // While the data is being replaced the server answers 503 with its progress; once it is done the run reads normally.
  function pollRestore(runId: string) {
    const timer = window.setInterval(async () => {
      try {
        const run = await apiFetch<Run>(`/backup/runs/${runId}`);
        if (run.status === "RUNNING") {
          if (run.progress?.message) setProgress({ message: run.progress.message, done: run.progress.done, total: run.progress.total });
          return;
        }
        window.clearInterval(timer);
        setBusy(false);
        setProgress(null);
        if (run.status === "OK") setRestored(true);
        else setError(run.error ?? "بازیابی ناموفق بود؛ اطلاعات فعلی تغییری نکرده است.");
      } catch (reason) {
        const failure = reason as ApiError;
        if (failure.status === 503) {
          const info = failure.details as { message?: string; percent?: number } | undefined;
          setProgress({ message: info?.message ?? "در حال بازیابی...", done: info?.percent, total: 100 });
        }
      }
    }, 1200);
  }

  const restorePoints = drive?.backups ?? [];
  const planTone = plan?.kind === "BLOCKED" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5";

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-2">
        <DatabaseBackup className="size-5" />
        <h1 className="text-lg font-semibold">پشتیبان‌گیری و بازیابی</h1>
      </div>

      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" role="status">{notice}</p> : null}

      {busy && progress ? (
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <ProgressBar progress={progress} />
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">محل حافظه (فلش)</h2>
        {support.ok ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void chooseFolder()} disabled={busy || checking}>
              <FolderOpen /> انتخاب پوشه
            </Button>
            <span className="text-sm text-muted-foreground" dir="ltr">{handle?.name ?? "پوشه‌ای انتخاب نشده است"}</span>
            {handle ? (
              <Button variant="outline" onClick={() => void check()} disabled={checking || busy}>
                <RefreshCw /> بررسی دوباره
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {support.reason} تا آن موقع می‌توانید مسیر پوشهٔ حافظه را روی کامپیوتر سرور وارد کنید.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="backup-path">مسیر پوشه روی سرور</Label>
                <Input id="backup-path" dir="ltr" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/media/usb/backup" disabled={busy} />
              </div>
              <Button onClick={() => void check()} disabled={checking || busy}>
                <RefreshCw /> بررسی
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">پوشه باید خالی باشد یا قبلاً برای پشتیبان‌گیری همین سیستم استفاده شده باشد.</p>
        <p className="text-xs text-muted-foreground">پشتیبان شامل تمام اطلاعات سیستم (از جمله اطلاعات شخصی و مالی) است و رمزگذاری نشده؛ حافظه را در جای امن نگه دارید.</p>
      </section>

      {status ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">مقایسهٔ دو طرف</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">آخرین پشتیبان ثبت‌شده در سیستم</dt>
              <dd className="mt-1">{status.system.lastBackupAt ? formatDateTime(status.system.lastBackupAt) : "هنوز پشتیبانی گرفته نشده"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">آخرین پشتیبان روی حافظه</dt>
              <dd className="mt-1">{drive?.backups[0] ? `${formatDateTime(drive.backups[0].createdAt)} (${kindLabel[drive.backups[0].kind]})` : drive ? "پشتیبانی روی حافظه نیست" : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تغییرات ثبت‌شده از آخرین پشتیبان</dt>
              <dd className="mt-1 tabular-nums">{status.system.pendingChanges.toLocaleString("fa-IR")}</dd>
            </div>
            {status.drive?.freeBytes != null && mode === "server" ? (
              <div>
                <dt className="text-xs text-muted-foreground">فضای خالی حافظه</dt>
                <dd className="mt-1">{formatBytes(status.drive.freeBytes)}</dd>
              </div>
            ) : null}
          </dl>

          {plan ? (
            <div className={`rounded-lg border p-3 text-sm ${planTone}`}>
              <p className="font-medium">
                {plan.kind === "FULL" ? "پشتیبان کامل گرفته می‌شود" : plan.kind === "INCREMENTAL" ? "فقط تغییرات از آخرین پشتیبان این حافظه گرفته می‌شود" : "پشتیبان‌گیری ممکن نیست"}
              </p>
              <ul className="mt-1 list-disc ps-5">
                {plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          ) : null}
          {drive?.problems?.length && plan?.kind !== "BLOCKED" ? (
            <ul className="list-disc ps-5 text-xs text-muted-foreground">{drive.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          ) : null}

          <Button disabled={busy || !plan || plan.kind === "BLOCKED" || status.running !== null} onClick={() => void startBackup()}>
            <HardDriveDownload /> شروع پشتیبان‌گیری
          </Button>
        </section>
      ) : null}

      {drive && drive.backups.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">پشتیبان‌های روی حافظه</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">شماره</th>
                  <th className="px-3 py-2 text-start font-medium">نوع</th>
                  <th className="px-3 py-2 text-start font-medium">تاریخ</th>
                  <th className="px-3 py-2 text-start font-medium">ردیف‌ها / تغییرات</th>
                  <th className="px-3 py-2 text-start font-medium">فایل‌ها</th>
                  <th className="px-3 py-2 text-start font-medium">حجم</th>
                  {canRestore ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {restorePoints.map((backup) => (
                  <tr key={backup.backupId}>
                    <td className="px-3 py-2 tabular-nums">{backup.ordinal.toLocaleString("fa-IR")}</td>
                    <td className="px-3 py-2">{kindLabel[backup.kind]}</td>
                    <td className="px-3 py-2">{formatDateTime(backup.createdAt)}</td>
                    <td className="px-3 py-2 tabular-nums">{backup.rows.toLocaleString("fa-IR")}</td>
                    <td className="px-3 py-2 tabular-nums">{backup.files.toLocaleString("fa-IR")}</td>
                    <td className="px-3 py-2">{formatBytes(backup.bytes)}</td>
                    {canRestore ? (
                      <td className="px-3 py-2 text-end">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setConfirmWord(""); setRestoreTarget(backup); }}>
                          <RotateCcw /> بازیابی
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">تاریخچهٔ پشتیبان‌گیری و بازیابی</h2>
        {runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز موردی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">نوع</th>
                  <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                  <th className="px-3 py-2 text-start font-medium">شروع</th>
                  <th className="px-3 py-2 text-start font-medium">ردیف / تغییر</th>
                  <th className="px-3 py-2 text-start font-medium">مقصد</th>
                  <th className="px-3 py-2 text-start font-medium">توضیح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2">{kindLabel[run.kind] ?? run.kind}</td>
                    <td className={`px-3 py-2 ${run.status === "FAILED" ? "text-destructive" : ""}`}>{statusLabel[run.status] ?? run.status}</td>
                    <td className="px-3 py-2">{formatDateTime(run.startedAt)}</td>
                    <td className="px-3 py-2 tabular-nums">{run.rowCount === null ? "—" : run.rowCount.toLocaleString("fa-IR")}</td>
                    <td className="max-w-56 truncate px-3 py-2" dir="ltr" title={run.targetPath ?? ""}>{run.targetPath ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{run.error ?? run.progress?.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => (open ? undefined : setRestoreTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بازیابی از پشتیبان</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-3 text-sm">
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                تمام اطلاعات فعلی سیستم با اطلاعات پشتیبان شمارهٔ {restoreTarget?.ordinal.toLocaleString("fa-IR")} ({restoreTarget ? formatDateTime(restoreTarget.createdAt) : ""}) جایگزین می‌شود. هر چیزی که بعد از آن تاریخ ثبت شده از بین می‌رود.
              </p>
              <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                <li>پیش از شروع، یک پشتیبان ایمنی از وضعیت فعلی روی خود سرور گرفته می‌شود.</li>
                <li>در طول بازیابی هیچ‌کس نمی‌تواند از سیستم استفاده کند.</li>
                <li>اگر بازیابی نیمه‌کاره بماند، اطلاعات فعلی دست‌نخورده می‌ماند.</li>
              </ul>
              <div className="flex flex-col gap-2">
                <Label htmlFor="restore-confirm">برای تأیید، کلمهٔ «{RESTORE_WORD}» را تایپ کنید</Label>
                <Input id="restore-confirm" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoComplete="off" />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="destructive" disabled={confirmWord.trim() !== RESTORE_WORD || busy} onClick={() => void startRestore()}>
              شروع بازیابی
            </Button>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restored} onOpenChange={() => undefined}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بازیابی انجام شد</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm">اطلاعات سیستم با پشتیبان انتخاب‌شده جایگزین شد. صفحه را دوباره بارگذاری کنید (در صورت نیاز دوباره وارد شوید).</p>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => window.location.reload()}>بارگذاری دوباره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BackupPage() {
  return (
    <RequirePermission permission="backup.manage" message="شما اجازه پشتیبان‌گیری از سیستم را ندارید.">
      <BackupContent />
    </RequirePermission>
  );
}
