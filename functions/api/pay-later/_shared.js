import { ensureCommerceSchema, json } from "../paypal/_commerce.js";

const numberEnv = (env, key, fallback) => {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
};
const enabled = (value, fallback = false) => value == null ? fallback : String(value).toLowerCase() === "true";

export function payLaterConfig(env) {
  return {
    enabled: enabled(env.PAY_LATER_ENABLED),
    days: Math.max(1, numberEnv(env, "PAY_LATER_DAYS", 14)),
    maxOrderAmount: Math.min(74.99, Math.max(0, numberEnv(env, "PAY_LATER_MAX_ORDER_AMOUNT", 74.99))),
    maxOrderCents: 7499,
    country: String(env.PAY_LATER_COUNTRY || "NL").toUpperCase(),
    minAge: Math.max(18, numberEnv(env, "PAY_LATER_MIN_AGE", 18)),
    manualApproval: enabled(env.PAY_LATER_MANUAL_APPROVAL, true),
    registrationReady: Boolean(env.SCENT_CLUB_DB)
  };
}

export async function preparePayLater(env) {
  const config = payLaterConfig(env);
  if (!config.enabled || !config.registrationReady) return { config, error: json({ error: "Achteraf betalen is niet beschikbaar." }, 503) };
  await ensureCommerceSchema(env.SCENT_CLUB_DB);
  return { config, db: env.SCENT_CLUB_DB };
}

export const publicPayLaterConfig = (config) => ({
  enabled: config.enabled && config.registrationReady,
  days: config.days,
  maxOrderAmount: config.maxOrderAmount,
  maxOrderCents: config.maxOrderCents,
  country: config.country,
  minAge: config.minAge,
  manualApproval: config.manualApproval
});
