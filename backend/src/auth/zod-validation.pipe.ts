// Moved to common/zod-validation.pipe.ts — it is shared by every module and
// has nothing to do with auth. This re-export keeps existing imports working;
// new code should import from '../common/zod-validation.pipe'.
export { ZodValidationPipe } from '../common/zod-validation.pipe';
