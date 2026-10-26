import { Router, Request, Response } from 'express';
import { requireApiKey } from '../../auth/authMiddleware.js';

export const accountRouter = Router();

/**
 * @route GET /api/v1/account
 * @desc Retorna dados do cliente/integração associado à chave de API utilizada
 */
accountRouter.get('/', requireApiKey(), (req: Request, res: Response): void => {
  const key = req.apiKeyRecord!;

  res.status(200).json({
    success: true,
    data: {
      keyId: key.id,
      name: key.name,
      clientName: key.client_name,
      clientId: key.client_id,
      keyPrefix: key.key_prefix,
      rateLimitPerMinute: key.rate_limit_per_min,
      permissions: key.permissions,
      expiresAt: key.expires_at,
      requestCount: key.request_count,
      lastUsedAt: key.last_used_at,
      createdAt: key.created_at,
    },
    message: 'Conta autenticada com sucesso',
  });
});
