import { formatJalali, toPersianDigits } from "@/lib/jalali";

// نامه‌نگاری — shapes returned by backend/src/letters (users only, v1).

export type LetterBox = "inbox" | "sent" | "drafts" | "archive" | "all";
export type LetterStatus = "DRAFT" | "SENT";

export type LetterPerson = { id: number; username: string; fullName: string | null };

export type LetterListItem = {
  id: number;
  letterNumber: string | null;
  status: LetterStatus;
  subject: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  sender: LetterPerson;
  recipientCount: number;
  // Sender's own view of a SENT letter.
  readCount?: number;
  unread: boolean;
  hasAttachments: boolean;
};

export type LetterAttachment = { id: number; originalName: string; sizeBytes: number; createdAt: string };

export type LetterRecipientRow = LetterPerson & { role: string; readAt?: string | null };

export type LetterDetail = {
  id: number;
  letterNumber: string | null;
  status: LetterStatus;
  subject: string;
  body: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  isSender: boolean;
  // Read through letters.readAll — neither the sender nor an addressee.
  managementView: boolean;
  sender: LetterPerson;
  recipients: LetterRecipientRow[];
  attachments: LetterAttachment[];
  inReplyTo: { id: number; letterNumber: string | null; subject: string; senderUser: LetterPerson } | null;
  replies: { id: number; letterNumber: string | null; subject: string; sentAt: string | null; senderUser: LetterPerson }[];
  my: { readAt: string | null; archivedAt: string | null } | null;
  canReply: boolean;
};

export type DirectoryUser = LetterPerson & { role: string };

export const roleLabels: Record<string, string> = {
  ADMIN: "مدیر سیستم",
  DATA_OPERATOR: "اپراتور ورود اطلاعات",
  PURCHASE_MANAGER: "مدیر خرید",
  SALES_MANAGER: "مدیر فروش",
  VIEWER: "مشاهده‌گر",
  SALESPERSON: "کارشناس فروش",
  WAREHOUSE: "انباردار",
  ACCOUNTANT: "حسابدار",
  INVENTORY_MANAGER: "مدیر موجودی",
};

// "نام کامل" when set, else the login name.
export function personName(person: LetterPerson): string {
  return person.fullName?.trim() || person.username;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${toPersianDigits(String(date.getHours()).padStart(2, "0"))}:${toPersianDigits(String(date.getMinutes()).padStart(2, "0"))}`;
  return `${formatJalali(date)} — ${time}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits(Math.round(bytes / 1024))} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

export const ALLOWED_ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Tells the app shell to re-read the unread count (sidebar badge) right away.
export const LETTERS_CHANGED_EVENT = "dms:letters-changed";
export function notifyLettersChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LETTERS_CHANGED_EVENT));
}
