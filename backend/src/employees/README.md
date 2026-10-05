# Employees module (backend)

Employee HR master data. It is fully independent of `User`: no FK and no join, ever
(CLAUDE.md rule 1). Other modules, such as the purchase buyer and the request requester,
reference `Employee` by id and receive display fields only. Background:
`docs/project-knowledge-archive.md` §2.3.

## Files to open first

- `employees.service.ts`: list/get/create/update, `updatePhoto()`, `updateContractDocument()`, national-ID uniqueness, active-department check (`departments/department-rules.ts` `ACTIVE_DEPARTMENT_STATUS`).
- `dto/employee.dto.ts`: the Zod schemas and every field rule.
- `employees.controller.ts`: routes and the multer upload config.

Routes: `GET /employees` and `GET /employees/:id` (`employees.view`). `POST /employees`,
`PATCH /employees/:id`, `POST|DELETE /employees/:id/photo`, and
`POST|DELETE /employees/:id/contract-document` (`employees.manage`).

## Rules enforced in code

- **Employee code is server-generated, never client-supplied.** It is `<DEPARTMENT_CODE>-<id padded to 4>`, e.g. `IT-0007`. The row is inserted with a placeholder and corrected in the same transaction. `code` is not part of either DTO and stays fixed if the employee changes department.
- **Persian-only names:** `PERSIAN_NAME_REGEX` in the DTO (Persian letters, space, ZWNJ) applies to first name, last name, and father's name.
- National ID (10 Latin digits) is required and unique. Birth date is required. Mobile must be exactly 11 Latin digits.
- Cross-field rules are in `withCrossFieldRules()`, for example salary amount requires salary period.
- Field categories, grouped by comment headers in `employeeFields` in the DTO: core identity/contact, identity & family, education, employment & contract (incl. salary and bank account), contact & other. `status` (active / on_leave / terminated) exists only on update.
- `EmployeesService` does **not** write `AuditLog` today, unlike Purchases.

**Sensitive fields:** national ID, salary, and bank account/Sheba are stored here. Any
change touching them should get a `security-reviewer` pass. Never put them in logs or
audit details.

## File uploads

- Photo: `.png/.jpg/.jpeg/.webp`, 5 MB max. Contract document: `.pdf/.png/.jpg/.jpeg`, 10 MB max.
- Files are stored on disk as `uploads/employees/<uuid><ext>`. The DB columns are `photoPath` and `contractDocumentPath`. Uploads are a separate step from the JSON form, and the old file is deleted best-effort.
- The extension is the only check. `common/file-signature.ts` is not used here yet.

**KNOWN GAP (flagged in QA 2026-10-05, deliberately out of scope so far):**
`main.ts` still serves `/uploads/employees` as **unauthenticated static files**. Anyone
who knows a UUID filename can fetch an employee photo or contract with no session. The
same bug class was fixed for purchases (`purchases/purchase-files.controller.ts`, guarded
by `purchases.view`). The equivalent fix here would be a guarded route requiring
`employees.view`.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- employees   # employees.service.spec.ts + dto/employee.dto.spec.ts
```
