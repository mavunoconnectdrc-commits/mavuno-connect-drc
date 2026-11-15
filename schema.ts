import {
  pgEnum, pgTable, text, numeric, timestamp, uuid, jsonb,
  uniqueIndex, index,
} from 'drizzle-orm/pg-core';

export const providerEnum = pgEnum('mobile_money_provider', ['ORANGE', 'AIRTEL', 'MPESA']);
export const withdrawalStatusEnum = pgEnum('withdrawal_status', ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'SUCCESS', 'FAILED']);
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', ['DEBIT', 'CREDIT']);
export const ledgerAccountEnum = pgEnum('ledger_account', ['USER_WALLET', 'PLATFORM_FLOAT', 'PAYOUT_SETTLEMENT']);

export const walletBalances = pgTable('wallet_balances', {
  userId: text('user_id').primaryKey(),
  available: numeric('available', { precision: 18, scale: 2 }).notNull().default('0'),
  held: numeric('held', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('CDF'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const withdrawals = pgTable('withdrawals', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  provider: providerEnum('provider').notNull(),
  phoneE164: text('phone_e164').notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  fee: numeric('fee', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('CDF'),
  status: withdrawalStatusEnum('status').notNull().default('PENDING'),
  clientIdempotencyKey: text('client_idempotency_key').notNull(),
  providerReference: text('provider_reference'),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('withdrawals_user_idempotency').on(table.userId, table.clientIdempotencyKey),
  uniqueIndex('withdrawals_provider_reference').on(table.providerReference),
  index('withdrawals_user_status_created').on(table.userId, table.status, table.createdAt),
]);

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('CDF'),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  providerReference: text('provider_reference'),
  checkoutUrl: text('checkout_url'),
  idempotencyKey: text('idempotency_key').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payments_user_idempotency').on(table.userId, table.idempotencyKey),
  uniqueIndex('payments_provider_reference').on(table.providerReference),
]);

// Chaque événement métier écrit au minimum deux lignes de même montant :
// un DEBIT et un CREDIT sur deux comptes distincts.
export const tokenLedger = pgTable('token_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id'),
  withdrawalId: uuid('withdrawal_id').references(() => withdrawals.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('CDF'),
  entryType: ledgerEntryTypeEnum('entry_type').notNull(),
  account: ledgerAccountEnum('account').notNull(),
  counterpartyUserId: text('counterparty_user_id'),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('token_ledger_user_created').on(table.userId, table.createdAt),
  index('token_ledger_withdrawal').on(table.withdrawalId),
  index('token_ledger_payment').on(table.paymentId),
]);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: providerEnum('provider').notNull(),
  eventId: text('event_id').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('webhook_provider_event').on(table.provider, table.eventId)]);

export type Provider = 'ORANGE' | 'AIRTEL' | 'MPESA';
export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
