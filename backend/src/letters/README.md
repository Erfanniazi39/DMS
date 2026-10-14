# Letters (نامه‌نگاری)

Internal correspondence between **system users** — v1 scope set by the business owner (2026-10-13): "simple communications between departments and users", narrowed to users only (no departments, no outside parties). Users already have roles; a department is not addressable.

## Model (`prisma/schema.prisma`)
- `Letter` — DRAFT → SENT only. `letterNumber` (`LTR-<jalali year>-NNNNNN`, gap-free via `common/document-sequence.ts`) and `sentAt` exist exactly when SENT (DB CHECK `letters_sent_has_number_and_date`). A SENT letter is never edited or deleted.
- `LetterRecipient` (letter, user, readAt, archivedAt) — one row per addressee. For a DRAFT it just records the chosen addressees and grants no access; for a SENT letter it IS the delivery and the recipient's read access.
- `LetterAttachment` — files on DRAFTs only (pdf, png, jpg, Word doc/docx, Excel xls/xlsx — magic-byte checked in `common/file-signature.ts`; 10 MB, max 10), stored under `uploads/letters/<uuid>.<ext>`, never served statically.
- `User.fullName` — optional display name (plain account data; NOT an Employee link — CLAUDE.md rule 1).

## Visibility — the one rule (`letter-rules.ts` `visibleLetterWhere`)
A user sees a letter only if they are its sender (draft or sent) or a recipient of a SENT letter. Everything else is a **404**, never a 403. Every read path (list, detail, attachment download, reply parent) goes through this one filter.

**Management oversight (owner, 2026-10-13):** permission `letters.readAll` (ADMIN only by default; grant others on the roles screen) adds exactly one branch — any **SENT** letter, never anyone's DRAFT. It is **read-only** (no reply, archive, edit, send, delete — those stay sender/recipient-only) and every such view writes an audit entry `LETTER_VIEWED_BY_MANAGEMENT` (letter number only). `GET /letters?box=all` lists every sent letter and is 403 without the permission; the detail response carries `managementView: true` and shows read receipts.

## Endpoints (`letters.use`, held by every role)
`GET /letters?box=inbox|sent|drafts|archive|all&q=&page=` (`all` needs `letters.readAll`) · `GET /letters/unread-count` · `GET /letters/directory` · `GET /letters/:id` · `POST /letters` (draft; `inReplyToId` for a reply — only a recipient of a SENT letter, defaults to the parent's sender) · `PATCH|DELETE /letters/:id` (own draft) · `POST /letters/:id/send` · `POST /letters/:id/read|archive|unarchive` · `POST|DELETE /letters/:id/attachments[/:attachmentId]` · `GET /letters/attachments/:attachmentId/file`.

## Codes become links
Letters carry document/item **codes** instead of copied data. At view time the page sends the code-like tokens it finds in the subject/body to `POST /letters/resolve-codes` (`letter-links.service.ts`); a code comes back as a link only if the record exists **and** the reader holds that page's view permission (e.g. `SO-` → `sales.view` → `/sales-orders/:id`); otherwise it stays plain text and nothing is revealed. Nothing is stored in the letter. Supported: PUR, REQ, SO, DN, INV, RMA, RCP/RFD, CUS, ADJ, GRN, PRD, and item codes (→ stock card, `inventory.view`). To add a new document type, add one entry to `DOCUMENT_RESOLVERS`. Existence lookups are read-only direct Prisma (CLAUDE.md rule 11's documented exception).

## Send
One transaction: re-validate addressees (exist, ACTIVE, not the sender), claim the number, flip DRAFT→SENT with a status-guarded update (a lost double-send gets 409 and its number rolls back), audit `LETTER_SENT` (number + count only — never the subject/body).

## Left out of v1
Departments/groups, CC/BCC, forward, recall/edit after send, categories/priority/confidentiality, outside correspondents (دبیرخانه register — owner confirmed internal-only), notifications (the unread badge polls), links to Purchases/Sales.
