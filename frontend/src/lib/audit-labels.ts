// Persian labels for AUDIT_LOG actions and entity types, shared by the
// admin user-detail and user-activity pages. Anything not listed falls back
// to a readable form of the raw code, so new backend actions still show up.

export const ENTITY_LABELS: Record<string, string> = {
  User: "کاربر",
  Role: "نقش",
  Purchase: "خرید",
  PurchaseRequest: "درخواست خرید",
  Customer: "مشتری",
  Supplier: "تأمین‌کننده",
  Item: "کالا",
  ItemCategory: "دسته‌بندی کالا",
  CustomerGroup: "گروه مشتری",
  Territory: "منطقه فروش",
  PaymentTerm: "شرایط پرداخت",
  StockAdjustment: "اصلاح موجودی",
  ItemStockLevel: "آستانه موجودی",
  InventoryItemSetting: "تنظیمات موجودی کالا",
  GoodsReceipt: "رسید انبار",
  ProductionOutput: "رسید تولید",
  StockCount: "شمارش موجودی",
  GoodsReturn: "برگشت به تأمین‌کننده",
  InventoryLocation: "انبار",
  SalesOrder: "سفارش فروش",
  Delivery: "تحویل",
  SalesInvoice: "فاکتور فروش",
  CustomerPayment: "دریافت/پرداخت مشتری",
  SalesReturn: "مرجوعی فروش",
  CreditNote: "اعلامیه بستانکار",
  Letter: "نامه",
  Unit: "واحد",
  Department: "دپارتمان",
  PurchaseType: "نوع خرید",
  PurchaseReturn: "برگشت خرید",
  WorkflowRule: "قانون گردش کار",
  ApprovalRequest: "درخواست تأیید",
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "ورود به سامانه",
  LOGOUT: "خروج از سامانه",
  LOGIN_FAILED: "تلاش ناموفق برای ورود",
  USER_CREATED: "ایجاد کاربر",
  USER_UPDATED: "ویرایش کاربر",
  USER_PERMISSIONS_UPDATED: "تغییر دسترسی‌های اضافی کاربر",
  ROLE_CREATED: "ایجاد نقش",
  ROLE_PERMISSIONS_UPDATED: "تغییر دسترسی‌های نقش",
  ROLE_DELETED: "حذف نقش",
  LETTER_SENT: "ارسال نامه",
  LETTER_VIEWED_BY_MANAGEMENT: "مشاهدهٔ مدیریتی نامه",
};

// Suffix → verb, used to build "<entity> <verb>" for the many
// <ENTITY>_<VERB> actions (PURCHASE_CREATED → «ایجاد خرید»).
const VERB_LABELS: Record<string, string> = {
  CREATED: "ایجاد",
  UPDATED: "ویرایش",
  DELETED: "حذف",
  CANCELLED: "لغو",
  POSTED: "ثبت نهایی",
  APPROVED: "تأیید",
  REJECTED: "رد",
  SUBMITTED: "ارسال برای تأیید",
  CONFIRMED: "تأیید نهایی",
  STATUS_CHANGED: "تغییر وضعیت",
  ADDED: "افزودن",
  REMOVED: "حذف",
  ALLOCATED: "تخصیص",
  RECEIVED: "دریافت",
  STARTED: "شروع",
  CLOSED: "بستن",
  COMPLETED: "تکمیل",
  ACTIVATED: "فعال کردن",
  DEACTIVATED: "غیرفعال کردن",
  RESTORED: "بازیابی",
};

const ENTITY_PREFIX_LABELS: [string, string][] = [
  ["ITEM_CATEGORY", "دسته‌بندی کالا"],
  ["UNIT", "واحد"],
  ["DEPARTMENT", "دپارتمان"],
  ["PURCHASE_TYPE", "نوع خرید"],
  ["TERRITORY", "منطقه فروش"],
  ["WORKFLOW_RULE", "قانون گردش کار"],
  ["USER", "کاربر"],
  ["ROLE", "نقش"],
  ["PURCHASE_REQUEST", "درخواست خرید"],
  ["PURCHASE_RETURN", "برگشت خرید"],
  ["PURCHASE", "خرید"],
  ["CUSTOMER_PAYMENT", "دریافت مشتری"],
  ["CUSTOMER_BANK_ACCOUNT", "حساب بانکی مشتری"],
  ["CUSTOMER_ADDRESS", "نشانی مشتری"],
  ["CUSTOMER_DOCUMENT", "سند مشتری"],
  ["CUSTOMER_NOTE", "یادداشت مشتری"],
  ["CUSTOMER_COMPLAINT", "شکایت مشتری"],
  ["CUSTOMER_FINANCIAL", "اطلاعات مالی مشتری"],
  ["CUSTOMER_GROUP", "گروه مشتری"],
  ["CUSTOMER", "مشتری"],
  ["SUPPLIER_BANK_ACCOUNT", "حساب بانکی تأمین‌کننده"],
  ["SUPPLIER", "تأمین‌کننده"],
  ["ITEM_STOCK_LEVEL", "آستانه موجودی"],
  ["ITEM", "کالا"],
  ["STOCK_ADJUSTMENT", "اصلاح موجودی"],
  ["STOCK_COUNT", "شمارش موجودی"],
  ["GOODS_RECEIPT", "رسید انبار"],
  ["PRODUCTION_OUTPUT", "رسید تولید"],
  ["INVENTORY_LOCATION", "انبار"],
  ["INVENTORY_ITEM_SETTING", "تنظیمات موجودی کالا"],
  ["SALES_ORDER", "سفارش فروش"],
  ["SALES_INVOICE", "فاکتور فروش"],
  ["SALES_RETURN", "مرجوعی فروش"],
  ["DELIVERY", "تحویل"],
  ["CREDIT_NOTE", "اعلامیه بستانکار"],
  ["PAYMENT_TERM", "شرایط پرداخت"],
  ["DOCUMENT", "سند"],
  ["PAYMENT", "پرداخت"],
];

export function actionLabel(action: string): string {
  const base = action.split(":")[0];
  if (ACTION_LABELS[base]) return ACTION_LABELS[base];
  for (const [prefix, entity] of ENTITY_PREFIX_LABELS) {
    if (base.startsWith(`${prefix}_`)) {
      const verb = base.slice(prefix.length + 1);
      const verbLabel = VERB_LABELS[verb];
      return verbLabel ? `${verbLabel} ${entity}` : `${entity}: ${verb.toLowerCase().replaceAll("_", " ")}`;
    }
  }
  return base.toLowerCase().replaceAll("_", " ");
}

// Failed-login rows carry "LOGIN_FAILED:<username>:<reason>" in the action
// string (the user is unknown, so userId is empty).
const FAIL_REASONS: Record<string, string> = {
  not_found: "کاربر یافت نشد",
  invalid_password: "رمز اشتباه",
  locked: "حساب قفل‌شده",
  disabled: "حساب غیرفعال",
};

export function actionDetails(action: string, details: string | null): string {
  if (action.startsWith("LOGIN_FAILED:")) {
    const [, username, reason] = action.split(":");
    return `${username} · ${FAIL_REASONS[reason] ?? reason ?? ""}`;
  }
  return details ?? "";
}

// Persian names of the fields recorded in AuditLog.changes.
export const FIELD_LABELS: Record<string, string> = {
  purchaseNumber: "شمارهٔ خرید", purchaseDate: "تاریخ خرید", returnNumber: "شمارهٔ برگشت", returnDate: "تاریخ برگشت", reason: "علت",
  totalAmount: "جمع مبلغ", paidAmount: "پرداخت‌شده", paymentStatus: "وضعیت پرداخت", sourceType: "نوع منبع",
  quantity: "مقدار", unitPrice: "قیمت واحد", totalPrice: "قیمت کل", creditAmount: "مبلغ اعتبار", discountPercent: "درصد تخفیف",
  customerNumber: "شمارهٔ مشتری", customerName: "نام مشتری", orderNumber: "شمارهٔ سفارش", orderDate: "تاریخ سفارش",
  requestedDeliveryDate: "تاریخ تحویل درخواستی", deliveryAddressText: "نشانی تحویل", paymentTermName: "شرایط پرداخت", paymentDueDays: "مهلت پرداخت (روز)",
  customerEconomicCode: "کد اقتصادی مشتری", subtotalAmount: "جمع قبل از تخفیف", discountAmount: "تخفیف", taxAmount: "مالیات",
  deliveryStatus: "وضعیت تحویل", invoicingStatus: "وضعیت فاکتور", itemKind: "نوع کالا", barcode: "بارکد", description: "شرح",
  registrationNumber: "شمارهٔ ثبت", title: "عنوان", mobile: "موبایل", fax: "فکس", website: "وب‌سایت", mobilePhone: "موبایل",
  creditLimit: "سقف اعتبار", createdAt: "زمان ثبت", updatedAt: "آخرین ویرایش", statusChangedAt: "زمان تغییر وضعیت",
  legacyCode: "کد قدیمی", supplierKind: "نوع تأمین‌کننده", country: "کشور", province: "استان", city: "شهر", address: "نشانی", postalCode: "کد پستی",

  code: "کد", name: "نام", nameFa: "نام فارسی", nameEn: "نام انگلیسی", isActive: "وضعیت", status: "وضعیت",
  sortOrder: "ترتیب نمایش", note: "توضیحات", isDefault: "پیش‌فرض", dueDays: "مهلت پرداخت (روز)",
  username: "نام کاربری", fullName: "نام کامل", email: "ایمیل", phone: "تلفن", role: "نقش", password: "رمز عبور",
  customerKind: "نوع شخص", legalName: "نام ثبتی", nationalId: "شناسه/کد ملی", economicCode: "کد اقتصادی",
  creditHold: "توقف اعتباری", statusReason: "دلیل وضعیت", price: "قیمت", sellingPrice: "قیمت فروش",
};

export const VALUE_LABELS: Record<string, string> = {
  DRAFT: "پیش‌نویس", CONFIRMED: "تأییدشده", RECEIVED: "دریافت‌شده", CLOSED: "بسته‌شده", CANCELLED: "لغوشده", PENDING_APPROVAL: "در انتظار تأیید",
  UNPAID: "پرداخت‌نشده", PARTIAL: "پرداخت جزئی", PAID: "پرداخت‌شده", OPERATIONAL: "عملیاتی", HISTORICAL_IMPORT: "ورود سوابق",
  INDIVIDUAL: "حقیقی", ORGANIZATION: "حقوقی", NOT_DELIVERED: "تحویل‌نشده", NOT_INVOICED: "فاکتورنشده",
  ACTIVE: "فعال", DISABLED: "غیرفعال", LOCKED: "قفل‌شده", INACTIVE: "غیرفعال", ARCHIVED: "بایگانی",
  active: "فعال", inactive: "غیرفعال", true: "بله", false: "خیر",
};

function changeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "خالی";
  if (field === "isActive") return value === true || value === "true" ? "فعال" : "غیرفعال";
  const text = String(value);
  return VALUE_LABELS[text] ?? (text.length > 40 ? `${text.slice(0, 40)}…` : text);
}

export type ActivityChange = { field: string; from: unknown; to: unknown };

/** Short, readable «field: old ← new» lines (at most 3, the rest summarised). */
export function describeChanges(changes: ActivityChange[] | null | undefined): string[] {
  if (!changes || changes.length === 0) return [];
  const lines = changes.slice(0, 3).map((change) => {
    const label = FIELD_LABELS[change.field] ?? change.field;
    if (change.field === "password") return `${label}: تغییر کرد`;
    return `${label}: ${changeValue(change.field, change.from)} ← ${changeValue(change.field, change.to)}`;
  });
  if (changes.length > 3) lines.push(`و ${changes.length - 3} تغییر دیگر`);
  return lines;
}

export function entityLabel(entityType: string | null): string {
  return entityType ? ENTITY_LABELS[entityType] ?? entityType : "";
}

/** "1405/07/21 14:35"-style time for feed rows. */
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
