import { mkdir, readdir, stat } from 'fs/promises';
import { dirname, join, posix, resolve, sep } from 'path';
import { copyFileWithHash, fileSize, sha256File } from './backup-io';
import type { ManifestFile } from './backup-manifest';

// Uploaded files (letters, contracts, photos, payment slips, ...) live as plain files under uploads/.
// They are named by random UUIDs and never rewritten, so a backup keeps ONE shared pool on the drive
// and only copies files the pool does not already hold.

type LocalFile = { path: string; absolute: string; size: number };

// Relative path as stored in manifests: forward slashes, never absolute, never ".." .
export function safeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const normalized = posix.normalize(path);
  return normalized === path && !normalized.startsWith('../') && normalized !== '..' && !normalized.split('/').includes('..');
}

export async function listLocalFiles(root: string): Promise<LocalFile[]> {
  const result: LocalFile[] = [];
  const walk = async (directory: string, prefix: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.part')) continue;
      const absolute = join(directory, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(absolute, path);
      else if (entry.isFile()) result.push({ path, absolute, size: (await stat(absolute)).size });
    }
  };
  await walk(root, '');
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

// Copies what the pool lacks and returns the complete list of files as of now. `known` carries the hashes
// of files an earlier backup already described, so unchanged files are not read again.
export async function syncFilesToPool(
  uploadsDir: string,
  poolDir: string,
  known: Map<string, ManifestFile>,
  onProgress?: (done: number, total: number) => void,
  // Remote mode: the pool is on another computer, so a file an earlier manifest lists (same size) is taken as already there.
  trustKnown = false,
): Promise<{ files: ManifestFile[]; copied: number; copiedBytes: number }> {
  const local = await listLocalFiles(uploadsDir);
  const files: ManifestFile[] = [];
  let copied = 0;
  let copiedBytes = 0;
  let done = 0;
  for (const file of local) {
    const target = join(poolDir, ...file.path.split('/'));
    const previous = known.get(file.path);
    if (trustKnown && previous && previous.size === file.size) {
      files.push(previous);
    } else if ((await fileSize(target)) === file.size) {
      files.push({ path: file.path, size: file.size, sha256: previous && previous.size === file.size ? previous.sha256 : await sha256File(target) });
    } else {
      await mkdir(dirname(target), { recursive: true });
      const result = await copyFileWithHash(file.absolute, target);
      files.push({ path: file.path, size: result.size, sha256: result.sha256 });
      copied += 1;
      copiedBytes += result.size;
    }
    done += 1;
    onProgress?.(done, local.length);
  }
  return { files, copied, copiedBytes };
}

// Every file the manifest lists must be in the pool with the recorded size and content.
export async function verifyPoolFiles(poolDir: string, files: readonly ManifestFile[], onProgress?: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  for (const file of files) {
    if (!safeRelativePath(file.path)) throw new Error(`مسیر فایل نامعتبر در پشتیبان: ${file.path}`);
    const target = join(poolDir, ...file.path.split('/'));
    const size = await fileSize(target);
    if (size === null) throw new Error(`فایل «${file.path}» روی حافظه پیدا نشد`);
    if (size !== file.size || (await sha256File(target)) !== file.sha256) throw new Error(`فایل «${file.path}» خراب یا ناقص است`);
    done += 1;
    onProgress?.(done, files.length);
  }
}

export async function restoreFilesFromPool(poolDir: string, files: readonly ManifestFile[], uploadsDir: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const base = resolve(uploadsDir);
  let copied = 0;
  let done = 0;
  for (const file of files) {
    if (!safeRelativePath(file.path)) throw new Error(`مسیر فایل نامعتبر در پشتیبان: ${file.path}`);
    const destination = resolve(base, ...file.path.split('/'));
    if (!destination.startsWith(`${base}${sep}`)) throw new Error(`مسیر فایل نامعتبر در پشتیبان: ${file.path}`);
    if ((await fileSize(destination)) !== file.size) {
      await mkdir(dirname(destination), { recursive: true });
      await copyFileWithHash(join(poolDir, ...file.path.split('/')), destination);
      copied += 1;
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  return copied;
}
