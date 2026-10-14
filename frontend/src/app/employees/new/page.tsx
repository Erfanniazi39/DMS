import { EmployeeForm } from "../_sections/EmployeeForm";

// /employees/new — add an employee (own page; it used to be a popup).
export default function NewEmployeePage() {
  return <EmployeeForm employeeId={null} />;
}
