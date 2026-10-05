// Master-data option shapes as returned by the reference-data list endpoints
// (departments, employees, suppliers, units, purchase types) and consumed by
// pickers/filters across modules.

export type PurchaseTypeOption = { id: number; code: string; nameFa: string; nameEn: string };
export type UnitOption = { id: number; code: string; nameFa: string; nameEn: string };
export type SupplierOption = { id: number; code: string; name: string; status: "active" | "inactive" | "blacklisted" };
export type DepartmentOption = { id: number; code: string; name: string; status: "active" | "inactive" };
export type EmployeeOption = {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  status: "active" | "on_leave" | "terminated";
};

export function employeeFullName(employee: { firstName: string; lastName: string }): string {
  return `${employee.firstName} ${employee.lastName}`;
}
