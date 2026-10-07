import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomerKind, type CustomerStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges, MASKED_AUDIT_VALUE } from '../audit/audit.service';
import { ensureActiveCustomerGroup } from '../customer-groups/customer-group-rules';
import { ensureActiveTerritory } from '../territories/territory-rules';
import { escapeLike, searchKey, searchKeySql } from './customer-normalize';
import {
  ALLOWED_CUSTOMER_STATUS_TRANSITIONS,
  CUSTOMER_STATUS_LABELS_FA,
  HIDDEN_BY_DEFAULT_CUSTOMER_STATUSES,
} from './customer-rules';
import type { ChangeCustomerStatusDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

// Distinct, frontend-detectable 409 for "a customer with the same name or
// phone already exists" — a soft warning the user may override by
// resubmitting with acknowledgeDuplicates: true. Same confirm-and-resubmit
// shape as PURCHASE_QUANTITY_EXCEEDS_REQUEST.
export const CUSTOMER_POSSIBLE_DUPLICATE = 'CUSTOMER_POSSIBLE_DUPLICATE';

export type CustomerListFilters = {
  q?: string;
  // One status, 'ALL', or omitted (= everything except ARCHIVED).
  status?: CustomerStatus | 'ALL';
  customerGroupId?: number;
  territoryId?: number;
  customerKind?: CustomerKind;
};

// Fields whose old -> new values are written to AuditLog.changes on update
// (business decision 2026-10-06). nationalId is masked: only "it changed".
const AUDITED_CUSTOMER_FIELDS = ['customerKind', 'legalName', 'nationalId', 'economicCode', 'customerGroupId'] as const;
const MASKED_CUSTOMER_FIELDS = ['nationalId'] as const;

const userDisplay = { select: { id: true, username: true } } as const;

// Everything the detail page needs, EXCEPT the financial profile — that is
// served separately by CustomerFinancialService under customers.finance.
// The detail only gets a two-flag summary (credit hold for the warning
// banner, "has a payment term" for the missing-data indicator).
const customerDetailInclude = {
  customerGroup: true,
  territory: true,
  createdByUser: userDisplay,
  contacts: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  addresses: { orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] },
  notes: { orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], include: { createdByUser: userDisplay } },
  documents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { uploadedByUser: userDisplay } },
  complaints: {
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: { ownerUser: userDisplay, createdByUser: userDisplay },
  },
  financialProfile: { select: { creditHold: true, paymentTermId: true } },
} satisfies Prisma.CustomerInclude;

type CustomerDetailRow = Prisma.CustomerGetPayload<{ include: typeof customerDetailInclude }>;

// The list's lighter include: just what the table's columns need.
const customerListInclude = {
  customerGroup: { select: { id: true, code: true, nameFa: true } },
  territory: { select: { id: true, code: true, nameFa: true } },
  addresses: {
    where: { isDefault: true, isActive: true },
    select: { city: true, addressType: true },
    orderBy: { id: 'asc' },
  },
  notes: { where: { isPinned: true, noteType: 'WARNING' }, select: { id: true }, take: 1 },
  financialProfile: { select: { creditHold: true } },
} satisfies Prisma.CustomerInclude;

type CustomerListRow = Prisma.CustomerGetPayload<{ include: typeof customerListInclude }>;

// The legacy columns (customer_type / address / note, kept only as a
// migration safety net) are never sent to the client.
function withoutLegacyColumns<T extends { legacyCustomerType?: unknown; legacyAddress?: unknown; legacyNote?: unknown }>(row: T) {
  const { legacyCustomerType: _type, legacyAddress: _address, legacyNote: _note, ...rest } = row;
  return rest;
}

// nationalId (sensitive) is dropped from list rows — the table never shows
// it; it's only on the detail response.
function toListItem(row: CustomerListRow) {
  const { addresses, notes, financialProfile, nationalId: _nationalId, ...customer } = withoutLegacyColumns(row);
  const defaultAddress = addresses.find((address) => address.addressType === 'DELIVERY') ?? addresses[0];
  return {
    ...customer,
    defaultCity: defaultAddress?.city ?? null,
    hasPinnedWarning: notes.length > 0,
    creditHold: financialProfile?.creditHold ?? false,
  };
}

// nationalId is sensitive PII (same class as Employee's national ID/salary/
// bank account, restricted in §15.4 of the archive) — a customers.view-only
// caller gets it masked, same shape as the list row's omission but kept
// present (not dropped) so the detail page can show "***" rather than blank.
function toDetail(row: CustomerDetailRow, options: { canViewSensitive: boolean }) {
  const { financialProfile, ...customer } = withoutLegacyColumns(row);
  return {
    ...customer,
    nationalId: options.canViewSensitive ? customer.nationalId : customer.nationalId ? MASKED_AUDIT_VALUE : null,
    financialSummary: {
      creditHold: financialProfile?.creditHold ?? false,
      hasPaymentTerm: financialProfile?.paymentTermId != null,
    },
  };
}

@Injectable()
export class CustomersService {
  // Customer lifecycle (list/get/create/update/changeStatus/remove). Child
  // records live in their own services (customer-contacts/-addresses/
  // -notes/-documents/-complaints/-financial .service.ts), none of which
  // inject this one (no cycles) — they share customer-rules.ts instead.
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as before: without `pagination` → plain
  // array (for a future Sales customer picker); with it → { items, total,
  // page, pageSize }.
  async list(filters: CustomerListFilters = {}, pagination?: PaginationParams) {
    const and: Prisma.CustomerWhereInput[] = [];
    if (filters.q) {
      const ids = await this.searchIds(filters.q);
      if (ids !== null) and.push({ id: { in: ids } });
    }
    if (filters.status === 'ALL') {
      // everything, archived included
    } else if (filters.status) {
      and.push({ status: filters.status });
    } else {
      and.push({ status: { notIn: HIDDEN_BY_DEFAULT_CUSTOMER_STATUSES } });
    }
    if (filters.customerGroupId) and.push({ customerGroupId: filters.customerGroupId });
    if (filters.territoryId) and.push({ territoryId: filters.territoryId });
    if (filters.customerKind) and.push({ customerKind: filters.customerKind });
    const where: Prisma.CustomerWhereInput = and.length > 0 ? { AND: and } : {};

    if (!pagination) {
      const rows = await this.prisma.customer.findMany({ where, include: customerListInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      return rows.map(toListItem);
    }

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({ where, include: customerListInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(pagination) }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: rows.map(toListItem), total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number, options: { canViewSensitive: boolean } = { canViewSensitive: true }) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: customerDetailInclude });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    return toDetail(customer, options);
  }

  // History tab: this customer's audit entries (its own changes plus every
  // contact/address/note/document/complaint/financial event, all logged
  // under the customer). Field-level financial changes are only shown to
  // users with customers.finance — others see that the policy changed,
  // not to what.
  async history(id: number, options: { canViewFinance: boolean }) {
    await this.ensureExists(id);
    const entries = await this.audit.listForEntity(AUDIT_ENTITY.CUSTOMER, id);
    if (options.canViewFinance) return entries;
    return entries.map((entry) => (entry.action === 'CUSTOMER_FINANCIAL_UPDATED' ? { ...entry, changes: null } : entry));
  }

  // customerNumber ("CUS-000001") is generated here, never entered — same
  // placeholder-then-fix pattern as PurchasesService.create(). The empty
  // CustomerFinancialProfile (no payment term, no credit limit, no hold —
  // decision 6: cash-only until someone sets a policy) and the optional
  // first address/contact are created in the same transaction.
  async create(dto: CreateCustomerDto, userId: number | null = null, ipAddress?: string) {
    await ensureActiveCustomerGroup(this.prisma, dto.customerGroupId);
    if (dto.territoryId) await ensureActiveTerritory(this.prisma, dto.territoryId);
    if (dto.nationalId) await this.ensureNationalIdFree(dto.nationalId);
    await this.ensureNoUnacknowledgedDuplicates(dto.name, dto.phone, dto.acknowledgeDuplicates === true);

    const created = await this.withNationalIdConflictMessage(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.customer.create({
          data: {
            customerNumber: `PENDING-${randomUUID()}`,
            customerKind: dto.customerKind,
            name: dto.name,
            legalName: dto.legalName,
            nationalId: dto.nationalId,
            economicCode: dto.economicCode,
            phone: dto.phone,
            email: dto.email,
            customerGroupId: dto.customerGroupId,
            territoryId: dto.territoryId,
            status: 'ACTIVE',
            createdByUserId: userId,
            financialProfile: { create: {} },
            ...(dto.firstAddress ? { addresses: { create: { ...dto.firstAddress, isDefault: true } } } : {}),
            ...(dto.firstContact ? { contacts: { create: { ...dto.firstContact, isPrimary: true } } } : {}),
          },
        });
        const customerNumber = `CUS-${String(row.id).padStart(6, '0')}`;
        await tx.customer.update({ where: { id: row.id }, data: { customerNumber } });
        await this.audit.log(
          {
            userId,
            ipAddress,
            action: 'CUSTOMER_CREATED',
            entityType: AUDIT_ENTITY.CUSTOMER,
            entityId: row.id,
            details: dto.acknowledgeDuplicates ? `${customerNumber} (با تأیید هشدار مشتری مشابه)` : customerNumber,
          },
          tx,
        );
        return row;
      }),
    );
    return this.get(created.id);
  }

  // Full replace of identity/classification/communication fields (an
  // omitted optional field is cleared). Status never changes here — see
  // changeStatus(). The name/phone soft-duplicate warning is a create-time
  // check only; the nationalId hard block applies to updates too.
  //
  // Optimistic locking, same as PurchasesService.update(): up-front version
  // check, then a compare-and-set on updatedAt inside the transaction.
  async update(id: number, dto: UpdateCustomerDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.findRaw(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    // A reference is only re-checked for "still active" when it's being
    // changed (same rule as Purchases): a customer may keep a group/territory
    // that was retired since.
    if (dto.customerGroupId !== existing.customerGroupId) await ensureActiveCustomerGroup(this.prisma, dto.customerGroupId);
    if (dto.territoryId && dto.territoryId !== existing.territoryId) await ensureActiveTerritory(this.prisma, dto.territoryId);
    if (dto.nationalId && dto.nationalId !== existing.nationalId) await this.ensureNationalIdFree(dto.nationalId, id);

    const data = {
      customerKind: dto.customerKind,
      name: dto.name,
      legalName: dto.legalName ?? null,
      nationalId: dto.nationalId ?? null,
      economicCode: dto.economicCode ?? null,
      phone: dto.phone,
      email: dto.email ?? null,
      customerGroupId: dto.customerGroupId,
      territoryId: dto.territoryId ?? null,
    };
    const changes = diffChanges(existing, data, AUDITED_CUSTOMER_FIELDS, { masked: MASKED_CUSTOMER_FIELDS });

    await this.withNationalIdConflictMessage(() =>
      this.prisma.$transaction(async (tx) => {
        const claimed = await tx.customer.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
        if (claimed.count !== 1) throw recordModifiedConflict();
        await tx.customer.update({ where: { id }, data });
        await this.audit.log(
          { userId, ipAddress, action: 'CUSTOMER_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: id, details: existing.customerNumber, changes },
          tx,
        );
      }),
    );
    return this.get(id);
  }

  // PATCH /customers/:id/status — the only way a customer's status changes.
  // Legal moves: ALLOWED_CUSTOMER_STATUS_TRANSITIONS (customer-rules.ts); a
  // reason is required for SUSPENDED/ARCHIVED (changeCustomerStatusSchema);
  // moving into or out of ARCHIVED needs customers.archive (`canArchive`,
  // passed in by the controller from the session). Same race-safe
  // compare-and-set as PurchasesService.changeStatus().
  async changeStatus(
    id: number,
    dto: ChangeCustomerStatusDto,
    options: { canArchive: boolean },
    userId: number | null = null,
    ipAddress?: string,
  ) {
    const existing = await this.findRaw(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (!ALLOWED_CUSTOMER_STATUS_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new ConflictException(
        `تغییر وضعیت مشتری از «${CUSTOMER_STATUS_LABELS_FA[existing.status]}» به «${CUSTOMER_STATUS_LABELS_FA[dto.status]}» مجاز نیست`,
      );
    }
    if ((dto.status === 'ARCHIVED' || existing.status === 'ARCHIVED') && !options.canArchive) {
      throw new ForbiddenException('برای بایگانی مشتری یا خارج کردن آن از بایگانی، دسترسی «بایگانی مشتریان» لازم است');
    }

    const statusReason = dto.reason ?? null;
    const changes = diffChanges(
      { status: existing.status, statusReason: existing.statusReason },
      { status: dto.status, statusReason },
      ['status', 'statusReason'],
    );
    let action = 'CUSTOMER_STATUS_CHANGED';
    if (dto.status === 'ARCHIVED') action = 'CUSTOMER_ARCHIVED';
    else if (existing.status === 'ARCHIVED') action = 'CUSTOMER_UNARCHIVED';

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.customer.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.customer.update({ where: { id }, data: { status: dto.status, statusReason, statusChangedAt: new Date() } });
      await this.audit.log(
        { userId, ipAddress, action, entityType: AUDIT_ENTITY.CUSTOMER, entityId: id, details: `از ${existing.status} به ${dto.status}`, changes },
        tx,
      );
    });
    return this.get(id);
  }

  // Deletion is deliberately narrow (same idea as PurchasesService.remove()):
  // only a customer with no contacts, addresses, notes, documents or
  // complaints can be removed — anything with history must be archived
  // instead. Its (always present, policy-only) financial profile goes with it.
  async remove(id: number, userId: number | null = null, ipAddress?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { contacts: true, addresses: true, notes: true, documents: true, complaints: true } } },
    });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    const counts = customer._count;
    if (counts.contacts + counts.addresses + counts.notes + counts.documents + counts.complaints > 0) {
      throw new ConflictException('این مشتری دارای مخاطب، آدرس، یادداشت، مدرک یا شکایت ثبت‌شده است و قابل حذف نیست. به‌جای حذف، آن را بایگانی کنید.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customerFinancialProfile.deleteMany({ where: { customerId: id } });
      await tx.customer.delete({ where: { id } });
      await this.audit.log(
        { userId, ipAddress, action: 'CUSTOMER_DELETED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: id, details: customer.customerNumber },
        tx,
      );
    });
    return { success: true };
  }

  // Active users, for the complaint "owner" picker (id + username only).
  // A read-only display lookup on the users table — see the report: this is
  // a candidate for a UsersService method if module boundaries are tightened.
  listAssignableUsers() {
    return this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, username: true }, orderBy: { username: 'asc' } });
  }

  // --- helpers ---------------------------------------------------------------

  private async findRaw(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    return customer;
  }

  private async ensureExists(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
  }

  // Ids of customers matching a free-text search over number, name, legal
  // name, legacy code, phone, national id and contact names — compared on
  // the normalized search key (customer-normalize.ts) on both sides.
  // null = the query normalizes to nothing, i.e. no search filter.
  private async searchIds(q: string): Promise<number[] | null> {
    const key = searchKey(q);
    if (!key) return null;
    const pattern = `%${escapeLike(key)}%`;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT c.id FROM customers c
      WHERE ${searchKeySql('c.customer_number')} LIKE ${pattern}
         OR ${searchKeySql('c.name')} LIKE ${pattern}
         OR ${searchKeySql('c.legal_name')} LIKE ${pattern}
         OR ${searchKeySql('c.legacy_code')} LIKE ${pattern}
         OR ${searchKeySql('c.phone')} LIKE ${pattern}
         OR ${searchKeySql('c.national_id')} LIKE ${pattern}
         OR EXISTS (
           SELECT 1 FROM customer_contacts cc
           WHERE cc.customer_id = c.id AND ${searchKeySql('cc.name')} LIKE ${pattern}
         )`;
    return rows.map((row) => Number(row.id));
  }

  // Hard block (decision 5): an exact national id match is never allowed.
  private async ensureNationalIdFree(nationalId: string, excludedId?: number) {
    const other = await this.prisma.customer.findUnique({ where: { nationalId }, select: { id: true, customerNumber: true } });
    if (other && other.id !== excludedId) {
      throw new ConflictException(`مشتری دیگری (${other.customerNumber}) با همین شناسه/کد ملی ثبت شده است`);
    }
  }

  // Soft warning (decision 5): same normalized name, or same phone, as an
  // existing customer (any status). Without acknowledgeDuplicates this
  // throws a 409 whose body is:
  //   { statusCode: 409, code: 'CUSTOMER_POSSIBLE_DUPLICATE',
  //     message: '<Persian summary>',
  //     details: { candidates: [{ id, customerNumber, name, status,
  //       matchedOn: ('name' | 'phone')[] }] } }
  // so the frontend can show the candidates and resubmit with the flag.
  private async ensureNoUnacknowledgedDuplicates(name: string, phone: string, acknowledged: boolean) {
    if (acknowledged) return;
    const nameKey = searchKey(name);
    const matches = await this.prisma.$queryRaw<{ id: number; name_match: boolean; phone_match: boolean }[]>`
      SELECT c.id,
             (${searchKeySql('c.name')} = ${nameKey}) AS name_match,
             (c.phone = ${phone}) AS phone_match
      FROM customers c
      WHERE ${searchKeySql('c.name')} = ${nameKey} OR c.phone = ${phone}
      ORDER BY c.id
      LIMIT 20`;
    if (matches.length === 0) return;

    const rows = await this.prisma.customer.findMany({
      where: { id: { in: matches.map((match) => Number(match.id)) } },
      select: { id: true, customerNumber: true, name: true, status: true },
      orderBy: { id: 'asc' },
    });
    const candidates = rows.map((row) => {
      const match = matches.find((candidate) => Number(candidate.id) === row.id);
      const matchedOn: ('name' | 'phone')[] = [];
      if (match?.name_match) matchedOn.push('name');
      if (match?.phone_match) matchedOn.push('phone');
      return { ...row, matchedOn };
    });
    throw new ConflictException({
      statusCode: 409,
      code: CUSTOMER_POSSIBLE_DUPLICATE,
      message: 'مشتری با نام یا شماره تلفن مشابه از قبل ثبت شده است. در صورت اطمینان از متفاوت بودن مشتری، ثبت را تأیید کنید.',
      details: { candidates },
    });
  }

  // The up-front nationalId check can race a concurrent save; the DB's
  // unique index is the final word — turn its P2002 into the same Persian 409.
  private async withNationalIdConflictMessage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(error.meta?.target ?? '').includes('national_id')
      ) {
        throw new ConflictException('مشتری دیگری با همین شناسه/کد ملی ثبت شده است');
      }
      throw error;
    }
  }
}
