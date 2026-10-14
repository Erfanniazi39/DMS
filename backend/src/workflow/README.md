# Workflow / approval engine (موتور گردش کار و تأیید)

Rules decide **which documents need approval and from whom**; approval requests are the per-document instances.
Design: architect subagent, 2026-10-14. Owner answers: all three document types (purchases, purchase requests, sales),
level order sequential, no self-approval, one user = one level per request, comment **required on reject, optional on approve**,
reject → back to draft, letters notify (approval happens on the document page), flag `workflowApprovals` (`DMS_FEATURE_WORKFLOW`, default off).

## Boundaries (CLAUDE.md rule 11)
- `WorkflowModule` imports nothing from Purchases/Sales; they import it and call `WorkflowService`. No cycle.
- The **owning module sends facts** (`WorkflowFacts`) and changes its **own** status from the result. The engine never reads/writes their tables.
- `ApprovalRequest` has no FK to documents (`documentType` + `documentId`). Rule scope ids (purchase type / supplier / department) are plain ints validated as "exists and active".
- Write methods take the caller's `tx` (like `AuditService.log`) so document change + approval commit together.

## Engine API (`workflow.service.ts`)
`evaluate` (read-only preview; "not required" when the flag is off) · `start` · `decide` (APPROVE/REJECT; eligibility re-read from DB) ·
`cancel` (WITHDRAWN/CANCELLED) · `getTimeline` · `canDecide` · `approvedAmount` · `inbox` / `inboxCount` · `stuck`.

## Rules
First active match by `sortOrder` wins (put higher amount bands first). Band = `[min, max)` on `amountBasis` (TOTAL / ANY_LINE_TOTAL / ANY_UNIT_PRICE);
a band rule never matches when the basis amount is unknown. Steps = ordered levels, each a ROLE (any active user holding it) or a specific USER.
Editing a rule bumps `version`; running requests keep their own step/rule snapshot. A used rule can only be deactivated.
Permissions: `workflow.manage` (ADMIN) defines rules; `workflow.inbox` (every role) opens the inbox. Who may *approve* comes from the rule.

## DB guarantees (migration `20261014150000_workflow_engine`)
Partial unique index: one PENDING request per document · CHECK ROLE⇒role only / USER⇒user only on both step tables · CHECK min < max.

## Status
- W1 done: schema, rules CRUD, engine, inbox/stuck endpoints, specs.
- W2 done: rules admin UI — `/workflow/rules` (list per document type with order arrows, activate/deactivate, delete, test box), `/workflow/rules/new`, `/workflow/rules/[id]/edit`; `GET /workflow/form-options` feeds the pickers; nav group «گردش کار» (flag `workflowApprovals`). Browser-checked with Playwright.
- W3 done (backend): purchases gated — see `purchases/README.md` «Workflow approval». Migration `20261014170000_purchase_pending_approval` adds `PurchaseStatus.PENDING_APPROVAL`.
- W4 done (frontend): purchases UI — `PENDING_APPROVAL` badge + list filter, `purchases/[id]/_sections/ApprovalSection.tsx` (history, approve/reject/withdraw dialogs; reject needs a reason, approve takes an optional note), «ارسال برای تأیید» toast when «تأیید خرید» routes to approval, «ویرایش» hidden while waiting, live preview banner on `PurchaseForm` (create: needs approval; edit: would go back for approval / refused when already received). Browser-checked with Playwright (two users).
- W5 done: letter notifications via `LettersService.sendSystemLetter(tx, …)` (Letters exports it; Letters imports no business module). Level opened → one letter to every eligible approver (named user, or active role holders minus requester and earlier deciders), sent on behalf of the requester (level 1) or the previous approver; final approve/reject → letter to the requester from the decider, with the comment/reason. `notifyByLetter` per rule (snapshotted on the request). Letter id stored on `approval_steps.notification_letter_id` (plain int). No letter on withdraw/cancel. Each letter uses a real `LTR-` number.
- W6 done: `/workflow/inbox` (کارتابل تأییدها) — tabs «در انتظار من» / «تصمیم‌های من» / «ارسال‌شده‌های من» and, for `workflow.manage`, «متوقف‌شده‌ها» (`GET /workflow/stuck`); rows link to the document page (decisions are made there). Sidebar item «کارتابل تأییدها» with a polled badge (`GET /workflow/inbox/count`, refreshed at once via the `dms:workflow-changed` event the purchase page fires after a decision). Browser-checked with Playwright.
- W7 done: **sales orders** and **purchase requests** on the engine (migration `20261014190000_workflow_discount_condition` adds `workflow_rules.min_discount_percent`; **48 migrations**).
  - *Sales orders* (`sales-orders.service.ts`, facts in `sales-rules.ts salesOrderWorkflowFacts`): a matching SALES_ORDER rule (amount band on total / line / unit price, and/or a discount condition: largest line discount ≥ N %, 0 = any discount) takes over `confirm()` — even for a `sales.approve` holder — and parks the order in the existing PENDING_APPROVAL (no number, no reservation); the order number is assigned at final approval by the unchanged `finalizeConfirm()`. `approve`/`reject` routes now need only `sales.view`: an order with an open approval request is decided by the rule's approver (engine checks the DB; the requester never can); an order without one (the built-in discount/credit approval) still needs `sales.approve` (checked in the service). `POST :id/withdraw` (sales.manage; requester or sales.approve). With NO matching rule — or the flag off — the built-in approval is untouched. **Historical entry bypasses** (`SalesActor.workflow='bypass'`); **quick sale refuses** a rule-held order (409 `SALES_ORDER_NEEDS_WORKFLOW_APPROVAL`, its draft is removed again). Approval request `documentNumber` for a draft order is «پیش‌نویس <id>» (the SO number doesn't exist yet).
  - *Purchase requests*: no new status — SUBMITTED is the waiting state. Facts = purchase type + requester department only (no prices, so amount rules never match). `PATCH` to APPROVED (or DRAFT→SUBMITTED) on a rule-matched request starts an approval and holds it SUBMITTED; while one is open the request is frozen (APPROVED / edits → 409), leaving it (DRAFT / REJECTED / CANCELLED) closes the approval. `POST :id/approve|reject|withdraw`; reject → **DRAFT** (not REJECTED — owner default 10); `GET :id` returns `approval { requests, canDecide, requestedByUserId, waitingOnWorkflow }`.
  - Frontend: one shared `components/workflow/ApprovalPanel.tsx` (types in `lib/approval.ts`) used by the purchase, purchase-request and sales-order detail pages; rule form has the discount field for sales rules; test box has a discount input.
- Not yet / ideas: a sales-order approval preview on the order form; discount rules per customer group; escalation/delegation (owner: not in v1).
