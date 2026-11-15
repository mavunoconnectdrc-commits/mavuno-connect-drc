import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { walletBalances, withdrawals } from '../db/schema.js';
import { sasPayProvider } from '../providers/adapters.js';
import type { Provider } from '../db/schema.js';
import { appendDoubleEntry } from './ledger.service.js';

export class WithdrawalError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) { super(message); }
}

const CURRENCY = process.env.CURRENCY ?? 'CDF';
const MAX_WITHDRAWAL = process.env.MAX_WITHDRAWAL_CDF ?? '1000000';

export async function createWithdrawal(input: {
  userId: string; provider: Provider; phoneE164: string; amount: string; currency?: string; idempotencyKey: string;
}) {
  if (input.currency && input.currency !== CURRENCY) throw new WithdrawalError('CURRENCY_NOT_SUPPORTED', `Devise attendue: ${CURRENCY}`);
  if (!/^\+243\d{9}$/.test(input.phoneE164)) throw new WithdrawalError('INVALID_PHONE', 'Le numéro doit être au format E.164 RDC (+243XXXXXXXXX)');
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) throw new WithdrawalError('INVALID_AMOUNT', 'Montant invalide');
  if (Number(input.amount) > Number(MAX_WITHDRAWAL)) throw new WithdrawalError('LIMIT_EXCEEDED', 'Le montant dépasse la limite par retrait');

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(withdrawals).where(and(
      eq(withdrawals.userId, input.userId), eq(withdrawals.clientIdempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (existing[0]) return existing[0];

    const reserved = await tx.update(walletBalances)
      .set({
        available: sql`${walletBalances.available} - ${input.amount}`,
        held: sql`${walletBalances.held} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(and(eq(walletBalances.userId, input.userId), sql`${walletBalances.available} >= ${input.amount}`))
      .returning();
    if (!reserved[0]) throw new WithdrawalError('INSUFFICIENT_FUNDS', 'Solde disponible insuffisant');

    const [withdrawal] = await tx.insert(withdrawals).values({
      userId: input.userId, provider: input.provider, phoneE164: input.phoneE164,
      amount: input.amount, currency: CURRENCY, clientIdempotencyKey: input.idempotencyKey,
      status: 'PENDING',
    }).returning();
    if (!withdrawal) throw new WithdrawalError('CREATE_FAILED', 'Impossible de créer le retrait', 500);

    await appendDoubleEntry(tx, {
      userId: input.userId, withdrawalId: withdrawal.id, amount: input.amount, currency: CURRENCY,
      debit: 'USER_WALLET', credit: 'PAYOUT_SETTLEMENT', reason: 'WITHDRAWAL_HOLD',
    });
    return withdrawal;
  });
}

export async function dispatchWithdrawal(withdrawalId: string) {
  const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).limit(1);
  if (!withdrawal) throw new WithdrawalError('NOT_FOUND', 'Retrait introuvable', 404);
  if (withdrawal.status !== 'PENDING') return withdrawal;

  const provider = sasPayProvider;
  let result;
  try {
    result = await provider.initiatePayout({
      withdrawalId: withdrawal.id, phoneE164: withdrawal.phoneE164,
      amount: withdrawal.amount, currency: withdrawal.currency,
      idempotencyKey: withdrawal.id,
      operator: withdrawal.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider error';
    await db.update(withdrawals).set({ status: 'FAILED', failureCode: 'PROVIDER_NOT_READY', failureMessage: message, updatedAt: new Date() }).where(eq(withdrawals.id, withdrawalId));
    await releaseHold(withdrawal);
    throw new WithdrawalError('PROVIDER_NOT_READY', message, 503);
  }

  const [updated] = await db.update(withdrawals).set({ status: 'PROCESSING', providerReference: result.providerReference, updatedAt: new Date() }).where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.status, 'PENDING'))).returning();
  return updated ?? withdrawal;
}

export async function releaseHold(withdrawal: typeof withdrawals.$inferSelect) {
  await db.transaction(async (tx) => {
    await tx.update(walletBalances).set({
      available: sql`${walletBalances.available} + ${withdrawal.amount}`,
      held: sql`${walletBalances.held} - ${withdrawal.amount}`,
      updatedAt: new Date(),
    }).where(eq(walletBalances.userId, withdrawal.userId));
    await appendDoubleEntry(tx, {
      userId: withdrawal.userId, withdrawalId: withdrawal.id, amount: withdrawal.amount, currency: withdrawal.currency,
      debit: 'PAYOUT_SETTLEMENT', credit: 'USER_WALLET', reason: 'WITHDRAWAL_RELEASE',
    });
  });
}
