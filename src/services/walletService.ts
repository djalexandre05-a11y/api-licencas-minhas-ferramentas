import { db } from '../database.js';
import crypto from 'node:crypto';

export interface Wallet {
  id: string;
  reseller_id: string;
  name: string;
  email: string;
  balance_cents: number;
  total_credited_cents: number;
  total_debited_cents: number;
  total_licenses_generated: number;
  status: 'active' | 'blocked' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  type: 'credit' | 'debit' | 'adjustment' | 'refund';
  amount_cents: number;
  balance_before_cents: number;
  balance_after_cents: number;
  description: string;
  reference_id?: string;
  idempotency_key?: string;
  created_by: string;
  created_at: string;
}

export class InsufficientBalanceError extends Error {
  public code = 'INSUFFICIENT_BALANCE';
  public required_amount: number;
  public current_balance: number;
  public currency = 'BRL';

  constructor(requiredCents: number, currentCents: number) {
    super('Saldo insuficiente para gerar a licença.');
    this.required_amount = requiredCents / 100;
    this.current_balance = currentCents / 100;
  }
}

export class WalletBlockedError extends Error {
  public code = 'WALLET_BLOCKED';
  constructor() {
    super('A carteira deste revendedor está bloqueada para novas emissões.');
  }
}

export class WalletService {
  /**
   * Preço padrão em centavos (R$ 15,00 = 1500 centavos)
   */
  public static readonly DEFAULT_PRICE_CENTS = 1500;

  /**
   * Consulta o preço vigente de emissão para determinado produto/revendedor
   */
  static getPricing(extensionId?: string, walletId?: string): { price_cents: number; price_brl: number } {
    let priceCents = this.DEFAULT_PRICE_CENTS;

    try {
      // 1. Procura preço específico para o revendedor e extensão
      if (extensionId && walletId) {
        const row = db.prepare(`
          SELECT price_cents FROM license_pricing 
          WHERE extension_id = ? AND wallet_id = ? AND is_active = 1
        `).get(extensionId, walletId) as any;
        if (row) priceCents = row.price_cents;
      }

      // 2. Procura preço específico para a extensão
      if (priceCents === this.DEFAULT_PRICE_CENTS && extensionId) {
        const row = db.prepare(`
          SELECT price_cents FROM license_pricing 
          WHERE extension_id = ? AND wallet_id IS NULL AND is_active = 1
        `).get(extensionId) as any;
        if (row) priceCents = row.price_cents;
      }

      // 3. Procura preço padrão global
      if (priceCents === this.DEFAULT_PRICE_CENTS) {
        const row = db.prepare(`
          SELECT price_cents FROM license_pricing 
          WHERE extension_id IS NULL AND wallet_id IS NULL AND is_active = 1
        `).get() as any;
        if (row) priceCents = row.price_cents;
      }
    } catch (_) {}

    return {
      price_cents: priceCents,
      price_brl: priceCents / 100,
    };
  }

  /**
   * Busca carteira por ID ou cria se não existir para o revendedor
   */
  static getWallet(idOrResellerId: string): Wallet | null {
    const row = db.prepare(`
      SELECT * FROM reseller_wallets WHERE id = ? OR reseller_id = ? OR email = ?
    `).get(idOrResellerId, idOrResellerId, idOrResellerId) as any;

    return row || null;
  }

  /**
   * Busca ou inicializa automaticamente a carteira associada a uma API Key
   */
  static getOrCreateWalletForApiKey(apiKeyObj: any): Wallet {
    if (apiKeyObj.wallet_id) {
      const existing = this.getWallet(apiKeyObj.wallet_id);
      if (existing) return existing;
    }

    // Busca por email ou nome do cliente da chave
    const clientEmail = apiKeyObj.client_email || `${apiKeyObj.client_name.toLowerCase().replace(/\s+/g, '')}@revendedor.com`;
    let wallet = this.getWallet(clientEmail);

    if (!wallet) {
      const walletId = `wal_${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();
      const resellerId = apiKeyObj.client_id || `res_${crypto.randomUUID().slice(0, 8)}`;

      db.prepare(`
        INSERT INTO reseller_wallets (
          id, reseller_id, name, email, balance_cents, total_credited_cents,
          total_debited_cents, total_licenses_generated, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'active', ?, ?)
      `).run(walletId, resellerId, apiKeyObj.client_name, clientEmail, now, now);

      wallet = this.getWallet(walletId)!;
    }

    // Vincula a chave à carteira
    try {
      db.prepare('UPDATE api_keys SET wallet_id = ? WHERE id = ?').run(wallet.id, apiKeyObj.id);
    } catch (_) {}

    return wallet;
  }

  /**
   * Operação Transacional Atômica: Debita o valor da licença da carteira
   * Protege contra saldo negativo, bloqueia carteiras inativas e suporta idempotência
   */
  static debitForLicense(params: {
    walletId: string;
    extensionId: string;
    licenseId: string;
    idempotencyKey?: string;
    createdBy?: string;
  }): {
    charged_cents: number;
    amount_charged: number;
    balance_after: number;
    transaction_id: string;
  } {
    const { walletId, extensionId, licenseId, idempotencyKey, createdBy = 'system' } = params;

    // 1. Verificação de idempotência (se já cobrou esta mesma requisição, retorna a transação gravada)
    if (idempotencyKey) {
      const existingTx = db.prepare(`
        SELECT * FROM wallet_transactions WHERE idempotency_key = ?
      `).get(idempotencyKey) as any;

      if (existingTx) {
        return {
          charged_cents: existingTx.amount_cents,
          amount_charged: existingTx.amount_cents / 100,
          balance_after: existingTx.balance_after_cents / 100,
          transaction_id: existingTx.id,
        };
      }
    }

    const pricing = this.getPricing(extensionId, walletId);
    const costCents = pricing.price_cents;

    // 2. Consulta a carteira
    const wallet = db.prepare('SELECT * FROM reseller_wallets WHERE id = ?').get(walletId) as any;
    if (!wallet) {
      throw new Error('Carteira não encontrada.');
    }

    if (wallet.status !== 'active') {
      throw new WalletBlockedError();
    }

    // 3. Validação estrita de saldo
    if (wallet.balance_cents < costCents) {
      throw new InsufficientBalanceError(costCents, wallet.balance_cents);
    }

    const txId = `tx_${crypto.randomUUID()}`;
    const chgId = `chg_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const balanceBefore = wallet.balance_cents;
    const balanceAfter = balanceBefore - costCents;

    // 4. Execução Transacional Atômica (SQLite)
    db.exec('BEGIN TRANSACTION;');
    try {
      // Debita da carteira
      db.prepare(`
        UPDATE reseller_wallets 
        SET balance_cents = ?,
            total_debited_cents = total_debited_cents + ?,
            total_licenses_generated = total_licenses_generated + 1,
            updated_at = ?
        WHERE id = ? AND balance_cents >= ?
      `).run(balanceAfter, costCents, now, walletId, costCents);

      // Registra no extrato financeiro da carteira
      db.prepare(`
        INSERT INTO wallet_transactions (
          id, wallet_id, type, amount_cents, balance_before_cents, balance_after_cents,
          description, reference_id, idempotency_key, created_by, created_at
        ) VALUES (?, ?, 'debit', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        walletId,
        costCents,
        balanceBefore,
        balanceAfter,
        `Emissão de licença ${extensionId.toUpperCase()} (R$ ${(costCents / 100).toFixed(2)})`,
        licenseId,
        idempotencyKey || null,
        createdBy,
        now
      );

      // Registra a cobrança vinculada à licença
      db.prepare(`
        INSERT INTO license_charges (
          id, license_id, wallet_id, transaction_id, amount_cents, currency, created_at
        ) VALUES (?, ?, ?, ?, ?, 'BRL', ?)
      `).run(chgId, licenseId, walletId, txId, costCents, now);

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return {
      charged_cents: costCents,
      amount_charged: costCents / 100,
      balance_after: balanceAfter / 100,
      transaction_id: txId,
    };
  }

  /**
   * Estorno automático caso a emissão da licença falhe
   */
  static refundTransaction(transactionId: string, reason = 'Falha na emissão da licença'): boolean {
    const tx = db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(transactionId) as any;
    if (!tx || tx.type !== 'debit') return false;

    const wallet = db.prepare('SELECT * FROM reseller_wallets WHERE id = ?').get(tx.wallet_id) as any;
    if (!wallet) return false;

    const now = new Date().toISOString();
    const refundTxId = `tx_${crypto.randomUUID()}`;
    const balanceBefore = wallet.balance_cents;
    const balanceAfter = balanceBefore + tx.amount_cents;

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE reseller_wallets 
        SET balance_cents = balance_cents + ?,
            total_debited_cents = total_debited_cents - ?,
            total_licenses_generated = MAX(0, total_licenses_generated - 1),
            updated_at = ?
        WHERE id = ?
      `).run(tx.amount_cents, tx.amount_cents, now, wallet.id);

      db.prepare(`
        INSERT INTO wallet_transactions (
          id, wallet_id, type, amount_cents, balance_before_cents, balance_after_cents,
          description, reference_id, created_by, created_at
        ) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, 'system_refund', ?)
      `).run(
        refundTxId,
        wallet.id,
        tx.amount_cents,
        balanceBefore,
        balanceAfter,
        `Estorno: ${reason}`,
        tx.reference_id,
        now
      );

      db.exec('COMMIT;');
      return true;
    } catch (err) {
      db.exec('ROLLBACK;');
      return false;
    }
  }

  /**
   * Adiciona saldo manual ou automático na carteira (Crédito / Recarga)
   */
  static creditWallet(params: {
    walletId: string;
    amountCents: number;
    createdBy: string;
    description?: string;
    paymentMethod?: string;
    externalId?: string;
    notes?: string;
  }): {
    wallet: Wallet;
    transaction: WalletTransaction;
  } {
    const {
      walletId,
      amountCents,
      createdBy,
      description = 'Recarga de saldo na carteira',
      paymentMethod = 'manual_pix',
      externalId,
      notes,
    } = params;

    if (amountCents <= 0) {
      throw new Error('O valor de recarga deve ser maior que zero.');
    }

    const wallet = db.prepare('SELECT * FROM reseller_wallets WHERE id = ?').get(walletId) as any;
    if (!wallet) {
      throw new Error('Carteira não encontrada.');
    }

    const txId = `tx_${crypto.randomUUID()}`;
    const topupId = `top_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const balanceBefore = wallet.balance_cents;
    const balanceAfter = balanceBefore + amountCents;

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE reseller_wallets 
        SET balance_cents = balance_cents + ?,
            total_credited_cents = total_credited_cents + ?,
            updated_at = ?
        WHERE id = ?
      `).run(amountCents, amountCents, now, walletId);

      db.prepare(`
        INSERT INTO wallet_transactions (
          id, wallet_id, type, amount_cents, balance_before_cents, balance_after_cents,
          description, reference_id, created_by, created_at
        ) VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?, ?)
      `).run(txId, walletId, amountCents, balanceBefore, balanceAfter, description, topupId, createdBy, now);

      db.prepare(`
        INSERT INTO wallet_topups (
          id, wallet_id, amount_cents, status, payment_method, external_id, notes, created_by, created_at
        ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?)
      `).run(topupId, walletId, amountCents, paymentMethod, externalId || null, notes || null, createdBy, now);

      // Log de Auditoria
      db.prepare(`
        INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'WALLET_CREDIT', 'reseller_wallets', ?, ?, ?)
      `).run(
        `aud_${crypto.randomUUID()}`,
        walletId,
        JSON.stringify({ amount_brl: amountCents / 100, balance_after: balanceAfter / 100, createdBy, notes }),
        now
      );

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const updatedWallet = this.getWallet(walletId)!;
    const transaction = db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(txId) as any;

    return { wallet: updatedWallet, transaction };
  }

  /**
   * Realiza um ajuste manual auditado no saldo da carteira
   */
  static adjustWallet(params: {
    walletId: string;
    newBalanceCents: number;
    reason: string;
    createdBy: string;
  }): Wallet {
    const { walletId, newBalanceCents, reason, createdBy } = params;
    if (newBalanceCents < 0) {
      throw new Error('O saldo não pode ser negativo.');
    }

    const wallet = db.prepare('SELECT * FROM reseller_wallets WHERE id = ?').get(walletId) as any;
    if (!wallet) throw new Error('Carteira não encontrada.');

    const balanceBefore = wallet.balance_cents;
    const diff = newBalanceCents - balanceBefore;
    if (diff === 0) return wallet;

    const txId = `tx_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('UPDATE reseller_wallets SET balance_cents = ?, updated_at = ? WHERE id = ?').run(
        newBalanceCents,
        now,
        walletId
      );

      db.prepare(`
        INSERT INTO wallet_transactions (
          id, wallet_id, type, amount_cents, balance_before_cents, balance_after_cents,
          description, created_by, created_at
        ) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        walletId,
        Math.abs(diff),
        balanceBefore,
        newBalanceCents,
        `Ajuste administrativo: ${reason}`,
        createdBy,
        now
      );

      db.prepare(`
        INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'WALLET_ADJUST', 'reseller_wallets', ?, ?, ?)
      `).run(
        `aud_${crypto.randomUUID()}`,
        walletId,
        JSON.stringify({ before: balanceBefore / 100, after: newBalanceCents / 100, reason, createdBy }),
        now
      );

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return this.getWallet(walletId)!;
  }

  /**
   * Bloqueia ou desbloqueia a carteira de um revendedor
   */
  static toggleBlockWallet(walletId: string): Wallet {
    const wallet = this.getWallet(walletId);
    if (!wallet) throw new Error('Carteira não encontrada.');

    const newStatus = wallet.status === 'blocked' ? 'active' : 'blocked';
    const now = new Date().toISOString();

    db.prepare('UPDATE reseller_wallets SET status = ?, updated_at = ? WHERE id = ?').run(
      newStatus,
      now,
      walletId
    );

    return this.getWallet(walletId)!;
  }

  /**
   * Lista todas as carteiras de revendedores com dados formatados
   */
  static listWallets(): any[] {
    const rows = db.prepare(`
      SELECT w.*, 
             COUNT(k.id) as total_api_keys
      FROM reseller_wallets w
      LEFT JOIN api_keys k ON k.wallet_id = w.id
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `).all() as any[];

    return rows.map((w) => ({
      ...w,
      balance_brl: (w.balance_cents / 100).toFixed(2),
      total_credited_brl: (w.total_credited_cents / 100).toFixed(2),
      total_debited_brl: (w.total_debited_cents / 100).toFixed(2),
    }));
  }

  /**
   * Lista as transações financeiras de uma carteira
   */
  static getTransactions(walletId: string, limit = 50): any[] {
    const rows = db.prepare(`
      SELECT * FROM wallet_transactions 
      WHERE wallet_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(walletId, Math.min(100, limit)) as any[];

    return rows.map((tx) => ({
      ...tx,
      amount_brl: (tx.amount_cents / 100).toFixed(2),
      balance_before_brl: (tx.balance_before_cents / 100).toFixed(2),
      balance_after_brl: (tx.balance_after_cents / 100).toFixed(2),
    }));
  }

  /**
   * Configura preço personalizado de licença
   */
  static setPricing(params: {
    extensionId?: string;
    walletId?: string;
    priceCents: number;
  }): void {
    const { extensionId, walletId, priceCents } = params;
    const id = `prc_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();

    // Desativa preço anterior idêntico
    db.prepare(`
      UPDATE license_pricing SET is_active = 0 WHERE extension_id IS ? AND wallet_id IS ?
    `).run(extensionId || null, walletId || null);

    db.prepare(`
      INSERT INTO license_pricing (id, extension_id, wallet_id, price_cents, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, extensionId || null, walletId || null, priceCents, now, now);
  }
}
