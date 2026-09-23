-- AlterTable: bank account number ("شماره حساب") — free text, since it may
-- hold a plain account number, a card number, or a Sheba/IBAN depending on
-- what the company collects. Not constrained to a specific format.
ALTER TABLE "employees" ADD COLUMN "bank_account_number" TEXT;
