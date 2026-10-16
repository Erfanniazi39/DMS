// The document types whose numbers the company can format. docType is the
// short code passed to nextDocumentNumber() by the owning module (kept here as
// plain strings: Numbering imports no business module). RCP and RFD share one
// table (customer payments), so their numbers must stay distinguishable.
export const NUMBERED_DOCUMENTS = [
  { docType: 'SO', label: 'سفارش فروش' },
  { docType: 'DN', label: 'حواله تحویل' },
  { docType: 'INV', label: 'فاکتور فروش' },
  { docType: 'RMA', label: 'مرجوعی فروش' },
  { docType: 'CN', label: 'اعلامیه بستانکار' },
  { docType: 'RCP', label: 'دریافت از مشتری' },
  { docType: 'RFD', label: 'بازپرداخت به مشتری' },
  { docType: 'GRN', label: 'رسید انبار' },
  { docType: 'PRD', label: 'رسید تولید' },
  { docType: 'GRT', label: 'برگشت به تأمین‌کننده (انبار)' },
  { docType: 'ADJ', label: 'اصلاح موجودی' },
  { docType: 'CNT', label: 'شمارش موجودی' },
  { docType: 'LTR', label: 'نامه' },
] as const;

export type NumberedDocType = (typeof NUMBERED_DOCUMENTS)[number]['docType'];

export function isNumberedDocType(value: string): value is NumberedDocType {
  return NUMBERED_DOCUMENTS.some((doc) => doc.docType === value);
}

// Types that share one table: their prefixes may not be equal.
export const SHARED_TABLE_GROUPS: readonly (readonly NumberedDocType[])[] = [['RCP', 'RFD']];
