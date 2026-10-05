import { formatJalali } from "@/lib/jalali";
import {
  contractTypeLabels,
  educationLevelLabels,
  genderLabels,
  maritalStatusLabels,
  salaryPeriodLabels,
  type Employee,
} from "./shared";

// The expanded «جزئیات» row under an employee in the list (read-only).
// `colSpan` matches the list table's column count, which depends on
// whether the «عملیات» column is shown.
export function EmployeeDetailRow({ employee, colSpan }: { employee: Employee; colSpan: number }) {
  return (
    <tr className="bg-muted/20">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات هویتی و خانوادگی</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">جنسیت</p>
                <p className="text-sm">{employee.gender ? genderLabels[employee.gender] : "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">نام پدر</p>
                <p className="text-sm">{employee.fatherName || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">کد ملی</p>
                <p className="text-sm">{employee.nationalId || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شماره شناسنامه</p>
                <p className="text-sm">{employee.birthCertificateNumber || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تاریخ تولد</p>
                <p className="text-sm">{formatJalali(employee.birthDate) || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">وضعیت تأهل</p>
                <p className="text-sm">
                  {employee.maritalStatus ? maritalStatusLabels[employee.maritalStatus] : "وارد نشده"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تعداد فرزند</p>
                <p className="text-sm">{employee.childrenCount ?? "وارد نشده"}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">تحصیلات</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">تحصیلات</p>
                <p className="text-sm">
                  {employee.educationLevel
                    ? `${educationLevelLabels[employee.educationLevel]}${
                        employee.educationLevel === "under_diploma" && employee.belowDiplomaGrade
                          ? ` (${employee.belowDiplomaGrade})`
                          : ""
                      }`
                    : "وارد نشده"}
                </p>
              </div>
              {employee.educationLevel ? (
                <div>
                  <p className="text-xs text-muted-foreground">رشته</p>
                  <p className="text-sm">{employee.fieldOfStudy || "وارد نشده"}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات استخدام و قرارداد</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">محل انجام کار</p>
                <p className="text-sm">{employee.workLocation || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ساعات کار</p>
                <p className="text-sm">{employee.workingHours || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">نوع قرارداد</p>
                <p className="text-sm">
                  {employee.contractType ? contractTypeLabels[employee.contractType] : "وارد نشده"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مدت قرارداد</p>
                <p className="text-sm">
                  {employee.contractStartDate || employee.contractEndDate
                    ? `${formatJalali(employee.contractStartDate) || "؟"} تا ${formatJalali(employee.contractEndDate) || "؟"}`
                    : "وارد نشده"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">حقوق</p>
                <p className="text-sm">
                  {employee.salaryAmount
                    ? `${Number(employee.salaryAmount).toLocaleString("fa-IR")} تومان${
                        employee.salaryPeriod ? ` (${salaryPeriodLabels[employee.salaryPeriod]})` : ""
                      }`
                    : "وارد نشده"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شماره حساب بانکی</p>
                <p className="text-sm">{employee.bankAccountNumber || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">فایل قرارداد</p>
                <p className="text-sm">
                  {employee.contractDocumentPath ? (
                    <a
                      href={`/api${employee.contractDocumentPath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      مشاهده فایل
                    </a>
                  ) : (
                    "وارد نشده"
                  )}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات تماس و سایر</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">تلفن همراه</p>
                <p className="text-sm">{employee.mobilePhone || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تلفن ثابت</p>
                <p className="text-sm">{employee.landlinePhone || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ایمیل</p>
                <p className="text-sm">{employee.email || "وارد نشده"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تاریخ استخدام</p>
                <p className="text-sm">{formatJalali(employee.hireDate) || "وارد نشده"}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-muted-foreground">آدرس</p>
                <p className="text-sm">{employee.address || "وارد نشده"}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-muted-foreground">یادداشت</p>
                <p className="text-sm">{employee.note || "بدون یادداشت"}</p>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
