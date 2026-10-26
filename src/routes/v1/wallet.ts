import { Router, Request, Response } from 'express';
import { requireApiKey } from '../../auth/authMiddleware.js';
import { WalletService } from '../../services/walletService.js';

export const walletRouter = Router();

/**
 * Middleware para validar que a requisição é do Administrador
 */
function requireAdminAuth(req: Request, res: Response, next: () => void) {
  const isAdminSession = req.headers['x-admin-session'] === 'true' || Boolean((req as any).user);
  const authHeader = req.headers.authorization;
  const isBearerMaster = authHeader && (authHeader.includes('sess_') || authHeader.includes('master'));

  if (isAdminSession || isBearerMaster) {
    return next();
  }

  // Se veio com API Key comum, checa se tem permissão 'admin' ou 'licenses:manage'
  const apiKey = (req as any).apiKey;
  if (apiKey && (apiKey.permissions?.includes('admin') || apiKey.permissions?.includes('*'))) {
    return next();
  }

  res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Acesso restrito ao administrador do sistema' },
  });
}

/**
 * @route GET /api/v1/wallet/balance
 * @desc Consultar saldo disponível da carteira autenticada
 */
walletRouter.get(
  '/balance',
  requireApiKey('read'),
  (req: Request, res: Response): void => {
    const apiKey = (req as any).apiKey;
    const wallet = WalletService.getOrCreateWalletForApiKey(apiKey);

    res.status(200).json({
      success: true,
      data: {
        wallet_id: wallet.id,
        reseller_id: wallet.reseller_id,
        reseller_name: wallet.name,
        reseller_email: wallet.email,
        balance_brl: Number((wallet.balance_cents / 100).toFixed(2)),
        currency: 'BRL',
        total_credited_brl: Number((wallet.total_credited_cents / 100).toFixed(2)),
        total_debited_brl: Number((wallet.total_debited_cents / 100).toFixed(2)),
        total_licenses_generated: wallet.total_licenses_generated,
        status: wallet.status,
        updated_at: wallet.updated_at,
      },
      message: 'Saldo da carteira consultado com sucesso',
    });
  }
);

/**
 * @route GET /api/v1/wallet/transactions
 * @desc Consultar histórico de movimentações da carteira
 */
walletRouter.get(
  '/transactions',
  requireApiKey('read'),
  (req: Request, res: Response): void => {
    const apiKey = (req as any).apiKey;
    const wallet = WalletService.getOrCreateWalletForApiKey(apiKey);
    const limit = Number(req.query.limit) || 50;

    const transactions = WalletService.getTransactions(wallet.id, limit);

    res.status(200).json({
      success: true,
      data: {
        wallet_id: wallet.id,
        balance_brl: Number((wallet.balance_cents / 100).toFixed(2)),
        currency: 'BRL',
        transactions,
      },
      message: 'Histórico de movimentações recuperado com sucesso',
    });
  }
);

/**
 * @route GET /api/v1/licenses/pricing
 * @desc Consultar preços vigentes das licenças autorizadas (R$ 15,00 padrão)
 */
walletRouter.get(
  '/pricing',
  (req: Request, res: Response): void => {
    const apiKey = (req as any).apiKey;
    const extensionId = req.query.extensionId ? String(req.query.extensionId) : undefined;
    const walletId = apiKey?.wallet_id;

    const pricing = WalletService.getPricing(extensionId, walletId);

    res.status(200).json({
      success: true,
      data: {
        price_per_license_brl: pricing.price_brl,
        price_cents: pricing.price_cents,
        currency: 'BRL',
        extension_id: extensionId || 'all',
        description: 'Preço fixo de emissão cobrado diretamente da carteira do revendedor',
      },
      message: 'Tabela de preços consultada com sucesso',
    });
  }
);

/**
 * @route POST /api/v1/admin/wallets/:id/credit
 * @desc Adicionar saldo na carteira (Administrador)
 */
walletRouter.post(
  '/admin/wallets/:id/credit',
  requireAdminAuth,
  (req: Request, res: Response): void => {
    const walletId = String(req.params.id);
    const { amount, description, paymentMethod, notes, externalId } = req.body;

    const amountFloat = Number(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      res.status(422).json({
        success: false,
        error: { code: 'INVALID_AMOUNT', message: 'Informe um valor válido maior que R$ 0,00' },
      });
      return;
    }

    const amountCents = Math.round(amountFloat * 100);

    try {
      const result = WalletService.creditWallet({
        walletId,
        amountCents,
        createdBy: 'admin_panel',
        description: description || `Recarga manual autorizada (R$ ${amountFloat.toFixed(2)})`,
        paymentMethod: paymentMethod || 'manual_pix',
        notes,
        externalId,
      });

      res.status(200).json({
        success: true,
        data: {
          wallet_id: result.wallet.id,
          reseller_name: result.wallet.name,
          new_balance_brl: Number((result.wallet.balance_cents / 100).toFixed(2)),
          credited_amount_brl: amountFloat,
          currency: 'BRL',
          transaction_id: result.transaction.id,
        },
        message: 'Saldo adicionado com sucesso na carteira do revendedor',
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: { code: 'WALLET_ERROR', message: err.message },
      });
    }
  }
);

/**
 * @route POST /api/v1/admin/wallets/:id/adjust
 * @desc Realizar ajustes financeiros auditáveis na carteira (Administrador)
 */
walletRouter.post(
  '/admin/wallets/:id/adjust',
  requireAdminAuth,
  (req: Request, res: Response): void => {
    const walletId = String(req.params.id);
    const { newBalance, reason } = req.body;

    const balanceFloat = Number(newBalance);
    if (isNaN(balanceFloat) || balanceFloat < 0) {
      res.status(422).json({
        success: false,
        error: { code: 'INVALID_BALANCE', message: 'Informe um novo saldo numérico positivo' },
      });
      return;
    }

    if (!reason || String(reason).trim().length < 3) {
      res.status(422).json({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'Informe o motivo do ajuste para registro de auditoria' },
      });
      return;
    }

    const newBalanceCents = Math.round(balanceFloat * 100);

    try {
      const updated = WalletService.adjustWallet({
        walletId,
        newBalanceCents,
        reason: String(reason).trim(),
        createdBy: 'admin_panel',
      });

      res.status(200).json({
        success: true,
        data: {
          wallet_id: updated.id,
          reseller_name: updated.name,
          adjusted_balance_brl: Number((updated.balance_cents / 100).toFixed(2)),
          currency: 'BRL',
        },
        message: 'Ajuste de saldo efetuado e registrado em auditoria',
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: { code: 'ADJUST_ERROR', message: err.message },
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/wallets
 * @desc Listar todas as carteiras e seus saldos (Administrador)
 */
walletRouter.get(
  '/admin/wallets',
  requireAdminAuth,
  (req: Request, res: Response): void => {
    const wallets = WalletService.listWallets();
    res.status(200).json({
      success: true,
      data: wallets,
      message: 'Carteiras listadas com sucesso',
    });
  }
);

/**
 * @route POST /api/v1/admin/wallets/:id/toggle-block
 * @desc Bloquear ou desbloquear carteira de revendedor (Administrador)
 */
walletRouter.post(
  '/admin/wallets/:id/toggle-block',
  requireAdminAuth,
  (req: Request, res: Response): void => {
    const walletId = String(req.params.id);
    try {
      const updated = WalletService.toggleBlockWallet(walletId);
      res.status(200).json({
        success: true,
        data: updated,
        message: `Carteira ${updated.status === 'blocked' ? 'bloqueada' : 'desbloqueada'} com sucesso`,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: { message: err.message },
      });
    }
  }
);
