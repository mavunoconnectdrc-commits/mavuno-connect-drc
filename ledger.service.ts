import type { PgTransaction } from 'drizzle-orm/pg-core';
import { tokenLedger } from '../db/schema.js';

export type LedgerTx = PgTransaction<any, any, any>;

export async function appendDoubleEntry(tx: LedgerTx, input: {
  userId?: string | null; withdrawalId?: string; paymentId?: string; amount: string; currency: string;
  debit: 'USER_WALLET' | 'PLATFORM_FLOAT' | 'PAYOUT_SETTLEMENT';
  credit: 'USER_WALLET' | 'PLATFORM_FLOAT' | 'PAYOUT_SETTLEMENT';
  counterpartyUserId?: string | null; reason: string;
}) {
  if (input.debit === input.credit) throw new Error('DOUBLE_ENTRY_ACCOUNTS_MUST_DIFFER');
  const common = { userId: input.userId ?? null, withdrawalId: input.withdrawalId, paymentId: input.paymentId, amount: input.amount, currency: input.currency, counterpartyUserId: input.counterpartyUserId ?? null, reason: input.reason };
  await tx.insert(tokenLedger).values([
    { ...common, entryType: 'DEBIT', account: input.debit },
    { ...common, entryType: 'CREDIT', account: input.credit },
  ]);
}
