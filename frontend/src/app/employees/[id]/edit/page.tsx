"use client";

import { useParams } from "next/navigation";
import { EmployeeForm } from "../../_sections/EmployeeForm";

// /employees/:id/edit — edit an employee (contracts and termination are
// managed on /employees/:id).
export default function EditEmployeePage() {
  const params = useParams<{ id: string }>();
  return <EmployeeForm employeeId={Number(params.id)} />;
}
