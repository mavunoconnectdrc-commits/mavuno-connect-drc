import type { Provider } from '../db/schema.js';

export type PayoutRequest = {
  withdrawalId: string;
  phoneE164: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
};

export type PayoutResult = {
  providerReference: string;
  raw?: unknown;
};

export interface MobileMoneyProvider {
  readonly provider: Provider;
  isConfigured(): boolean;
  initiatePayout(request: PayoutRequest & { operator: Provider }): Promise<PayoutResult>;
}
