import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { InventoryAdminController } from './inventory-admin.controller';
import { InventoryController } from './inventory.controller';

// I3: GET /inventory/integrity moved from inventory.adjust (I1's stand-in)
// to inventory.manage (now that it exists as "admin-level inventory
// configuration") — WAREHOUSE (inventory.adjust only) must lose access and
// INVENTORY_MANAGER (inventory.manage too) must keep it. A full 403/200
// round-trip needs a running server + session (covered by the batch's live
// API smoke test); this is the unit-testable half of that change: the
// decorator metadata the PermissionsGuard actually reads.
describe('InventoryAdminController — /inventory/integrity permission gate (I3)', () => {
  it('requires inventory.manage, not inventory.adjust', () => {
    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, InventoryAdminController.prototype.checkIntegrity);
    expect(permissions).toEqual(['inventory.manage']);
  });

  it('is no longer registered on InventoryController (moved, not duplicated)', () => {
    expect((InventoryController.prototype as Record<string, unknown>).checkIntegrity).toBeUndefined();
  });
});

describe('InventoryAdminController — stock-levels permission gates', () => {
  it('every stock-levels route requires inventory.manage', () => {
    const methods = [
      InventoryAdminController.prototype.listStockLevels,
      InventoryAdminController.prototype.getStockLevel,
      InventoryAdminController.prototype.upsertStockLevel,
      InventoryAdminController.prototype.removeStockLevel,
    ];
    for (const method of methods) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.manage']);
    }
  });
});
