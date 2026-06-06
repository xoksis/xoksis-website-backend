import crypto from "crypto";

const PASSWORD_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";

/** Cryptographically secure password for admin-created accounts. */
export function generateSecurePassword(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARS[bytes[i]! % PASSWORD_CHARS.length];
  }
  return password;
}

/** Random alphanumeric segment for referral codes / template keys. */
export function generateSecureAlphanumeric(length: number): string {
  return crypto.randomBytes(Math.ceil(length * 0.75))
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, length)
    .toUpperCase();
}
