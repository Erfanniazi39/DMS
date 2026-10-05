import { ConflictException } from '@nestjs/common';

// Optimistic locking for full-record edit forms (PATCH /purchases/:id,
// PATCH /purchase-requests/:id — business decision 2026-10-05): the client
// sends back the `updatedAt` it loaded; if the row has been saved since, the
// edit is refused instead of silently overwriting the newer version. The
// `code` lets the frontend tell this apart from other 409s and force a reload.
export const RECORD_MODIFIED_CODE = 'RECORD_MODIFIED';

export function recordModifiedConflict() {
  return new ConflictException({
    statusCode: 409,
    code: RECORD_MODIFIED_CODE,
    message: 'این رکورد پس از بارگذاری شما توسط کاربر دیگری تغییر کرده است. لطفاً صفحه را بازخوانی کنید و تغییرات خود را دوباره اعمال کنید.',
  });
}

// Day-precision is NOT enough here — compare the exact instant.
export function isSameVersion(stored: Date | string, clientLoaded: Date) {
  return new Date(stored).getTime() === clientLoaded.getTime();
}
