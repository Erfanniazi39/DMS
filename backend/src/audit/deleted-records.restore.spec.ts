import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeletedRecordsService } from './deleted-records.service';
import { RestoreRegistry } from './restore/restore.registry';

function setup(row: Record<string, unknown> | null, claimed = 1) {
  const tx = { deletedRecord: { updateMany: jest.fn().mockResolvedValue({ count: claimed }) } };
  const prisma = {
    deletedRecord: { findFirst: jest.fn().mockResolvedValue(row) },
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn() };
  const registry = new RestoreRegistry();
  const restore = jest.fn().mockResolvedValue({ entityId: 7, warnings: ['w'] });
  registry.register({ entityType: 'Unit', restore });
  const service = new DeletedRecordsService(prisma as never, registry, audit as never);
  return { service, prisma, tx, audit, restore };
}

const row = { id: 3, entityType: 'Unit', entityId: 7, label: 'kg', snapshot: { id: 7 }, restoredAt: null };

describe('DeletedRecordsService restore', () => {
  it('restores, marks the snapshot and writes an audit entry', async () => {
    const { service, restore, audit, tx } = setup(row);
    await expect(service.restore(3, 1, '1.1.1.1')).resolves.toEqual({ entityType: 'Unit', entityId: 7, warnings: ['w'] });
    expect(tx.deletedRecord.updateMany).toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ record: { id: 7 }, userId: 1 }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETED_RECORD_RESTORED' }));
  });

  it('refuses an already restored snapshot', async () => {
    const { service, restore } = setup({ ...row, restoredAt: new Date() });
    await expect(service.restore(3, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses when another admin claimed the snapshot first', async () => {
    const { service, restore } = setup(row, 0);
    await expect(service.restore(3, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses an entity type nobody can restore, and a missing or expired snapshot', async () => {
    await expect(setup({ ...row, entityType: 'Mystery' }).service.restore(3, 1)).rejects.toBeInstanceOf(ConflictException);
    await expect(setup(null).service.restore(3, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dry run reports the restorer\'s refusal and never writes an audit entry', async () => {
    const { service, restore, audit } = setup(row);
    restore.mockRejectedValueOnce(new ConflictException('کد تکراری'));
    await expect(service.checkRestore(3)).resolves.toEqual({ restorable: false, reason: 'کد تکراری' });
    await expect(service.checkRestore(3)).resolves.toEqual({ restorable: true, reason: null });
    expect(audit.log).not.toHaveBeenCalled();
  });
});
