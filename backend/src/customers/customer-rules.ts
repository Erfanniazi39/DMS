import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomerKind, type CustomerStatus } from '@prisma/client';

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
// customer must exist, be ACTIVE, and not be on credit hold. Used by
// SalesOrdersService (create / confirm / approve) since Sales batch 2.
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

export type CustomerCreditPolicy = {
  // null = no credit limit has been set (see the Sales module's credit rule
  // for what that means for an order — business decision B4).
  creditLimit: Prisma.Decimal | null;
  creditHold: boolean;
  paymentTerm: { id: number; nameFa: string; dueDays: number } | null;
};

// The customer's credit/payment POLICY as stored, for a future Sales/finance
// caller (DI-free, same role as ensureTransactableCustomer()). Only reports
// the policy values — what they mean for an order is the caller's rule.
// `forUpdate` row-locks the financial profile inside the caller's
// transaction, so concurrent credit checks for the same customer serialize
// (and a policy edit can't interleave with one). A customer without a profile
// row (should not happen — one is created with every customer) reads as
// "no limit set, not on hold, no payment term".
export async function getCustomerCreditPolicy(
  tx: Prisma.TransactionClient,
  customerId: number,
  options: { forUpdate?: boolean } = {},
): Promise<CustomerCreditPolicy> {
  if (options.forUpdate) {
    await tx.$queryRaw`SELECT id FROM customer_financial_profiles WHERE customer_id = ${customerId} FOR UPDATE`;
  }
  const profile = await tx.customerFinancialProfile.findUnique({
    where: { customerId },
    select: { creditLimit: true, creditHold: true, paymentTerm: { select: { id: true, nameFa: true, dueDays: true } } },
  });
  return {
    creditLimit: profile?.creditLimit == null ? null : new Prisma.Decimal(profile.creditLimit),
    creditHold: profile?.creditHold ?? false,
    paymentTerm: profile?.paymentTerm ?? null,
  };
}

export type CustomerInvoiceSnapshot = {
  name: string;
  customerKind: CustomerKind;
  legalName: string | null;
  economicCode: string | null;
  registrationNumber: string | null;
  // The default active BILLING address's phone, else the customer's phone 1.
  phone: string;
  billingAddress: { province: string | null; city: string | null; addressLine: string; postalCode: string | null } | null;
};

// The buyer data a sales invoice snapshots (2026-10-13), so which address is
// "the billing address" stays Customers' rule (default active BILLING first,
// else the lowest id). DI-free, same pattern as getCustomerCreditPolicy().
// The national ID is deliberately NOT part of it (decision B14).
export async function getCustomerInvoiceSnapshot(tx: Prisma.TransactionClient, customerId: number): Promise<CustomerInvoiceSnapshot> {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { name: true, customerKind: true, legalName: true, economicCode: true, registrationNumber: true, phone: true },
  });
  if (!customer) throw new ConflictException('مشتری انتخاب‌شده یافت نشد');
  const address = await tx.customerAddress.findFirst({
    where: { customerId, isActive: true, addressType: 'BILLING' },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: { province: true, city: true, addressLine: true, postalCode: true, phone: true },
  });
  return {
    name: customer.name,
    customerKind: customer.customerKind,
    legalName: customer.legalName,
    economicCode: customer.economicCode,
    registrationNumber: customer.registrationNumber,
    phone: address?.phone ?? customer.phone,
    billingAddress: address ? { province: address.province, city: address.city, addressLine: address.addressLine, postalCode: address.postalCode } : null,
  };
}
