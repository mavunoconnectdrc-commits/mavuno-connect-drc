import type { Provider } from '../db/schema.js';
import type { MobileMoneyProvider, PayoutRequest, PayoutResult } from './types.js';
import { createB2CPayout } from '../services/saspay.service.js';

export class SasPayProvider implements MobileMoneyProvider {
  readonly provider = 'MPESA' as const;
  isConfigured() { return Boolean(process.env.SASPAY_LIVE_API_KEY); }
  async initiatePayout(request: PayoutRequest & { operator: Provider }): Promise<PayoutResult> {
    const result = await createB2CPayout({ amount: request.amount, phoneE164: request.phoneE164, operator: request.operator, withdrawalId: request.withdrawalId });
    return { providerReference: String(result.id ?? ''), raw: result };
  }
}
export const sasPayProvider = new SasPayProvider();
