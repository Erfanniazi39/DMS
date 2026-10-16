import { createHash } from 'crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'fs';
import { rename, stat } from 'fs/promises';
import { createInterface } from 'readline';
import { createGunzip, createGzip, type Gzip } from 'zlib';

// Small file helpers for the backup module: gzip text files written line by line (with the hash of what
// really lands on disk), reading them back line by line, and hashing/copying plain files.

export class GzipLineWriter {
  private readonly gzip: Gzip = createGzip({ level: 6 });
  private readonly out: WriteStream;
  private readonly hash = createHash('sha256');
  private bytes = 0;
  private readonly finished: Promise<void>;
  lines = 0;

  constructor(private readonly path: string) {
    this.out = createWriteStream(path, { flags: 'wx' });
    this.gzip.on('data', (chunk: Buffer) => {
      this.hash.update(chunk);
      this.bytes += chunk.length;
    });
    this.gzip.pipe(this.out);
    this.finished = new Promise((resolve, reject) => {
      this.out.on('finish', resolve);
      this.out.on('error', reject);
      this.gzip.on('error', reject);
    });
  }

  async writeLine(line: string): Promise<void> {
    this.lines += 1;
    if (!this.gzip.write(`${line}\n`)) await new Promise<void>((resolve) => this.gzip.once('drain', () => resolve()));
  }

  async close(): Promise<{ bytes: number; sha256: string; lines: number }> {
    this.gzip.end();
    await this.finished;
    return { bytes: this.bytes, sha256: this.hash.digest('hex'), lines: this.lines };
  }
}

export async function* readGzipLines(path: string): AsyncGenerator<string> {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line !== '') yield line;
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// Copies a file next to its destination first and renames it into place, so a half-copied file never
// has the final name. Returns the size and sha256 of what was copied.
export function copyFileWithHash(source: string, destination: string): Promise<{ size: number; sha256: string }> {
  return new Promise((resolve, reject) => {
    const temp = `${destination}.part`;
    const hash = createHash('sha256');
    let size = 0;
    const input = createReadStream(source);
    const output = createWriteStream(temp, { flags: 'w' });
    input.on('data', (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', () => {
      rename(temp, destination).then(() => resolve({ size, sha256: hash.digest('hex') }), reject);
    });
    input.pipe(output);
  });
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}
