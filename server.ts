import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { pool } from './db/client.js';
import { withdrawalRoutes } from './routes/withdrawals.js';
import { paymentRoutes } from './routes/payment.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
await app.register(helmet);
await app.register(cors, { origin: false });

app.get('/health', async () => ({ ok: true, service: 'Mavuno-Connect-DRC Lite Server', gateway: 'SasPay' }));
app.get('/ready', async (_request, reply) => {
  try {
    await pool.query('select 1');
    return { ok: true, database: 'ready' };
  } catch (error) {
    app.log.error(error, 'database readiness failed');
    return reply.code(503).send({ ok: false, database: 'unavailable' });
  }
});

await app.register(withdrawalRoutes);
await app.register(paymentRoutes);
await app.register(webhookRoutes);

app.addHook('onClose', async () => { await pool.end(); });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
