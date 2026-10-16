import { BadRequestException } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BACKUP_ROOT_DIR } from './backup.constants';
import { normalizeTargetPath, scanDrive } from './backup-folder';
import { safeRelativePath } from './backup-files';

describe('normalizeTargetPath', () => {
  it('accepts an absolute path outside the application and the system folders', () => {
    expect(normalizeTargetPath('/media/usb/backup/', '/srv/app/backend')).toBe('/media/usb/backup');
  });
  it('refuses relative paths, the root, system folders and the application folder', () => {
    for (const bad of ['', '   ', 'backup', './backup', '/', '/etc', '/etc/x', '/proc/1', '/srv/app/backend', '/srv/app/backend/uploads', '/srv/app']) {
      expect(() => normalizeTargetPath(bad, '/srv/app/backend')).toThrow(BadRequestException);
    }
  });
});

describe('safeRelativePath', () => {
  it('only plain relative forward-slash paths', () => {
    expect(safeRelativePath('letters/a-b.pdf')).toBe(true);
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a\\b', 'a//b', './a']) expect(safeRelativePath(bad)).toBe(false);
  });
});

describe('scanDrive', () => {
  let dir: string;
  const DB = '11111111-1111-4111-8111-111111111111';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dms-drive-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a missing folder is unusable; an empty folder is usable and empty', async () => {
    expect((await scanDrive(join(dir, 'nope'), DB)).usable).toBe(false);
    const scan = await scanDrive(dir, DB);
    expect(scan).toMatchObject({ usable: true, empty: true, foreign: false, manifests: [] });
  });

  it('a folder with other files is not empty and is refused; a stick\'s own system folders do not count', async () => {
    await mkdir(join(dir, 'System Volume Information'));
    expect((await scanDrive(dir, DB)).usable).toBe(true);
    await writeFile(join(dir, 'holiday.jpg'), 'x');
    const scan = await scanDrive(dir, DB);
    expect(scan.usable).toBe(false);
    expect(scan.problems[0]).toContain('خالی نیست');
  });

  it('a drive that belongs to another database is foreign; an unfinished backup folder is reported, not used', async () => {
    await mkdir(join(dir, BACKUP_ROOT_DIR, 'backups', '0001-broken'), { recursive: true });
    await writeFile(join(dir, BACKUP_ROOT_DIR, 'drive.json'), JSON.stringify({ format: 1, databaseId: '99999999-9999-4999-8999-999999999999' }));
    const scan = await scanDrive(dir, DB);
    expect(scan.foreign).toBe(true);
    expect(scan.problems.some((problem) => problem.includes('0001-broken'))).toBe(true);
    expect(scan.manifests).toEqual([]);
    expect((await scanDrive(dir, null)).foreign).toBe(false);
  });
});
