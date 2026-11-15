import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { createC2BCheckout, SasPayError } from '../services/saspay.service.js';

const schema = z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/), description: z.string().min(1).max(255), customerEmail: z.string().email().optional(), customerName: z.string().max(120).optional(), returnUrl: z.string().url().optional() });

export async function paymentRoutes(app: FastifyInstance) {
  app.post('/api/payments/c2b/checkout', async (request, reply) => {
    const userId = request.headers['x-user-id'];
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof userId !== 'string' || !userId) return reply.code(401).send({ error: 'AUTH_REQUIRED' });
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });

    const existing = await db.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.idempotencyKey, idempotencyKey))).limit(1);
    if (existing[0]) return reply.code(200).send({ payment: existing[0] });
    const [payment] = await db.insert(payments).values({ userId, amount: parsed.data.amount, currency: process.env.SASPAY_CURRENCY ?? 'CDF', idempotencyKey, metadata: { flow: 'C2B' } }).returning();
    if (!payment) return reply.code(500).send({ error: 'PAYMENT_CREATE_FAILED' });

    try {
      const result = await createC2BCheckout({ amount: parsed.data.amount, description: parsed.data.description, idempotencyKey, customerEmail: parsed.data.customerEmail, customerName: parsed.data.customerName, returnUrl: parsed.data.returnUrl });
      const updated = await db.update(payments).set({ providerReference: String(result.id ?? ''), checkoutUrl: typeof result.checkout_url === 'string' ? result.checkout_url : null, updatedAt: new Date() }).where(eq(payments.id, payment.id)).returning();
      return reply.code(201).send({ payment: updated[0] });
    } catch (error) {
      await db.update(payments).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(payments.id, payment.id));
      const e = error instanceof SasPayError ? error : new Error('SASPAY_C2B_FAILED');
      return reply.code(e instanceof SasPayError ? e.statusCode : 502).send({ error: e instanceof SasPayError ? e.code : 'SASPAY_C2B_FAILED', message: e.message });
    }
  });
}
