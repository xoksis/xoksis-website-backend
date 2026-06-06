/** When true (default), new enrollments are immediately approved with active access. */
export function isAutoApproveEnrollments(): boolean {
  return process.env.AUTO_APPROVE_ENROLLMENTS !== "false";
}

export function getInitialEnrollmentStatus() {
  if (isAutoApproveEnrollments()) {
    return {
      applicationStatus: "APPROVED" as const,
      accessStatus: "active" as const,
    };
  }
  return {
    applicationStatus: "PENDING" as const,
    accessStatus: "revoked" as const,
  };
}
