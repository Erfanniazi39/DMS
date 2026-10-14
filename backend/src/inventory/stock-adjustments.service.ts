import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockAdjustmentKind, type StockDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isFeatureEnabled } from '../common/feature-flags';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import { InventoryService } from './inventory.service';
import {
  EDITABLE_STOCK_DOCUMENT_STATUSES,
  STOCK_ADJUSTMENT_DOC_TYPE,
  STOCK_ADJUSTMENT_KIND_LABELS_FA,
  movementTypeForAdjustmentLine,
  stockAdjustmentNeedsApproval,
} from './inventory-rules';
import { resolveBatches, type ItemBatchSettings } from './stock-batches';
import { applyMovements, lockItemSettings, type MovementInput } from './stock-ledger';
import type { CreateStockAdjustmentDto, UpdateStockAdjustmentDto } from './dto/inventory.dto';

export type StockAdjustmentListFilters = { q?: string; status?: StockDocumentStatus; kind?: StockAdjustmentKind; sort?: SortParams };

// Everything the detail page needs. Users narrowed to id/username.
const stockAdjustmentDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  createdByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  submittedByUser: { select: { id: true, username: true } },
  rejectedByUser: { select: { id: true, username: true } },
  items: {
    include: { item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockAdjustmentInclude;

// Columns the adjustments table can be sorted by (the line count is derived).
const STOCK_ADJUSTMENT_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.StockAdjustmentOrderByWithRelationInput> = {
  adjustmentNumber: (dir) => ({ adjustmentNumber: { sort: dir, nulls: 'last' } }),
  adjustmentDate: (dir) => ({ adjustmentDate: dir }),
  kind: (dir) => ({ kind: dir }),
  reason: (dir) => ({ reason: dir }),
  location: (dir) => ({ location: { name: dir } }),
  createdBy: (dir) => ({ createdByUser: { username: dir } }),
  status: (dir) => ({ status: dir }),
};

// Stock adjustment documents (رسید / اصلاح موجودی) — the only way stock
// enters or is corrected today (no Purchases/Production integration,
// CLAUDE.md rule 7).
//
// Lifecycle: DRAFT (editable, deletable, no number) → POSTED (immutable,
// numbered ADJ-<jalali year>-000001, stock movements written). Posting is
// one transaction: lock the draft, claim the gap-free number, apply the
// movements through stock-ledger.ts, mark POSTED, write the audit row. If
// anything fails (e.g. a CORRECTION would take stock negative) nothing is
// kept — not the number, not a single movement.
@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: StockAdjustmentListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.StockAdjustmentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.kind) where.kind = filters.kind;
    if (filters.q) {
      where.OR = [
        { adjustmentNumber: { contains: filters.q, mode: 'insensitive' } },
        { reason: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    const query = {
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
      // Drafts (no number) and posted documents together, newest first.
      orderBy: buildOrderBy(filters.sort, STOCK_ADJUSTMENT_SORT_COLUMNS, [{ adjustmentDate: 'desc' }, { id: 'desc' }], [{ id: 'desc' }]),
    } satisfies Prisma.StockAdjustmentFindManyArgs;

    if (!pagination) return this.prisma.stockAdjustment.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({ where: { id }, include: stockAdjustmentDetailInclude });
    if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
    return adjustment;
  }

  async create(dto: CreateStockAdjustmentDto, userId: number | null, ipAddress?: string) {
    const locationId = await this.resolveLocation(dto.locationId);
    await this.ensureActiveItems(dto.items.map((line) => line.itemId));
    await this.ensureBatchFieldsValid(dto.kind, dto.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          kind: dto.kind,
          status: 'DRAFT',
          locationId,
          adjustmentDate: dto.adjustmentDate,
          reason: dto.reason,
          reasonCode: dto.reasonCode,
          note: dto.note,
          createdByUserId: userId,
          items: {
            create: dto.items.map((line) => ({
              itemId: line.itemId,
              quantity: line.quantity,
              note: line.note,
              batchId: line.batchId ?? null,
              batchNumber: line.batchNumber ?? null,
              productionDate: line.productionDate ?? null,
              expiryDate: line.expiryDate ?? null,
            })),
          },
        },
        include: stockAdjustmentDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_CREATED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: adjustment.id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — پیش‌نویس، ${dto.items.length} ردیف`,
        },
        tx,
      );
      return adjustment;
    });
    return created;
  }

  // Full-record edit of a DRAFT: header fields plus lines replaced wholesale
  // (same delete-then-recreate convention as PurchasesService.update()).
  // Optimistic lock on updatedAt, re-checked atomically inside the
  // transaction together with status = DRAFT, so an edit can't land on a
  // document that was posted (or edited) in the meantime.
  async update(id: number, dto: UpdateStockAdjustmentDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    // An item already on this draft may stay even if it was deactivated since
    // (same rule as ItemsService.ensureReferences()); newly added ones must be active.
    await this.ensureActiveItems(
      dto.items.map((line) => line.itemId),
      existing.items.map((line) => line.itemId),
    );
    await this.ensureBatchFieldsValid(dto.kind, dto.items);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: id } });
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          kind: dto.kind,
          locationId,
          adjustmentDate: dto.adjustmentDate,
          reason: dto.reason,
          reasonCode: dto.reasonCode ?? null,
          note: dto.note ?? null,
          items: {
            create: dto.items.map((line) => ({
              itemId: line.itemId,
              quantity: line.quantity,
              note: line.note,
              batchId: line.batchId ?? null,
              batchNumber: line.batchNumber ?? null,
              productionDate: line.productionDate ?? null,
              expiryDate: line.expiryDate ?? null,
            })),
          },
        },
        include: stockAdjustmentDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_ADJUSTMENT_UPDATED', entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return updated;
    });
  }

  // DRAFT → POSTED. See the class comment for the transaction shape. Refuses
  // a document that needs inventory.approve (B10) — that one goes through
  // submit() → approve() instead, never directly through post() (the Sales
  // Batch 2 class of bug: an endpoint must accept only the exact source
  // status/condition its permission implies).
  //
  // Concurrency: the draft row is locked FOR UPDATE first (same convention as
  // PurchasePaymentsService), so two simultaneous "post" clicks on the same
  // draft serialize and the second sees POSTED and is refused. Two different
  // adjustments posted at once each lock their own draft, then both reach
  // nextDocumentNumber(), whose UPDATE … RETURNING row-locks the
  // (ADJ, year) counter until commit — the second waits and receives the
  // next value, never the same one (adjustment_number is UNIQUE as a
  // backstop). Stock rows are locked by applyMovements() in itemId/locationId
  // order, so overlapping adjustments can't deadlock on balances either.
  //
  // v1 (inventoryApprovalWorkflow flag off — no submit/approve UI): a
  // WRITE_OFF or negative CORRECTION is posted here directly, but only by a
  // caller holding inventory.approve (options.canApprove). The B10
  // no-self-approval split is dropped in v1; the audit entry records it.
  // BATCH_CUTOVER/MARK_DAMAGED keep needing the full workflow.
  async post(id: number, loadedVersion: Date, userId: number | null, ipAddress?: string, options: { canApprove?: boolean } = {}) {
    let postedDirectlyWithApproval = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      if (adjustment.status === 'POSTED') throw new ConflictException('این سند قبلاً ثبت شده است');
      if (adjustment.status === 'PENDING_APPROVAL') {
        throw new ConflictException('این سند در انتظار تأیید است؛ ثبت آن فقط از طریق «تأیید» توسط کاربر دیگر ممکن است.');
      }
      if (!isSameVersion(adjustment.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (adjustment.items.length === 0) throw new BadRequestException('سند بدون ردیف کالا قابل ثبت نیست');
      if (!adjustment.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');
      if (stockAdjustmentNeedsApproval(adjustment.kind, adjustment.items.map((item) => item.quantity))) {
        const directPostAllowed =
          !isFeatureEnabled('inventoryApprovalWorkflow') && adjustment.kind !== 'BATCH_CUTOVER' && adjustment.kind !== 'MARK_DAMAGED';
        if (!directPostAllowed) {
          throw new ConflictException('این سند نیاز به تأیید دارد؛ به‌جای «ثبت نهایی»، آن را «ارسال برای تأیید» کنید.');
        }
        if (!options.canApprove) throw new ForbiddenException('ثبت این سند نیاز به مجوز «تأیید اسناد موجودی» دارد');
        postedDirectlyWithApproval = true;
      }

      const adjustmentNumber = await nextDocumentNumber(tx, STOCK_ADJUSTMENT_DOC_TYPE, adjustment.adjustmentDate);
      const rows = await this.buildMovementRows(tx, adjustment, adjustmentNumber, userId);
      await applyMovements(tx, rows);

      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', adjustmentNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_POSTED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${adjustmentNumber} — ${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]}، ${rows.length} ردیف${
            postedDirectlyWithApproval ? '؛ ثبت مستقیم با مجوز تأیید (بدون گردش تأیید)' : ''
          }`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // DRAFT → PENDING_APPROVAL. Only for a document that needs inventory.approve
  // (B10) — the mirror refusal of post()'s new check. The document becomes
  // non-editable (EDITABLE_STOCK_DOCUMENT_STATUSES doesn't include
  // PENDING_APPROVAL) until approve() or reject() resolves it.
  async submit(id: number, loadedVersion: Date, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      if (adjustment.status !== 'DRAFT') {
        throw new ConflictException(
          adjustment.status === 'PENDING_APPROVAL' ? 'این سند قبلاً برای تأیید ارسال شده است' : 'این سند قبلاً ثبت شده است',
        );
      }
      if (!isSameVersion(adjustment.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (adjustment.items.length === 0) throw new BadRequestException('سند بدون ردیف کالا قابل ارسال برای تأیید نیست');
      if (!stockAdjustmentNeedsApproval(adjustment.kind, adjustment.items.map((item) => item.quantity))) {
        throw new BadRequestException('این سند نیاز به تأیید ندارد؛ می‌توانید مستقیماً آن را «ثبت نهایی» کنید.');
      }

      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL', submittedByUserId: userId, submittedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_SUBMITTED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — ارسال برای تأیید`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // PENDING_APPROVAL → POSTED. Approve and post are one transaction: claim
  // the number, apply the movements, mark POSTED, audit — the same shape as
  // post() (reused via buildMovementRows). postedByUserId/postedAt double as
  // "approved by/at". No self-approval, ever (B10): the approver must not be
  // the user who submitted the document.
  async approve(id: number, loadedVersion: Date, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      if (adjustment.status !== 'PENDING_APPROVAL') {
        throw new ConflictException('این سند در وضعیت «در انتظار تأیید» نیست و قابل تأیید نیست');
      }
      if (!isSameVersion(adjustment.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (userId !== null && adjustment.submittedByUserId !== null && adjustment.submittedByUserId === userId) {
        throw new ConflictException('ارسال‌کنندهٔ سند نمی‌تواند همان سند را تأیید کند؛ باید کاربر دیگری آن را تأیید کند.');
      }
      if (!adjustment.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');

      // I4 (B23/§6/§5.4a R2/R3): BATCH_CUTOVER is genuinely special — it is
      // not one buildMovementRows()+applyMovements() call like every other
      // kind. See postBatchCutover()'s own comment.
      if (adjustment.kind === 'BATCH_CUTOVER') {
        await this.postBatchCutover(tx, adjustment, userId, ipAddress);
        return;
      }

      const adjustmentNumber = await nextDocumentNumber(tx, STOCK_ADJUSTMENT_DOC_TYPE, adjustment.adjustmentDate);
      // I8 (B9): MARK_DAMAGED posts two rows per line (ON_HAND out, DAMAGED
      // in) — its own builder, never movementTypeForAdjustmentLine()'s
      // generic single-row path (which refuses this kind outright).
      const rows =
        adjustment.kind === 'MARK_DAMAGED'
          ? await this.buildMarkDamagedMovementRows(tx, adjustment, adjustmentNumber, userId)
          : await this.buildMovementRows(tx, adjustment, adjustmentNumber, userId);
      await applyMovements(tx, rows);

      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', adjustmentNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_APPROVED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${adjustmentNumber} — ${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]}، ${rows.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // PENDING_APPROVAL → DRAFT. rejectReason is required by the DTO. Back to
  // editable: a resubmit() overwrites submittedByUserId/submittedAt.
  async reject(id: number, loadedVersion: Date, rejectReason: string, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true, kind: true } });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      if (adjustment.status !== 'PENDING_APPROVAL') {
        throw new ConflictException('این سند در وضعیت «در انتظار تأیید» نیست و قابل رد نیست');
      }
      if (!isSameVersion(adjustment.updatedAt, loadedVersion)) throw recordModifiedConflict();

      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'DRAFT', rejectedByUserId: userId, rejectedAt: new Date(), rejectReason },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_REJECTED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — ${rejectReason}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // Shared by post() and approve() — the only difference between them is
  // which status they start from and who ends up in postedByUserId. NOT used
  // for BATCH_CUTOVER (see postBatchCutover() below) or MARK_DAMAGED (see
  // buildMarkDamagedMovementRows() below) — movementTypeForAdjustmentLine()
  // itself refuses both kinds.
  //
  // I4: a line with a typed batchNumber (no batchId) is resolved to a real
  // batch — created or matched — via stock-batches.ts resolveBatches(),
  // inside the same transaction, before building its movement row. A line
  // that already carries a batchId (an existing batch the user picked) is
  // passed straight through; applyMovements() validates it belongs to the
  // right item.
  private async buildMovementRows(
    tx: Prisma.TransactionClient,
    adjustment: {
      id: number;
      kind: StockAdjustmentKind;
      locationId: number;
      adjustmentDate: Date;
      items: { id: number; itemId: number; quantity: Prisma.Decimal; note: string | null; batchId: number | null; batchNumber: string | null; productionDate: Date | null; expiryDate: Date | null }[];
    },
    adjustmentNumber: string,
    userId: number | null,
  ): Promise<MovementInput[]> {
    const resolvedByLineId = await this.resolveLineBatches(tx, adjustment.items, userId);

    return adjustment.items.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const batchId = line.batchId ?? resolvedByLineId.get(line.id)?.batchId ?? null;
      return {
        itemId: line.itemId,
        locationId: adjustment.locationId,
        bucket: 'ON_HAND',
        movementType: movementTypeForAdjustmentLine(adjustment.kind, quantity.isNegative() ? -1 : 1),
        quantity,
        movementDate: adjustment.adjustmentDate,
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: adjustment.id,
        referenceLineId: line.id,
        referenceNumber: adjustmentNumber,
        note: line.note,
        createdByUserId: userId,
        batchId,
      };
    });
  }

  // I8 (B9): MARK_DAMAGED's own dedicated builder — movementTypeForAdjustmentLine()
  // refuses this kind (it only ever returns one movement type per line);
  // MARK_DAMAGED always posts two rows per line, same reference/reasonCode:
  // ON_HAND out, DAMAGED in — the same shape as BATCH_CUTOVER getting its own
  // special-case transaction instead of the generic single-row path. Lines
  // are always negative (OUTBOUND_ONLY_ADJUSTMENT_KINDS, DTO-enforced); the
  // magnitude is what moves into DAMAGED.
  private async buildMarkDamagedMovementRows(
    tx: Prisma.TransactionClient,
    adjustment: {
      id: number;
      locationId: number;
      adjustmentDate: Date;
      items: { id: number; itemId: number; quantity: Prisma.Decimal; note: string | null; batchId: number | null; batchNumber: string | null; productionDate: Date | null; expiryDate: Date | null }[];
    },
    adjustmentNumber: string,
    userId: number | null,
  ): Promise<MovementInput[]> {
    const resolvedByLineId = await this.resolveLineBatches(tx, adjustment.items, userId);

    const rows: MovementInput[] = [];
    for (const line of adjustment.items) {
      const magnitude = new Prisma.Decimal(line.quantity).abs();
      const batchId = line.batchId ?? resolvedByLineId.get(line.id)?.batchId ?? null;
      const common = {
        itemId: line.itemId,
        locationId: adjustment.locationId,
        movementType: 'MARK_DAMAGED' as const,
        movementDate: adjustment.adjustmentDate,
        referenceType: 'STOCK_ADJUSTMENT' as const,
        referenceId: adjustment.id,
        referenceLineId: line.id,
        referenceNumber: adjustmentNumber,
        note: line.note,
        createdByUserId: userId,
        batchId,
      };
      rows.push({ ...common, bucket: 'ON_HAND', quantity: magnitude.negated() }, { ...common, bucket: 'DAMAGED', quantity: magnitude });
    }
    return rows;
  }

  // I4/I8: resolves a typed batchNumber (no batchId) into a real batch —
  // created or matched — via stock-batches.ts resolveBatches(), inside the
  // same transaction, shared by buildMovementRows() and
  // buildMarkDamagedMovementRows(). A line that already carries a batchId
  // (an existing batch the user picked) needs no resolution; applyMovements()
  // validates it belongs to the right item.
  private async resolveLineBatches(
    tx: Prisma.TransactionClient,
    items: { id: number; itemId: number; batchId: number | null; batchNumber: string | null; productionDate: Date | null; expiryDate: Date | null }[],
    userId: number | null,
  ): Promise<Map<number, { batchId: number }>> {
    const toResolve = items.filter((line) => line.batchNumber && !line.batchId);
    if (toResolve.length === 0) return new Map();
    const itemIds = [...new Set(toResolve.map((line) => line.itemId))];
    const settingsRows = await tx.inventoryItemSetting.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, batchTracked: true, expiryRequired: true, shelfLifeDays: true, batchTrackedSince: true },
    });
    const settingsByItem = new Map<number, ItemBatchSettings>(settingsRows.map((row) => [row.itemId, row]));
    const resolved = await resolveBatches(
      tx,
      toResolve.map((line) => ({ itemId: line.itemId, batchNumber: line.batchNumber!, productionDate: line.productionDate, expiryDate: line.expiryDate })),
      settingsByItem,
      userId,
    );
    return new Map(toResolve.map((line, index) => [line.id, resolved[index]]));
  }

  // I4 (B23/§6/§5.4a R2/R3): converts one item from unbatched to
  // batch-tracked. Genuinely different from every other kind — it needs the
  // live on-hand figure read under lock (not a number saved with the draft)
  // and two applyMovements() calls with the settings flip in between (the
  // unbatched outbound row would be rejected once batchTracked is already
  // on). Called only from approve() (BATCH_CUTOVER always needs approval,
  // B23 — post() already refuses it via stockAdjustmentNeedsApproval()).
  private async postBatchCutover(
    tx: Prisma.TransactionClient,
    adjustment: {
      id: number;
      locationId: number;
      adjustmentDate: Date;
      items: { id: number; itemId: number; quantity: Prisma.Decimal; note: string | null; batchNumber: string | null; productionDate: Date | null; expiryDate: Date | null }[];
    },
    userId: number | null,
    ipAddress?: string,
  ) {
    const itemIds = [...new Set(adjustment.items.map((line) => line.itemId))];
    if (itemIds.length !== 1) throw new BadRequestException('سند «تبدیل به ردیابی بچ» فقط می‌تواند برای یک کالا باشد');
    const itemId = itemIds[0];

    // R1: exclusive advisory lock, taken BEFORE reading the setting.
    await lockItemSettings(tx, [itemId], 'exclusive');
    const existingSetting = await tx.inventoryItemSetting.findUnique({ where: { itemId } });
    if (existingSetting?.batchTracked) {
      throw new ConflictException('این کالا قبلاً به ردیابی بچ تبدیل شده است');
    }

    // R2: lock every balance row this item has, at every location, ordered
    // by location — not just the cutover document's own location.
    const balanceRows = await tx.$queryRaw<{ location_id: number; on_hand: unknown; qc: unknown }[]>`
      SELECT location_id, on_hand, qc FROM stock_balances
      WHERE item_id = ${itemId}
      ORDER BY location_id ASC
      FOR UPDATE`;

    const totalQc = balanceRows.reduce((sum, row) => sum.plus(new Prisma.Decimal(String(row.qc))), new Prisma.Decimal(0));
    if (totalQc.greaterThan(0)) {
      throw new ConflictException('این کالا موجودی در انتظار کنترل کیفیت (QC) دارد؛ پیش از تبدیل به ردیابی بچ آن را تسویه کنید.');
    }
    const otherLocationsOnHand = balanceRows
      .filter((row) => row.location_id !== adjustment.locationId)
      .reduce((sum, row) => sum.plus(new Prisma.Decimal(String(row.on_hand))), new Prisma.Decimal(0));
    if (otherLocationsOnHand.greaterThan(0)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'BATCH_CUTOVER_STOCK_ELSEWHERE',
        message: `این کالا در انبارهای دیگر نیز موجودی دارد (${otherLocationsOnHand.toString()})؛ تبدیل به ردیابی بچ فقط وقتی ممکن است که کل موجودی کالا در همین انبار باشد.`,
      });
    }
    const thisLocationRow = balanceRows.find((row) => row.location_id === adjustment.locationId);
    const thisLocationOnHand = thisLocationRow ? new Prisma.Decimal(String(thisLocationRow.on_hand)) : new Prisma.Decimal(0);
    const linesSum = adjustment.items.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.quantity)), new Prisma.Decimal(0));
    if (!thisLocationOnHand.equals(linesSum)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'BATCH_CUTOVER_QUANTITY_MISMATCH',
        message: `جمع ردیف‌های بچ (${linesSum.toString()}) با موجودی فعلی این کالا در این انبار (${thisLocationOnHand.toString()}) برابر نیست.`,
        details: { linesSum: linesSum.toString(), currentOnHand: thisLocationOnHand.toString() },
      });
    }

    const adjustmentNumber = await nextDocumentNumber(tx, STOCK_ADJUSTMENT_DOC_TYPE, adjustment.adjustmentDate);

    // Step 1: ADJUSTMENT_OUT of the whole unbatched quantity — no batch yet,
    // referenceLineId null (it belongs to the document, not one line).
    if (thisLocationOnHand.greaterThan(0)) {
      await applyMovements(tx, [
        {
          itemId,
          locationId: adjustment.locationId,
          bucket: 'ON_HAND',
          movementType: 'ADJUSTMENT_OUT',
          quantity: thisLocationOnHand.negated(),
          movementDate: adjustment.adjustmentDate,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: adjustment.id,
          referenceLineId: null,
          referenceNumber: adjustmentNumber,
          note: 'تبدیل به ردیابی بچ — خروج موجودی بدون بچ',
          createdByUserId: userId,
        },
      ]);
    }

    // Step 2: flip batchTracked — AFTER the unbatched outbound row above,
    // BEFORE the batched inbound rows below (an unbatched row would be
    // rejected once the flag is already on).
    const expiryRequired = existingSetting?.expiryRequired ?? false;
    const shelfLifeDays = existingSetting?.shelfLifeDays ?? null;
    await tx.inventoryItemSetting.upsert({
      where: { itemId },
      create: { itemId, batchTracked: true, expiryRequired, shelfLifeDays, batchTrackedSince: new Date(), updatedByUserId: userId },
      update: { batchTracked: true, batchTrackedSince: new Date(), updatedByUserId: userId },
    });

    // Step 3: resolve (create) a batch per line, then ADJUSTMENT_IN each.
    const settingsByItem = new Map<number, ItemBatchSettings>([[itemId, { itemId, expiryRequired, shelfLifeDays }]]);
    const resolved = await resolveBatches(
      tx,
      adjustment.items.map((line) => ({ itemId, batchNumber: line.batchNumber!, productionDate: line.productionDate, expiryDate: line.expiryDate })),
      settingsByItem,
      userId,
    );
    await applyMovements(
      tx,
      adjustment.items.map((line, index) => ({
        itemId,
        locationId: adjustment.locationId,
        bucket: 'ON_HAND' as const,
        movementType: 'ADJUSTMENT_IN' as const,
        quantity: new Prisma.Decimal(line.quantity),
        movementDate: adjustment.adjustmentDate,
        referenceType: 'STOCK_ADJUSTMENT' as const,
        referenceId: adjustment.id,
        referenceLineId: line.id,
        referenceNumber: adjustmentNumber,
        note: line.note,
        createdByUserId: userId,
        batchId: resolved[index].batchId,
      })),
    );

    await tx.stockAdjustment.update({
      where: { id: adjustment.id },
      data: { status: 'POSTED', adjustmentNumber, postedByUserId: userId, postedAt: new Date() },
    });
    await this.audit.log(
      {
        userId,
        ipAddress,
        action: 'STOCK_ADJUSTMENT_APPROVED',
        entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
        entityId: adjustment.id,
        details: `${adjustmentNumber} — تبدیل به ردیابی بچ، ${adjustment.items.length} ردیف`,
      },
      tx,
    );
    await this.audit.log(
      {
        userId,
        ipAddress,
        action: 'INVENTORY_ITEM_SETTING_BATCH_CUTOVER',
        entityType: AUDIT_ENTITY.INVENTORY_ITEM_SETTING,
        entityId: itemId,
        details: `کالا #${itemId} — تبدیل به ردیابی بچ (${adjustmentNumber})`,
      },
      tx,
    );
  }

  // I4: friendly, per-item-tracked-state validation at create/update (before
  // the transaction even opens) — untracked = no batch fields at all; tracked
  // = exactly one of batchId/batchNumber for a positive line, a resolvable
  // batchId (never a new batchNumber) for a negative line. BATCH_CUTOVER is
  // skipped here — its items are, by definition, for an item that is NOT
  // tracked yet (the DTO's own batchCutoverRefine already requires a
  // batchNumber on every line). Re-checked authoritatively by
  // applyMovements() at post/approve either way (§5.4a).
  private async ensureBatchFieldsValid(
    kind: StockAdjustmentKind,
    items: { itemId: number; quantity: number; batchId?: number; batchNumber?: string }[],
  ) {
    if (kind === 'BATCH_CUTOVER') return;
    const itemIds = [...new Set(items.map((item) => item.itemId))];
    const settings = await this.prisma.inventoryItemSetting.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, batchTracked: true } });
    const trackedIds = new Set(settings.filter((row) => row.batchTracked).map((row) => row.itemId));
    const batchIds = items.map((item) => item.batchId).filter((id): id is number => typeof id === 'number');
    const batches = batchIds.length ? await this.prisma.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, itemId: true } }) : [];
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));

    items.forEach((item, index) => {
      const label = `ردیف ${index + 1}`;
      const tracked = trackedIds.has(item.itemId);
      const hasBatchId = typeof item.batchId === 'number';
      const hasBatchNumber = Boolean(item.batchNumber);
      if (!tracked) {
        if (hasBatchId || hasBatchNumber) {
          throw new BadRequestException(`${label}: این کالا ردیابی بچ ندارد؛ برای این ردیف نباید بچ مشخص شود`);
        }
        return;
      }
      if (item.quantity > 0) {
        if (!hasBatchId && !hasBatchNumber) {
          throw new BadRequestException(`${label}: این کالا ردیابی بچ دارد؛ یک بچ موجود را انتخاب کنید یا شمارهٔ بچ جدید وارد کنید`);
        }
      } else {
        if (!hasBatchId) {
          throw new BadRequestException(`${label}: برای کاهش موجودی این کالا باید یک بچ موجود انتخاب شود`);
        }
        if (hasBatchNumber) {
          throw new BadRequestException(`${label}: برای کاهش موجودی نمی‌توان بچ جدید ایجاد کرد؛ یک بچ موجود را انتخاب کنید`);
        }
      }
      if (hasBatchId) {
        const batch = batchById.get(item.batchId!);
        if (!batch || batch.itemId !== item.itemId) {
          throw new BadRequestException(`${label}: بچ انتخاب‌شده برای این کالا معتبر نیست`);
        }
      }
    });
  }

  // DRAFT only. A POSTED adjustment has no delete path — ever.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      this.ensureEditable(adjustment.status);
      await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT, entityId: id, label: STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind], record: adjustment, userId });
      await tx.stockAdjustment.delete({ where: { id } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_DELETED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — پیش‌نویس`,
        },
        tx,
      );
    });
    return { success: true };
  }

  private ensureEditable(status: StockDocumentStatus) {
    if (!EDITABLE_STOCK_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException('سند ثبت‌شده قابل ویرایش یا حذف نیست؛ برای اصلاح، یک سند «اصلاح موجودی» جدید ثبت کنید.');
    }
  }

  // Omitted → the default warehouse. A given location must exist and be
  // active (unless it's the one the draft already has).
  private async resolveLocation(locationId: number | undefined, currentLocationId?: number) {
    if (locationId === undefined) return (await this.inventory.getDefaultLocation()).id;
    const location = await this.prisma.inventoryLocation.findUnique({ where: { id: locationId }, select: { isActive: true } });
    if (!location || (!location.isActive && locationId !== currentLocationId)) {
      throw new BadRequestException('انبار انتخاب‌شده یافت نشد یا غیرفعال است');
    }
    return locationId;
  }

  // Read-only "exists and active" lookup into Items (CLAUDE.md rule 11's
  // documented exception).
  private async ensureActiveItems(itemIds: number[], alreadyOnDocument: number[] = []) {
    const unique = [...new Set(itemIds)];
    const items = await this.prisma.item.findMany({ where: { id: { in: unique } }, select: { id: true, status: true, name: true } });
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = new Set(alreadyOnDocument);
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) throw new BadRequestException('کالای انتخاب‌شده یافت نشد');
      if (item.status !== 'active' && !kept.has(id)) throw new BadRequestException(`کالای «${item.name}» غیرفعال است`);
    }
  }
}
