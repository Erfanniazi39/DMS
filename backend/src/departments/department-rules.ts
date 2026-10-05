import type { DepartmentStatus } from '@prisma/client';

// The Departments module's single definition of an "active" department —
// the only kind other modules (Employees, Purchases, Purchase Requests) may
// newly reference. Pure value only (no DI), same pattern as
// purchases/purchase-rules.ts, so importing it never creates a module
// dependency cycle. The existence/active check itself is the documented
// read-only cross-module lookup exception (CLAUDE.md rule 11).
export const ACTIVE_DEPARTMENT_STATUS: DepartmentStatus = 'active';
