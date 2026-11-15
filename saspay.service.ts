import type { Provider } from '../db/schema.js';

const baseUrl = (process.env.SASPAY_BASE_URL ?? 'https://api.saspay.me').replace(/\/$/, '');
const apiKey = () => process.env.SASPAY_LIVE_API_KEY;
const country = () => process.env.SASPAY_COUNTRY ?? 'CD';
const currency = () => process.env.SASPAY_CURRENCY ?? 'CDF';

const methods: Record<Provider, string | undefined> = {
  ORANGE: process.env.SASPAY_ORANGE_METHOD,
  AIRTEL: process.env.SASPAY_AIRTEL_METHOD,
  MPESA: process.env.SASPAY_MPESA_METHOD,
};

export class SasPayError extends Error {
  constructor(public code: string, message: string, public statusCode = 502) { super(message); }
}

function headers(idempotencyKey?: string) {
  const key = apiKey();
  if (!key || !key.startsWith('sk_live_')) throw new SasPayError('SASPAY_LIVE_KEY_MISSING', 'Clé live SasPay absente ou invalide', 503);
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

async function post(path: string, body: unknown, idempotencyKey?: string) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(idempotencyKey), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new SasPayError(String(data.code ?? 'SASPAY_REQUEST_FAILED'), String(data.message ?? `SasPay HTTP ${response.status}`), response.status);
  return data;
}

export async function createC2BCheckout(input: { amount: string; description: string; idempotencyKey: string; customerEmail?: string; customerName?: string; returnUrl?: string }) {
  if (process.env.SASPAY_ENABLED !== 'true') {
    throw new SasPayError('SASPAY_DISABLED', 'SasPay est désactivé : aucun appel C2B ne sera envoyé', 503);
  }
  return post('/api/v1/checkout-sessions/', {
    amount: input.amount, currency: currency(), country: country(), description: input.description,
    customer_email: input.customerEmail ?? '', customer_name: input.customerName ?? '', return_url: input.returnUrl ?? '',
  }, undefined);
}

export async function createB2CPayout(input: { amount: string; phoneE164: string; operator: Provider; withdrawalId: string }) {
  if (process.env.SASPAY_ENABLED !== 'true') {
    throw new SasPayError('SASPAY_DISABLED', 'SasPay est désactivé : aucun appel B2C ne sera envoyé', 503);
  }
  if (process.env.SASPAY_IP_WHITELIST_CONFIRMED !== 'true') {
    throw new SasPayError('SASPAY_IP_NOT_WHITELISTED', 'La whitelist IP SasPay n’est pas confirmée', 503);
  }
  const method = methods[input.operator];
  if (!method) throw new SasPayError('SASPAY_METHOD_MISSING', `Code réseau SasPay manquant pour ${input.operator}`, 503);
  return post('/api/v1/payouts/initialize/', {
    amount: input.amount, currency: currency(), country: country(),
    customer: { phone: input.phoneE164 }, method,
    recipient: { msisdn: input.phoneE164 },
    description: `Mavuno-Connect-DRC Lite Server withdrawal ${input.withdrawalId}`,
  }, input.withdrawalId);
}

export async function verifyB2CPayout(providerReference: string) {
  const response = await fetch(`${baseUrl}/api/v1/payouts/${encodeURIComponent(providerReference)}/verify/`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new SasPayError(String(data.code ?? 'SASPAY_VERIFY_FAILED'), String(data.message ?? `SasPay HTTP ${response.status}`), response.status);
  return data;
}
