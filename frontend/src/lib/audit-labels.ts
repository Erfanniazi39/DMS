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
};

const ENTITY_PREFIX_LABELS: [string, string][] = [
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

export function entityLabel(entityType: string | null): string {
  return entityType ? ENTITY_LABELS[entityType] ?? entityType : "";
}

/** "1405/07/21 14:35"-style time for feed rows. */
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
