import { Resend } from "resend";

export const FROM = process.env.RESEND_FROM_EMAIL || "XOKSIS <noreply@xoksis.com>";

// The client is created lazily on first use: `new Resend(undefined)` throws,
// and this module loads at function boot, so an unset RESEND_API_KEY used to
// crash the entire deployment (FUNCTION_INVOCATION_FAILED) before any route
// could run. With no key, sends resolve as a soft error in the SDK's
// { data, error } shape — the API stays up and callers log and continue.
let client: Resend | null = null;

const notConfigured = () => ({
  data: null,
  error: {
    name: "RESEND_NOT_CONFIGURED",
    message: "RESEND_API_KEY is not set — email not sent",
  },
});

export const resend: Resend = new Proxy({} as Resend, {
  get(_target, prop) {
    if (!process.env.RESEND_API_KEY) {
      if (prop === "emails") return { send: async () => notConfigured() };
      return undefined;
    }
    client ??= new Resend(process.env.RESEND_API_KEY);
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});
