import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CustomerStatus } from '@prisma/client';

// The Customers module's single definition of what its statuses mean, plus
// the plain DI-free checks other code may import (same pattern as
// purchases/purchase-rules.ts and purchase-types/purchase-type-rules.ts).
// Importing this never creates a module dependency.

export const CUSTOMER_STATUS_LABELS_FA: Record<CustomerStatus, string> = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  SUSPENDED: 'معلق',
  ARCHIVED: 'بایگانی‌شده',
};

// Which status a customer may move to via PATCH /customers/:id/status
// (CustomersService.changeStatus()). No business-owner-specified
// restriction exists yet, so every move to a *different* status is allowed;
// the only rules are: a reason is required for SUSPENDED/ARCHIVED, and
// moving into or out of ARCHIVED needs customers.archive (checked in
// changeStatus()). Tighten this matrix here if a restriction is decided.
export const ALLOWED_CUSTOMER_STATUS_TRANSITIONS: Record<CustomerStatus, CustomerStatus[]> = {
  ACTIVE: ['INACTIVE', 'SUSPENDED', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
};

// Target statuses that require a statusReason (business decision 2026-10-06).
export const REASON_REQUIRED_CUSTOMER_STATUSES: CustomerStatus[] = ['SUSPENDED', 'ARCHIVED'];

// Hidden from the customer list unless explicitly filtered for.
export const HIDDEN_BY_DEFAULT_CUSTOMER_STATUSES: CustomerStatus[] = ['ARCHIVED'];

type CustomerExistsFinder = {
  customer: { findUnique(args: { where: { id: number }; select: { id: true } }): Promise<{ id: number } | null> };
};

// 404 unless the customer exists — used by every customer child-record
// service (contacts, addresses, notes, documents, complaints, financial).
export async function ensureCustomerExists(db: CustomerExistsFinder, id: number) {
  const customer = await db.customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer) throw new NotFoundException('مشتری پیدا نشد');
}

type TransactableCustomerFinder = {
  customer: {
    findUnique(args: {
      where: { id: number };
      select: { id: true; status: true; financialProfile: { select: { creditHold: true } } };
    }): Promise<{ id: number; status: CustomerStatus; financialProfile: { creditHold: boolean } | null } | null>;
  };
};

// The hook a future Sales module imports (without injecting
// CustomersService) before recording a transaction for a customer: the
// customer must exist, be ACTIVE, and not be on credit hold. Not used by any
// module yet — Sales doesn't exist.
export async function ensureTransactableCustomer(db: TransactableCustomerFinder, id: number) {
  const customer = await db.customer.findUnique({
    where: { id },
    select: { id: true, status: true, financialProfile: { select: { creditHold: true } } },
  });
  if (!customer) throw new ConflictException('مشتری انتخاب‌شده یافت نشد');
  if (customer.status !== 'ACTIVE') {
    throw new ConflictException(`مشتری انتخاب‌شده «${CUSTOMER_STATUS_LABELS_FA[customer.status]}» است و امکان ثبت تراکنش برای آن وجود ندارد`);
  }
  if (customer.financialProfile?.creditHold) {
    throw new ConflictException('مشتری انتخاب‌شده در توقف اعتباری است و امکان ثبت تراکنش برای آن وجود ندارد');
  }
}
