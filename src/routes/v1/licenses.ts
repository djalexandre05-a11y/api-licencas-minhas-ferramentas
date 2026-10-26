import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { db } from '../../database.js';
import { requireApiKey } from '../../auth/authMiddleware.js';
import { WebhookService } from '../../services/webhookService.js';
import { SupabaseService } from '../../services/supabaseService.js';

export const licensesRouter = Router();

// Função utilitária para gerar chave de licença formatada (ex: EJUM-YHEM-UC96-J1VD)
function generateFormattedLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
  };
  return `${segment()}-${segment()}-${segment()}-${segment()}`;
}

/**
 * @route POST /api/v1/licenses/verify
 * @desc Endpoint ultra-rápido para extensões, bots e softwares verificarem se a licença é válida
 * @access Requer API Key com permissão 'licenses:verify' ou 'read'
 */
licensesRouter.post(
  '/verify',
  requireApiKey('licenses:verify'),
  async (req: Request, res: Response): Promise<void> => {
    const { licenseKey, extensionId } = req.body;

    if (!licenseKey) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAM',
          message: 'O parâmetro licenseKey é obrigatório',
        },
      });
      return;
    }

    const cleanKey = String(licenseKey).trim().toUpperCase();

    let query = 'SELECT * FROM licenses WHERE UPPER(license_key) = ?';
    const params: any[] = [cleanKey];

    if (extensionId) {
      query += ' AND extension_id = ?';
      params.push(extensionId);
    }

    const license = db.prepare(query).get(...params) as any;

    if (!license) {
      res.status(404).json({
        success: false,
        error: {
          code: 'LICENSE_NOT_FOUND',
          message: 'Chave de licença não encontrada ou não vinculada a esta extensão',
        },
      });
      return;
    }

    if (license.status === 'suspended') {
      res.status(403).json({
        success: false,
        error: {
          code: 'LICENSE_SUSPENDED',
          message: 'Licença suspensa administrativamente. Entre em contato com o suporte.',
        },
      });
      return;
    }

    // Checar expiração
    const now = new Date();
    const expiresAt = new Date(license.expires_at);
    if (now > expiresAt) {
      // Atualizar status para expired se ainda não estiver
      if (license.status !== 'expired') {
        db.prepare('UPDATE licenses SET status = "expired", updated_at = ? WHERE id = ?').run(
          now.toISOString(),
          license.id
        );
      }

      res.status(403).json({
        success: false,
        error: {
          code: 'LICENSE_EXPIRED',
          message: `Licença expirou em ${license.expires_at}`,
        },
      });
      return;
    }

    // Incrementar ativação se não exceder
    db.prepare('UPDATE licenses SET current_activations = current_activations + 1, updated_at = ? WHERE id = ?').run(
      now.toISOString(),
      license.id
    );

    // Disparar Webhook assíncrono
    WebhookService.trigger('license.verified', {
      licenseId: license.id,
      licenseKey: license.license_key,
      clientName: license.client_name,
      extensionId: license.extension_id,
      verifiedAt: now.toISOString(),
    }).catch(() => {});

    res.status(200).json({
      success: true,
      data: {
        valid: true,
        licenseId: license.id,
        licenseKey: license.license_key,
        client: {
          name: license.client_name,
          email: license.client_email,
        },
        extensionId: license.extension_id,
        status: license.status,
        expiresAt: license.expires_at,
        daysRemaining: Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      },
      message: 'Licença válida e ativa',
    });
  }
);

/**
 * @route GET /api/v1/licenses
 * @desc Listagem de todas as licenças com filtros e paginação
 * @access Requer permissão 'read'
 */
licensesRouter.get(
  '/',
  requireApiKey('read'),
  (req: Request, res: Response): void => {
    const { q, status, extensionId, page = 1, limit = 50 } = req.query;

    let sql = 'SELECT * FROM licenses WHERE 1=1';
    const params: any[] = [];

    if (q) {
      sql += ' AND (license_key LIKE ? OR client_name LIKE ? OR client_email LIKE ?)';
      const term = `%${q}%`;
      params.push(term, term, term);
    }

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (extensionId) {
      sql += ' AND extension_id = ?';
      params.push(extensionId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const parsedLimit = Math.min(100, Math.max(1, Number(limit)));
    const offset = (Math.max(1, Number(page)) - 1) * parsedLimit;
    params.push(parsedLimit, offset);

    const rows = db.prepare(sql).all(...params);

    // Total para paginação
    const countSql = 'SELECT COUNT(*) as total FROM licenses';
    const countResult = db.prepare(countSql).get() as any;

    res.status(200).json({
      success: true,
      data: {
        licenses: rows,
        pagination: {
          total: countResult.total,
          page: Number(page),
          limit: parsedLimit,
        },
      },
      message: 'Licenças recuperadas com sucesso',
    });
  }
);

/**
 * @route GET /api/v1/licenses/:id
 * @desc Detalhes de uma licença específica
 */
licensesRouter.get(
  '/:id',
  requireApiKey('read'),
  (req: Request, res: Response): void => {
    const idParam = String(req.params.id);
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(idParam, idParam) as any;

    if (!lic) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Licença não encontrada' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: lic,
      message: 'Licença recuperada com sucesso',
    });
  }
);

/**
 * @route POST /api/v1/licenses
 * @desc Criação de nova licença
 * @access Requer permissão 'write' ou 'licenses:manage'
 */
licensesRouter.post(
  '/',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const { clientName, clientEmail, extensionId, customKey, validityDays = 365 } = req.body;

    if (!clientName || !clientEmail || !extensionId) {
      res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'clientName, clientEmail e extensionId são campos obrigatórios',
        },
      });
      return;
    }

    // Verificar se a extensão existe (case-insensitive para tolerar 'youtube', 'YouTube', etc)
    const ext = db.prepare('SELECT * FROM extensions WHERE id = ? COLLATE NOCASE OR name = ? COLLATE NOCASE').get(extensionId, extensionId) as any;
    if (!ext) {
      res.status(404).json({
        success: false,
        error: { code: 'EXTENSION_NOT_FOUND', message: `Extensão '${extensionId}' não cadastrada` },
      });
      return;
    }
    const resolvedExtensionId = ext.id;

    // Obter ou criar cliente
    let client = db.prepare('SELECT * FROM clients WHERE email = ?').get(clientEmail) as any;
    if (!client) {
      const clientId = `cli_${crypto.randomUUID()}`;
      db.prepare('INSERT INTO clients (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
        clientId,
        clientName,
        clientEmail,
        new Date().toISOString()
      );
      client = { id: clientId, name: clientName, email: clientEmail };
    }

    const licenseId = `lic_${crypto.randomUUID()}`;
    const licenseKey = customKey ? String(customKey).trim().toUpperCase() : generateFormattedLicenseKey();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
      db.prepare(`
        INSERT INTO licenses (
          id, license_key, client_id, client_name, client_email, extension_id,
          status, expires_at, max_activations, current_activations, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, 0, ?, ?)
      `).run(
        licenseId,
        licenseKey,
        client.id,
        client.name,
        client.email,
        resolvedExtensionId,
        expiresAt,
        now.toISOString(),
        now.toISOString()
      );

      const createdLicense = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);

      // Sincronização em tempo real com o Supabase oficial (onde as extensões e C# validam)
      try {
        await SupabaseService.createLicense({
          license_key: licenseKey,
          extension_id: resolvedExtensionId,
          customer_name: client.name,
          customer_email: client.email,
          status: 'active',
          expires_at: expiresAt,
          max_devices: 3
        });
      } catch (e) {
        console.error('[Supabase Create Sync Error]:', e);
      }

      // Webhook assíncrono
      WebhookService.trigger('license.created', createdLicense).catch(() => {});

      res.status(201).json({
        success: true,
        data: createdLicense,
        message: 'Licença criada com sucesso',
      });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_KEY', message: 'Esta chave de licença já existe' },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }
);

/**
 * @route POST /api/v1/licenses/:id/suspend
 * @desc Suspender licença
 */
licensesRouter.post(
  '/:id/suspend',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    if (!lic) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Licença não encontrada' } });
      return;
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE licenses SET status = 'suspended', updated_at = ? WHERE id = ? OR license_key = ?").run(now, lic.id, lic.license_key);
    const updated = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(lic.id, lic.license_key);

    // Sincroniza suspensão no Supabase aguardando conclusão
    try {
      await SupabaseService.updateLicenseStatus(lic.license_key, 'suspended');
    } catch (e) {}

    WebhookService.trigger('license.suspended', updated).catch(() => {});

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Licença suspensa com sucesso',
    });
  }
);

/**
 * @route POST /api/v1/licenses/:id/activate
 * @desc Ativar ou reativar licença
 */
licensesRouter.post(
  '/:id/activate',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    if (!lic) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Licença não encontrada' } });
      return;
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE licenses SET status = 'active', updated_at = ? WHERE id = ? OR license_key = ?").run(now, lic.id, lic.license_key);
    const updated = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(lic.id, lic.license_key);

    // Sincroniza ativação no Supabase aguardando conclusão
    try {
      await SupabaseService.updateLicenseStatus(lic.license_key, 'active');
    } catch (e) {}

    WebhookService.trigger('license.activated', updated).catch(() => {});

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Licença ativada com sucesso',
    });
  }
);

/**
 * @route DELETE /api/v1/licenses/:id
 * @desc Excluir licença
 */
licensesRouter.delete(
  '/:id',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    if (!lic) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Licença não encontrada' } });
      return;
    }

    db.prepare('DELETE FROM licenses WHERE id = ? OR license_key = ?').run(lic.id, lic.license_key);

    // Exclui também do Supabase aguardando conclusão
    try {
      await SupabaseService.deleteLicense(lic.license_key);
    } catch (e) {}

    res.status(200).json({
      success: true,
      data: { id: lic.id, license_key: lic.license_key },
      message: 'Licença excluída com sucesso',
    });
  }
);
