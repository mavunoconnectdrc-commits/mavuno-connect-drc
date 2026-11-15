import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payments, tokenLedger, webhookEvents, withdrawals, walletBalances } from '../db/schema.js';
import { appendDoubleEntry } from '../services/ledger.service.js';
import { sql } from 'drizzle-orm';

function validSignature(payload: unknown, signature: string | undefined) {
  const secret = process.env.SASPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/saspay', async (request, reply) => {
    if (!validSignature(request.body, request.headers['x-saspay-signature'] as string | undefined)) return reply.code(401).send({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    const body = request.body as Record<string, unknown>;
    const reference = String(body.id ?? body.transaction_id ?? body.reference ?? '');
    const eventId = String(body.event_id ?? body.id ?? body.reference ?? '');
    const status = String(body.status ?? '').toUpperCase();
    if (!reference || !eventId || !['SUCCESS', 'FAILED', 'PENDING'].includes(status)) return reply.code(400).send({ error: 'INVALID_WEBHOOK_PAYLOAD' });

    try {
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(webhookEvents).values({ provider: 'MPESA', eventId, payload: body }).onConflictDoNothing().returning();
        if (!inserted[0]) return;

        const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.providerReference, reference)).limit(1);
        if (withdrawal && status !== 'PENDING') {
          if (status === 'SUCCESS' && withdrawal.status !== 'SUCCESS') {
            await tx.update(withdrawals).set({ status: 'SUCCESS', updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
            await tx.update(walletBalances).set({ held: sql`${walletBalances.held} - ${withdrawal.amount}`, updatedAt: new Date() }).where(eq(walletBalances.userId, withdrawal.userId));
            await appendDoubleEntry(tx, { userId: withdrawal.userId, withdrawalId: withdrawal.id, amount: withdrawal.amount, currency: withdrawal.currency, debit: 'PAYOUT_SETTLEMENT', credit: 'PLATFORM_FLOAT', reason: 'B2C_SETTLED' });
          } else if (status === 'FAILED' && withdrawal.status !== 'FAILED') {
            await tx.update(withdrawals).set({ status: 'FAILED', failureCode: 'SASPAY_FAILED', updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
            await tx.update(walletBalances).set({ available: sql`${walletBalances.available} + ${withdrawal.amount}`, held: sql`${walletBalances.held} - ${withdrawal.amount}`, updatedAt: new Date() }).where(eq(walletBalances.userId, withdrawal.userId));
            await appendDoubleEntry(tx, { userId: withdrawal.userId, withdrawalId: withdrawal.id, amount: withdrawal.amount, currency: withdrawal.currency, debit: 'PAYOUT_SETTLEMENT', credit: 'USER_WALLET', reason: 'B2C_FAILED_RELEASE' });
          }
          return;
        }

        const [payment] = await tx.select().from(payments).where(eq(payments.providerReference, reference)).limit(1);
        if (payment && status === 'SUCCESS' && payment.status !== 'SUCCESS') {
          await tx.update(payments).set({ status: 'SUCCESS', updatedAt: new Date() }).where(eq(payments.id, payment.id));
          await appendDoubleEntry(tx, { userId: payment.userId, paymentId: payment.id, amount: payment.amount, currency: payment.currency, debit: 'PLATFORM_FLOAT', credit: 'USER_WALLET', reason: 'C2B_SETTLED' });
        } else if (payment && status === 'FAILED' && payment.status !== 'FAILED') {
          await tx.update(payments).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(payments.id, payment.id));
        }
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'WEBHOOK_PROCESSING_FAILED' });
    }
  });
}
