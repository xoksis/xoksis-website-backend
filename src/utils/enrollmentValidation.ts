const FEE_TIERS = ["free", "standard"] as const;
const FEE_STATUSES = ["unpaid", "partial", "paid"] as const;
const ACCESS_STATUSES = ["active", "revoked"] as const;
const APPLICATION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type EnrollmentFieldErrors = Record<string, string>;

export function validateEnrollmentEnums(body: {
  feeTier?: unknown;
  feeStatus?: unknown;
  accessStatus?: unknown;
  applicationStatus?: unknown;
  fee?: unknown;
}): { ok: true } | { ok: false; message: string } {
  const { feeTier, feeStatus, accessStatus, applicationStatus, fee } = body;

  if (feeTier !== undefined && !FEE_TIERS.includes(feeTier as (typeof FEE_TIERS)[number])) {
    return { ok: false, message: "Invalid feeTier. Must be free or standard." };
  }
  if (feeStatus !== undefined && !FEE_STATUSES.includes(feeStatus as (typeof FEE_STATUSES)[number])) {
    return { ok: false, message: "Invalid feeStatus. Must be unpaid, partial, or paid." };
  }
  if (accessStatus !== undefined && !ACCESS_STATUSES.includes(accessStatus as (typeof ACCESS_STATUSES)[number])) {
    return { ok: false, message: "Invalid accessStatus. Must be active or revoked." };
  }
  if (
    applicationStatus !== undefined &&
    !APPLICATION_STATUSES.includes(applicationStatus as (typeof APPLICATION_STATUSES)[number])
  ) {
    return { ok: false, message: "Invalid applicationStatus. Must be PENDING, APPROVED, or REJECTED." };
  }
  if (fee !== undefined && (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0)) {
    return { ok: false, message: "Invalid fee. Must be a non-negative number." };
  }

  return { ok: true };
}
