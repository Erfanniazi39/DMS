import { backupDirName, chainIsValid, planBackup, resolveChain, type BackupManifest, type DriveScan, type SystemBackupState } from './backup-manifest';

const DB = '11111111-1111-4111-8111-111111111111';
const GEN = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

function manifest(ordinal: number, kind: 'FULL' | 'INCREMENTAL', overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: 1,
    backupId: id(ordinal),
    kind,
    databaseId: DB,
    generationId: GEN,
    ordinal,
    baseBackupId: id(1),
    previousBackupId: kind === 'FULL' ? null : id(ordinal - 1),
    createdAt: `2026-12-${String(9 + ordinal).padStart(2, '0')}T10:00:00.000Z`,
    snapshot: `${ordinal * 10}:${ordinal * 10}:`,
    migrations: ['m1'],
    tables: [],
    changes: null,
    files: [],
    totals: { rows: 0, files: 0, bytes: 0 },
    ...overrides,
  };
}

const system = (overrides: Partial<SystemBackupState> = {}): SystemBackupState => ({
  databaseId: DB,
  generationId: GEN,
  backupCounter: 2,
  prunedThroughOrdinal: 0,
  lastBackupId: id(2),
  lastBackupAt: new Date('2026-12-11T10:00:00Z'),
  ...overrides,
});

const drive = (manifests: BackupManifest[], overrides: Partial<DriveScan> = {}): DriveScan => ({ usable: true, problems: [], empty: manifests.length === 0, foreign: false, manifests, ...overrides });

describe('planBackup', () => {
  it('first ever backup, onto an empty drive → FULL', () => {
    const plan = planBackup(system({ generationId: null, backupCounter: 0, lastBackupId: null, lastBackupAt: null }), drive([]));
    expect(plan.kind).toBe('FULL');
    expect(plan.reasons[0]).toContain('اولین');
  });

  it('system and drive agree on the last backup → INCREMENTAL from it', () => {
    const plan = planBackup(system(), drive([manifest(1, 'FULL'), manifest(2, 'INCREMENTAL')]));
    expect(plan.kind).toBe('INCREMENTAL');
    expect(plan.previous?.backupId).toBe(id(2));
    expect(plan.inSync).toBe(true);
  });

  it('the system last backed up elsewhere, but this drive can still be continued → INCREMENTAL, not in sync', () => {
    const plan = planBackup(system({ backupCounter: 3, lastBackupId: id(3) }), drive([manifest(1, 'FULL'), manifest(2, 'INCREMENTAL')]));
    expect(plan.kind).toBe('INCREMENTAL');
    expect(plan.previous?.ordinal).toBe(2);
    expect(plan.inSync).toBe(false);
  });

  it('the changes since this drive\'s last backup were already pruned → FULL', () => {
    const plan = planBackup(system({ backupCounter: 5, prunedThroughOrdinal: 4, lastBackupId: id(5) }), drive([manifest(1, 'FULL'), manifest(2, 'INCREMENTAL')]));
    expect(plan.kind).toBe('FULL');
  });

  it('a backup whose chain is broken is ignored: the newest intact one is continued, or a FULL starts when none is', () => {
    const plan = planBackup(system({ backupCounter: 3 }), drive([manifest(1, 'FULL'), manifest(3, 'INCREMENTAL', { previousBackupId: id(2) })]));
    expect(plan.kind).toBe('INCREMENTAL');
    expect(plan.previous?.ordinal).toBe(1);
    expect(planBackup(system({ backupCounter: 3 }), drive([manifest(3, 'INCREMENTAL', { previousBackupId: id(2) })])).kind).toBe('FULL');
  });

  it('a drive claiming backups newer than the system knows → FULL', () => {
    const plan = planBackup(system({ backupCounter: 1, lastBackupId: id(1) }), drive([manifest(1, 'FULL'), manifest(2, 'INCREMENTAL')]));
    expect(plan.kind).toBe('FULL');
  });

  it('right after a restore (no generation) → FULL even if the drive holds older backups', () => {
    const plan = planBackup(system({ generationId: null, lastBackupId: null }), drive([manifest(1, 'FULL'), manifest(2, 'INCREMENTAL')]));
    expect(plan.kind).toBe('FULL');
    expect(plan.reasons[0]).toContain('بازیابی');
  });

  it('another database\'s backups on the drive, or an unusable folder → BLOCKED', () => {
    expect(planBackup(system(), drive([], { foreign: true })).kind).toBe('BLOCKED');
    const blocked = planBackup(system(), drive([], { usable: false, problems: ['پوشه خالی نیست'] }));
    expect(blocked.kind).toBe('BLOCKED');
    expect(blocked.reasons).toEqual(['پوشه خالی نیست']);
  });

  it('an old generation on the drive is ignored → FULL', () => {
    const plan = planBackup(system(), drive([manifest(1, 'FULL', { generationId: '44444444-4444-4444-8444-444444444444' })]));
    expect(plan.kind).toBe('FULL');
  });
});

describe('resolveChain', () => {
  const all = [manifest(1, 'FULL'), manifest(2, 'INCREMENTAL'), manifest(3, 'INCREMENTAL')];

  it('returns the full base and every incremental up to the target, oldest first', () => {
    expect(resolveChain(all, id(3)).map((m) => m.ordinal)).toEqual([1, 2, 3]);
    expect(resolveChain(all, id(1)).map((m) => m.ordinal)).toEqual([1]);
  });

  it('refuses a broken chain, an unknown target and a mixed-up generation', () => {
    expect(() => resolveChain([all[0], all[2]], id(3))).toThrow('ناقص');
    expect(() => resolveChain(all, id(9))).toThrow('پیدا نشد');
    expect(chainIsValid([all[0], manifest(2, 'INCREMENTAL', { generationId: '44444444-4444-4444-8444-444444444444' })], id(2))).toBe(false);
  });
});

describe('backupDirName', () => {
  it('is sortable and readable', () => {
    expect(backupDirName(manifest(2, 'INCREMENTAL'))).toBe('0002-20261211-100000-incr-33333333');
    expect(backupDirName(manifest(1, 'FULL'))).toBe('0001-20261210-100000-full-33333333');
  });
});
