import { z } from 'zod';
import { emptyToUndefined, optionalEmail, optionalTrimmedString } from '../../common/zod-fields';

// Employee code (کد پرسنلی) is NOT part of the CREATE schema — it is generated
// by EmployeesService.create() from the department's code plus the new
// employee's id. It CAN be changed afterwards (owner, 2026-10-14) through the
// update schema; it must stay unique (checked in EmployeesService.update()).

// First/last name (and father's name, which follows the same rule): Persian
// letters, spaces, and the "نیم‌فاصله" (ZWNJ) only — no Latin letters, no
// digits (Latin or Persian), no symbols.
const PERSIAN_NAME_REGEX = /^[آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإء‌ ]+$/;

const EDUCATION_LEVELS = ['under_diploma', 'diploma', 'associate', 'bachelor', 'master', 'phd'] as const;
const MARITAL_STATUSES = ['single', 'married'] as const;
const GENDERS = ['male', 'female'] as const;
const CONTRACT_TYPES = ['permanent', 'temporary', 'fixed_task'] as const;
const SALARY_PERIODS = ['monthly', 'weekly', 'daily'] as const;
const EXIT_TYPES = ['resigned', 'fired', 'contract_ended', 'retired', 'other'] as const;

// emptyToUndefined / optionalTrimmedString / optionalEmail come from
// common/zod-fields.ts: an empty string from the form means "not provided"
// for every optional field below, not a value to validate.

function optionalPersianName(label: string, maxLength = 80) {
  return z.preprocess(
    emptyToUndefined,
    z.string().trim().max(maxLength).regex(PERSIAN_NAME_REGEX, `${label} باید فقط شامل حروف فارسی باشد`).optional(),
  );
}

function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(emptyToUndefined, z.enum(values).optional());
}

function optionalNonNegativeInt(message: string) {
  return z.preprocess(emptyToUndefined, z.coerce.number().int().min(0, message).optional());
}

function optionalNonNegativeDecimal(message: string) {
  return z.preprocess(emptyToUndefined, z.coerce.number().min(0, message).optional());
}

// Deliberately LOOSE optional date (z.coerce.date(): anything Date-coercible
// passes, including a number). Not the same as common/zod-fields.ts's
// stricter optionalDate() — kept separate, and named differently, so
// Employee's existing validation doesn't change.
function optionalLooseDate() {
  return z.preprocess(emptyToUndefined, z.coerce.date().optional());
}

// Mobile phone (تلفن همراه): required, exactly 11 Latin digits — same
// format rule already used for User accounts.
const mobilePhone = z
  .string()
  .trim()
  .regex(/^[0-9]{11}$/, 'تلفن همراه باید دقیقاً ۱۱ رقم انگلیسی باشد');

// Landline phone (تلفن ثابت): optional, digits only.
const optionalLandlinePhone = z.preprocess(
  emptyToUndefined,
  z.string().trim().regex(/^[0-9]{6,11}$/, 'تلفن ثابت معتبر نیست').optional(),
);

const employeeFields = {
  firstName: z
    .string()
    .trim()
    .min(1, 'نام الزامی است')
    .max(80)
    .regex(PERSIAN_NAME_REGEX, 'نام باید فقط شامل حروف فارسی باشد'),
  lastName: z
    .string()
    .trim()
    .min(1, 'نام خانوادگی الزامی است')
    .max(80)
    .regex(PERSIAN_NAME_REGEX, 'نام خانوادگی باید فقط شامل حروف فارسی باشد'),
  departmentId: z.number().int().positive('واحد سازمانی را انتخاب کنید'),
  position: z.string().trim().max(120).optional(),
  // National ID (کد ملی) and birth date are required — the company asked
  // for both to be mandatory going forward.
  nationalId: z
    .string()
    .trim()
    .min(1, 'کد ملی الزامی است')
    .regex(/^[0-9]{10}$/, 'کد ملی باید دقیقاً ۱۰ رقم انگلیسی باشد'),
  mobilePhone,
  landlinePhone: optionalLandlinePhone,
  birthDate: z.coerce.date(),
  hireDate: z.coerce.date(),
  email: optionalEmail,
  note: optionalTrimmedString(1000),

  // --- اطلاعات هویتی و خانوادگی (identity & family, all optional) ---
  fatherName: optionalPersianName('نام پدر'),
  birthCertificateNumber: optionalTrimmedString(20),
  maritalStatus: optionalEnum(MARITAL_STATUSES),
  childrenCount: optionalNonNegativeInt('تعداد فرزندان باید عددی صحیح و غیرمنفی باشد'),
  gender: optionalEnum(GENDERS),

  // --- تحصیلات (education) ---
  educationLevel: optionalEnum(EDUCATION_LEVELS),
  // Only meaningful when educationLevel is "under_diploma" — enforced
  // together with educationLevel below, not as an independent field rule.
  belowDiplomaGrade: optionalTrimmedString(50),
  fieldOfStudy: optionalTrimmedString(100),

  // --- اطلاعات استخدام و قرارداد (employment & contract) ---
  workLocation: optionalTrimmedString(200),
  workingHours: optionalTrimmedString(100),
  // Paired with salaryPeriod below — enforced together, not independently.
  salaryAmount: optionalNonNegativeDecimal('مبلغ حقوق باید عددی غیرمنفی باشد'),
  salaryPeriod: optionalEnum(SALARY_PERIODS),
  // Free text — plain account number, card number, or Sheba/IBAN.
  bankAccountNumber: optionalTrimmedString(34),

  // --- اطلاعات تماس و سایر (contact & other) ---
  address: optionalTrimmedString(500),
};

// Cross-field rules that can't be expressed on a single field in isolation.
// Applied to both create and update so the same rules hold either way.
function withCrossFieldRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) => {
    const record = data as Record<string, unknown>;
    if (record.educationLevel === 'under_diploma' && !record.belowDiplomaGrade) {
      ctx.addIssue({
        code: 'custom',
        path: ['belowDiplomaGrade'],
        message: 'در صورت انتخاب «زیر دیپلم»، مقطع تحصیلی (تا چه کلاسی) را مشخص کنید',
      });
    }
    // "حقوق" is really one field (amount + period) split into two columns —
    // an amount without knowing ماهانه/هفتگی/روزانه isn't meaningful data.
    if (record.salaryAmount !== undefined && !record.salaryPeriod) {
      ctx.addIssue({
        code: 'custom',
        path: ['salaryPeriod'],
        message: 'دوره پرداخت حقوق (ماهانه، هفتگی یا روزانه) را مشخص کنید',
      });
    }
  });
}

// Education follow-ups (owner, 2026-10-14): «تا چه کلاسی» (belowDiplomaGrade)
// belongs only to under_diploma and is required there; the field of study
// (رشته) only applies from associate up — under-diploma and diploma have none.
// The irrelevant one is cleared (null, so an update really erases an old value).
const FIELD_OF_STUDY_LEVELS = ['associate', 'bachelor', 'master', 'phd'];
function normalizeEducation<T extends { educationLevel?: string; belowDiplomaGrade?: string; fieldOfStudy?: string }>(data: T) {
  return {
    ...data,
    belowDiplomaGrade: data.educationLevel === 'under_diploma' ? (data.belowDiplomaGrade ?? null) : null,
    fieldOfStudy: data.educationLevel && FIELD_OF_STUDY_LEVELS.includes(data.educationLevel) ? (data.fieldOfStudy ?? null) : null,
  };
}

// The FIRST contract can be entered together with the employee; every later
// one (extension) goes through the contract endpoints. Not part of update.
const initialContractFields = {
  contractType: optionalEnum(CONTRACT_TYPES),
  contractStartDate: optionalLooseDate(),
  contractEndDate: optionalLooseDate(),
};

export const createEmployeeSchema = withCrossFieldRules(z.object({ ...employeeFields, ...initialContractFields }))
  .superRefine((data, ctx) => {
    if (data.contractType && !data.contractStartDate) ctx.addIssue({ code: 'custom', path: ['contractStartDate'], message: 'تاریخ شروع قرارداد را وارد کنید' });
    if (data.contractType && data.contractType !== 'permanent' && !data.contractEndDate) ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'برای قرارداد موقت یا کار معین، تاریخ پایان را وارد کنید' });
    if (data.contractStartDate && data.contractEndDate && data.contractEndDate.getTime() < data.contractStartDate.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد' });
    }
  })
  .transform(normalizeEducation);
// status: «پایان همکاری» is never set from this form — EmployeesService.update()
// refuses a change to/from `terminated` (use terminate()/reactivate(), which
// require a reason / clear it).
export const updateEmployeeSchema = withCrossFieldRules(
  z.object(employeeFields).extend({
    status: z.enum(['active', 'on_leave', 'terminated']),
    // Latin letters, digits, dash and underscore only (e.g. IT-0007).
    code: z
      .string({ error: 'کد پرسنلی الزامی است' })
      .trim()
      .min(2, 'کد پرسنلی حداقل ۲ نویسه است')
      .max(30, 'کد پرسنلی حداکثر ۳۰ نویسه است')
      .regex(/^[A-Za-z0-9_-]+$/, 'کد پرسنلی فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره و زیرخط باشد'),
  }),
).transform(normalizeEducation);
export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;

// --- Contracts (history; an extension is just another contract) ---------------
const contractBase = z.object({
  contractType: z.enum(CONTRACT_TYPES, { error: 'نوع قرارداد را انتخاب کنید' }),
  startDate: z.coerce.date({ error: 'تاریخ شروع قرارداد معتبر نیست' }),
  endDate: optionalLooseDate(),
  note: optionalTrimmedString(500),
});
function contractRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .superRefine((data, ctx) => {
      const record = data as { contractType: string; startDate: Date; endDate?: Date };
      if (record.contractType !== 'permanent' && !record.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'برای قرارداد موقت یا کار معین، تاریخ پایان را وارد کنید' });
      if (record.endDate && record.endDate.getTime() < record.startDate.getTime()) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد' });
    })
    // A permanent contract has no end date.
    .transform((data) => ({ ...(data as object), endDate: (data as { contractType: string }).contractType === 'permanent' ? null : ((data as { endDate?: Date }).endDate ?? null) }) as unknown as z.infer<T> & { endDate: Date | null });
}
export const createEmployeeContractSchema = contractRules(contractBase);
export const updateEmployeeContractSchema = contractRules(contractBase);
export type EmployeeContractDto = z.infer<typeof contractBase> & { endDate: Date | null };

// --- Termination (پایان همکاری): type + a written reason are both required ---
export const terminateEmployeeSchema = z.object({
  terminationDate: z.coerce.date({ error: 'تاریخ پایان همکاری معتبر نیست' }),
  terminationType: z.enum(EXIT_TYPES, { error: 'نوع پایان همکاری را انتخاب کنید' }),
  terminationReason: z.string({ error: 'علت پایان همکاری الزامی است' }).trim().min(3, 'علت پایان همکاری را بنویسید').max(1000),
});
export type TerminateEmployeeDto = z.infer<typeof terminateEmployeeSchema>;
