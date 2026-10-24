import { LICENSE_WARN_DAYS, type EditionStatus } from "../enterprise.ts";

export function editionForSettings(status: EditionStatus) {
  const expiring = status.edition === "enterprise" && status.expiresAt && status.expiresInDays !== undefined &&
    (status.graceEndsAt !== undefined || status.expiresInDays <= LICENSE_WARN_DAYS);
  return {
    edition: status.edition,
    features: status.features,
    ...(expiring ? { license: { expiresAt: status.expiresAt!, expiresInDays: status.expiresInDays!, ...(status.graceEndsAt ? { graceEndsAt: status.graceEndsAt } : {}) } } : {}),
  };
}

