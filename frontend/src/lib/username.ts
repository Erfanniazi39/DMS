// Usernames are Latin only (letters, digits, . _ -), starting with a letter —
// mirrors backend users/dto/username.ts. The input filter drops anything else
// as it is typed (Persian/Russian/etc.); the server re-validates.
export const USERNAME_HINT = "فقط حروف انگلیسی، عدد و . _ - (با حرف انگلیسی شروع شود)";

export function sanitizeUsername(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "");
}

export function isValidUsername(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]{2,49}$/.test(value);
}
