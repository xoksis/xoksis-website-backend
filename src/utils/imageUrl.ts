const ALLOWED_IMAGE_HOST_SUFFIXES = [
  "res.cloudinary.com",
  "images.unsplash.com",
];

export function validateImageUrl(
  value: unknown,
  label = "Image URL",
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be a string.` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${label} is required.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `${label} must be a valid URL.` };
  }

  if (parsed.protocol.toLowerCase() !== "https:") {
    return { ok: false, error: `${label} must use HTTPS.` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: `${label} must not include credentials.` };
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!allowed) {
    return {
      ok: false,
      error: `${label} must be hosted on Cloudinary or Unsplash.`,
    };
  }

  return { ok: true, url: trimmed };
}

export function validateOptionalImageUrl(
  value: unknown,
  label = "Image URL",
): { ok: true; url: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, url: undefined };
  }
  const result = validateImageUrl(value, label);
  if (!result.ok) return result;
  return { ok: true, url: result.url };
}

export function validateImageUrlList(
  values: unknown[],
  label = "Image URL",
): { ok: true; urls: string[] } | { ok: false; error: string } {
  const urls: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const item = values[i];
    if (typeof item !== "string") {
      return { ok: false, error: `${label} entries must be strings.` };
    }
    const result = validateImageUrl(item, `${label} #${i + 1}`);
    if (!result.ok) return result;
    urls.push(result.url);
  }
  return { ok: true, urls };
}

/** Trust Cloudinary upload paths; validate admin-supplied URL strings. */
export function resolveImageField(
  uploadedPath: string | undefined,
  bodyUrl: unknown,
  label: string,
  options?: { required?: boolean; fallback?: string },
): { ok: true; url: string } | { ok: false; error: string } {
  if (uploadedPath) {
    return { ok: true, url: uploadedPath };
  }

  if (bodyUrl !== undefined && bodyUrl !== null && bodyUrl !== "") {
    const validated = validateImageUrl(bodyUrl, label);
    if (!validated.ok) return validated;
    return { ok: true, url: validated.url };
  }

  if (options?.fallback) {
    return { ok: true, url: options.fallback };
  }

  if (options?.required) {
    return { ok: false, error: `${label} is required.` };
  }

  return { ok: false, error: `${label} is required.` };
}
