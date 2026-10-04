# Project State — snapshot as of 2026-10-04, ~11:45 (Asia/Tehran)

**Read this file first, before `docs/project-knowledge-archive.md`.** The archive is the deep historical record (read its §17, most recent, for full detail on everything below). This file is just: where exactly things stand right now, and how to pick back up.

The user is switching this machine's OS to Windows and plans to return in **~1 hour**.

---

## ⚠️ Nothing from today (or the prior session, 2026-10-03) has been committed

`git status` shows a staged rename (`admin/page.tsx` → `main/page.tsx`) plus ~29 modified tracked files and several new untracked backend/frontend files — **two full sessions' worth of real, tested, working changes, sitting only in this working tree.**

**If this Linux environment becomes unreachable after the OS switch (different machine, wiped partition, etc.), all of this is at risk.** If it's the same disk (dual-boot) it should be fine either way, but committing (and ideally pushing) before stepping away is the safe move. **This was not done because committing/pushing wasn't explicitly requested — ask the user first**, don't do it automatically.

Run `git status` and `git diff --stat` fresh when you resume — don't trust this snapshot blindly if time has passed or anything else touched the tree.

---

## Environment state right now

- **Postgres**: Docker container `business_system_postgres`, up and healthy. `npx prisma migrate status` → 21 migrations, schema up to date, no drift beyond the expected `user_sessions` table.
- **Backend**: `npm run start:dev`, port 3001, PID 40254 in this session (will not survive the OS switch — restart it). Needs Node ≥24.9 (`PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH npm run start:dev` if the shell's default Node is older — check `backend/.nvmrc`).
- **Frontend**: `npm run dev` (Turbopack), port 3000, PID 16451 in this session (also won't survive — restart it).
- **Login credentials for testing**: the seeded `admin` user's original password was lost (random, never saved) and `E2E_ADMIN_PASSWORD` isn't set in this sandbox. **It was reset to `TempAdmin#2026` this session**, with the user's go-ahead, purely so live browser verification was possible. This is a real change to the dev database — not cosmetic. Change it once done testing, or re-reset the same way if needed again (see archive §17.8 for how).

If resuming on an actually different Windows environment (not just a reboot of the same disk): Postgres/Docker, the Node version pin, and this exact `admin` password will **not** carry over automatically — re-check all three before assuming anything works.

---

## What happened across the last two sessions (§16 + §17 of the archive)

**§16 (2026-10-03)** — architecture cleanup, no schema/API/behavior change: a shared `PurchaseQuantitiesService` so Purchase Requests stops re-deriving Purchases' CANCELLED-exclusion rule; a shared `AuditService` replacing five separate private audit writers; dashboard gained `topSuppliers` + a new `/dashboard/open-items` endpoint (aging buckets, oldest-open lists); full frontend lint cleanup (0 problems). 188 backend tests passing at that point.

**§17 (2026-10-04, today)** — a batch of user-reported UI/UX fixes, all verified live in-browser:
- Dashboard moved `/admin` → `/main` (admin now reserved for real administration only).
- Fixed Persian wording ("سن" → "مدت‌زمان"/"بازه زمانی"/"مدت") and made aging buckets show real calendar-date ranges instead of "۰ تا ۳۰ روز".
- موارد باز's age column now shows "۱۵ سال، ۶ ماه و ۲۱ روز" instead of a raw day count.
- Purchase Request form defaults its date to today; "(اختیاری)" labels replaced with the existing red-asterisk `RequiredMark` convention, applied consistently across the Purchase/Purchase-Request forms and the purchase detail page's dialogs.
- Added تایید/ثبت خرید buttons to the Purchase Request detail page (permission-gated: `purchases.edit`/`purchases.manage`), and **fixed a real backend bug** where `PurchaseRequestsService.update()` didn't return computed quantities, causing ثبت خرید to need a manual page refresh to become clickable.
- Added a `success` (green) button variant; colored the two new buttons distinctly from "ویرایش".
- Added pagination to the Purchase Requests list (backend + frontend), matching the existing Purchases list pattern.
- Fixed a **real, always-on** horizontal-overflow bug on `/purchases`, `/purchase-requests`, and the Purchase Request detail page's items table — their tables had a hardcoded minimum width *wider than their own container could ever provide*, so the scrollbar the user saw wasn't a narrow-screen edge case.
- Made the Purchase Request detail page's items table scroll internally (bounded height, sticky header) instead of stretching the whole page.
- Added icons to the four purchase/purchase-request sidebar sub-items.
- Confirmed with the user and **left as-is, deliberately**: the dashboard's 366-day custom-date-range cap is an intentional design decision (dashboard = recent state, not multi-year reporting — that's the future Reports module's job), not a bug. Don't revisit this without a new explicit instruction.

All of it: backend build + 189 tests passing, frontend build + lint (0 problems) passing, and manually click-tested in a live logged-in browser session.

---

## Nothing is currently blocked or mid-way

Every task from both sessions reached a verified, working, complete state — there's no half-finished edit sitting in the tree. The only open item is the commit/push question above.

## Suggested first steps on resume

1. `git status` — confirm the tree still matches this snapshot.
2. Ask the user whether to commit (and push) before doing anything else, given the OS-switch risk noted above.
3. Restart Postgres (if not already up), backend, frontend — see Environment state above.
4. Re-read `docs/project-knowledge-archive.md` §17 if picking up any of today's specific changes.
