// A backup drive plugged into the admin's own computer, read and written by the browser through the
// File System Access API (Chrome / Edge, on localhost or https only). The format on the drive is exactly the
// one the server writes itself, so a drive can be used from either side. See backend/src/backup/README.md.

import { apiDownload, apiFetch, apiSendBytes } from "@/lib/api";

const ROOT = "DMS-Backup";
const IGNORED = new Set(["System Volume Information", "$RECYCLE.BIN", "lost+found", ".Trash-1000", ".Spotlight-V100", ".fseventsd", "desktop.ini", "Thumbs.db"]);
const CHUNK_BYTES = 4 * 1024 * 1024;

type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle> };

export type BackupManifestLike = {
  backupId: string;
  kind: "FULL" | "INCREMENTAL";
  ordinal: number;
  createdAt: string;
  files: { path: string; size: number; sha256: string }[];
  [key: string]: unknown;
};
export type DriveState = { hasOtherContent: boolean; driveDatabaseId: string | null; manifests: BackupManifestLike[]; invalid: string[] };
export type RunLike = { id: string; status: "RUNNING" | "OK" | "FAILED"; error: string | null; progress: { phase?: string; message?: string; done?: number; total?: number } | null; kind: string };
export type RemoteFile = { path: string; size: number; sha256?: string };
export type PlanLike = { kind: "FULL" | "INCREMENTAL" | "BLOCKED"; reasons: string[]; inSync: boolean; previousBackupId: string | null; previousAt: string | null };

export function driveSupport(): { ok: boolean; reason: string | null } {
  if (typeof window === "undefined") return { ok: false, reason: null };
  if (!window.isSecureContext) return { ok: false, reason: "انتخاب پوشه از مرورگر فقط در آدرس https یا localhost کار می‌کند." };
  if (typeof (window as PickerWindow).showDirectoryPicker !== "function") return { ok: false, reason: "این مرورگر انتخاب پوشه را پشتیبانی نمی‌کند؛ از Chrome یا Edge استفاده کنید." };
  return { ok: true, reason: null };
}

export async function pickDriveFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("انتخاب پوشه پشتیبانی نمی‌شود");
  return picker.call(window, { mode: "readwrite" });
}

async function subDirectory(root: FileSystemDirectoryHandle, path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of path) current = await current.getDirectoryHandle(part, { create });
  return current;
}

async function listNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  // FileSystemDirectoryHandle is async-iterable in browsers that support the picker.
  for await (const [name] of (directory as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name);
  return names;
}

// What the drive holds, in the shape the server's plan/start/begin endpoints expect.
export async function readDrive(root: FileSystemDirectoryHandle): Promise<DriveState> {
  const state: DriveState = { hasOtherContent: false, driveDatabaseId: null, manifests: [], invalid: [] };
  const top = (await listNames(root)).filter((name) => !IGNORED.has(name) && !name.startsWith("."));
  if (!top.includes(ROOT)) {
    state.hasOtherContent = top.length > 0;
    return state;
  }
  const ours = await root.getDirectoryHandle(ROOT);
  try {
    const driveFile = await (await ours.getFileHandle("drive.json")).getFile();
    state.driveDatabaseId = (JSON.parse(await driveFile.text()) as { databaseId?: string }).databaseId ?? null;
  } catch {
    // an interrupted first backup has no drive.json yet
  }
  let backups: FileSystemDirectoryHandle | null = null;
  try {
    backups = await ours.getDirectoryHandle("backups");
  } catch {
    backups = null;
  }
  if (backups) {
    for (const name of (await listNames(backups)).sort()) {
      if (name.startsWith(".tmp-")) continue;
      try {
        const dir = await backups.getDirectoryHandle(name);
        const file = await (await dir.getFileHandle("manifest.json")).getFile();
        state.manifests.push(JSON.parse(await file.text()) as BackupManifestLike);
      } catch {
        state.invalid.push(name);
      }
    }
  }
  return state;
}

// Pool files the newest manifest lists that are missing (or the wrong size) on the drive — they are sent again.
export async function missingPoolFiles(root: FileSystemDirectoryHandle, manifests: BackupManifestLike[]): Promise<string[]> {
  const newest = [...manifests].sort((a, b) => b.ordinal - a.ordinal)[0];
  if (!newest) return [];
  const missing: string[] = [];
  for (const file of newest.files) {
    try {
      const parts = file.path.split("/");
      const directory = await subDirectory(root, [ROOT, "files", ...parts.slice(0, -1)], false);
      const handle = await directory.getFileHandle(parts[parts.length - 1]);
      if ((await handle.getFile()).size !== file.size) missing.push(file.path);
    } catch {
      missing.push(file.path);
    }
  }
  return missing;
}

async function writeStreamTo(root: FileSystemDirectoryHandle, relativePath: string, body: ReadableStream<Uint8Array>): Promise<void> {
  const parts = relativePath.split("/");
  const directory = await subDirectory(root, [ROOT, ...parts.slice(0, -1)], true);
  const handle = await directory.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await handle.createWritable();
  await body.pipeTo(writable);
}

export async function waitForRun(runId: string, until: string | null, onProgress: (run: RunLike) => void): Promise<RunLike> {
  for (let attempt = 0; attempt < 7200; attempt += 1) {
    const run = await apiFetch<RunLike>(`/backup/runs/${runId}`).catch(() => null);
    if (run) {
      onProgress(run);
      if (run.status !== "RUNNING" || (until !== null && run.progress?.phase === until)) return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("زمان انتظار برای پایان کار تمام شد");
}

export async function planForDrive(state: DriveState): Promise<PlanLike> {
  return apiFetch<PlanLike>("/backup/remote/plan", { method: "POST", body: JSON.stringify(state) });
}

// Backup onto the drive: the server builds the backup, the browser copies it onto the drive, and only when every file is
// written does the server record it.
export async function backupToDrive(root: FileSystemDirectoryHandle, onStep: (message: string, done?: number, total?: number) => void): Promise<RunLike> {
  const state = await readDrive(root);
  onStep("بررسی فایل‌های موجود روی حافظه");
  const missingFiles = await missingPoolFiles(root, state.manifests);
  const started = await apiFetch<RunLike>("/backup/remote/start", { method: "POST", body: JSON.stringify({ ...state, missingFiles }) });
  try {
    const ready = await waitForRun(started.id, "awaiting-drive", (run) => onStep(run.progress?.message ?? "در حال ساخت پشتیبان روی سرور", run.progress?.done, run.progress?.total));
    if (ready.status === "FAILED") throw new Error(ready.error ?? "ساخت پشتیبان ناموفق بود");
    const files = await apiFetch<RemoteFile[]>(`/backup/remote/${started.id}/files`);
    let done = 0;
    for (const file of files) {
      onStep(`نوشتن روی حافظه: ${file.path}`, done, files.length);
      const res = await apiDownload(`/backup/remote/${started.id}/file?path=${encodeURIComponent(file.path)}`);
      if (!res.body) throw new Error("پاسخ سرور بدنه ندارد");
      await writeStreamTo(root, file.path, res.body);
      done += 1;
    }
    // Check what landed on the drive before telling the server the backup exists.
    for (const file of files) {
      const parts = file.path.split("/");
      const directory = await subDirectory(root, [ROOT, ...parts.slice(0, -1)], false);
      const size = (await (await directory.getFileHandle(parts[parts.length - 1])).getFile()).size;
      if (size !== file.size) throw new Error(`فایل «${file.path}» درست روی حافظه نوشته نشد`);
    }
    return await apiFetch<RunLike>(`/backup/remote/${started.id}/commit`, { method: "POST", body: "{}" });
  } catch (error) {
    await apiFetch(`/backup/remote/${started.id}/abort`, { method: "POST", body: "{}" }).catch(() => undefined);
    throw error;
  }
}

// Restore from the drive: the browser sends the chosen backup's files to the server in pieces, then the server restores.
export async function uploadForRestore(root: FileSystemDirectoryHandle, backupId: string, onStep: (message: string, done?: number, total?: number) => void): Promise<{ jobId: string }> {
  const state = await readDrive(root);
  const begin = await apiFetch<{ jobId: string; files: RemoteFile[] }>("/backup/remote/restore/begin", { method: "POST", body: JSON.stringify({ manifests: state.manifests, backupId }) });
  try {
    let done = 0;
    for (const file of begin.files) {
      onStep(`ارسال به سرور: ${file.path}`, done, begin.files.length);
      const parts = file.path.split("/");
      const directory = await subDirectory(root, [ROOT, ...parts.slice(0, -1)], false);
      const blob = await (await directory.getFileHandle(parts[parts.length - 1])).getFile();
      if (blob.size === 0) {
        await apiSendBytes(`/backup/remote/restore/${begin.jobId}/file?path=${encodeURIComponent(file.path)}&offset=0`, blob);
      }
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        await apiSendBytes(`/backup/remote/restore/${begin.jobId}/file?path=${encodeURIComponent(file.path)}&offset=${offset}`, blob.slice(offset, offset + CHUNK_BYTES));
      }
      done += 1;
    }
    return { jobId: begin.jobId };
  } catch (error) {
    await apiFetch(`/backup/remote/restore/${begin.jobId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    throw error;
  }
}
