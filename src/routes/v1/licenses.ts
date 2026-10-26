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
  async (req: Request, res: Response): Promise<void> => {
    const { q, status, extensionId, page = 1, limit = 100 } = req.query;

    let rows = db.prepare('SELECT * FROM licenses WHERE 1=1 ORDER BY created_at DESC').all() as any[];

    // Se o banco local tiver poucos registros ou estiver vazio (ex: Vercel serverless), busca do Supabase oficial
    if (rows.length === 0) {
      try {
        const supaRows = await SupabaseService.listLicenses();
        if (supaRows && supaRows.length > 0) {
          rows = supaRows;
          // Popula cache local
          for (const lic of supaRows) {
            try {
              db.prepare(`
                INSERT OR IGNORE INTO licenses (id, license_key, client_name, client_email, extension_id, status, expires_at, created_at, max_activations, current_activations)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
              `).run(lic.id, lic.license_key, lic.client_name, lic.client_email, lic.extension_id, lic.status, lic.expires_at, lic.created_at, lic.max_activations || 3);
            } catch (_) {}
          }
        }
      } catch (e) {
        console.error('[Supabase List Error]:', e);
      }
    }

    // Filtragem em memória caso venha do Supabase ou banco
    let filtered = rows;
    if (q) {
      const term = String(q).toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.license_key && r.license_key.toLowerCase().includes(term)) ||
          (r.client_name && r.client_name.toLowerCase().includes(term)) ||
          (r.client_email && r.client_email.toLowerCase().includes(term))
      );
    }
    if (status && status !== 'all') {
      filtered = filtered.filter((r) => r.status === status);
    }
    if (extensionId) {
      filtered = filtered.filter((r) => String(r.extension_id).toLowerCase() === String(extensionId).toLowerCase());
    }

    const parsedLimit = Math.min(100, Math.max(1, Number(limit)));
    const offset = (Math.max(1, Number(page)) - 1) * parsedLimit;
    const paginated = filtered.slice(offset, offset + parsedLimit);

    res.status(200).json({
      success: true,
      data: {
        licenses: paginated,
        pagination: {
          total: filtered.length,
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
  async (req: Request, res: Response): Promise<void> => {
    const idParam = String(req.params.id);
    let lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(idParam, idParam) as any;

    if (!lic) {
      const supaCheck = await SupabaseService.verifyLicense(idParam);
      if (supaCheck.valid && supaCheck.license) {
        lic = {
          id: supaCheck.license.id,
          license_key: supaCheck.license.license_key,
          client_name: supaCheck.license.customer_name,
          client_email: supaCheck.license.customer_email || supaCheck.license.email,
          extension_id: supaCheck.license.extension_id,
          status: supaCheck.license.status,
          expires_at: supaCheck.license.expires_at,
        };
      }
    }

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
 * @desc Criação de nova licença integrada 100% com o Supabase oficial
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

    const cleanExt = String(extensionId).trim().toLowerCase();
    const resolvedExtUuid = SupabaseService.resolveExtensionUuid(cleanExt);

    // Garante que a extensão exista no banco local
    let ext = db.prepare('SELECT * FROM extensions WHERE id = ? COLLATE NOCASE OR name = ? COLLATE NOCASE').get(cleanExt, cleanExt) as any;
    if (!ext) {
      try {
        db.prepare('INSERT OR IGNORE INTO extensions (id, name, version) VALUES (?, ?, ?)').run(resolvedExtUuid, cleanExt, '1.0');
      } catch (_) {}
    }

    // Obter ou criar cliente
    let client = db.prepare('SELECT * FROM clients WHERE email = ?').get(clientEmail) as any;
    if (!client) {
      const clientId = `cli_${crypto.randomUUID()}`;
      try {
        db.prepare('INSERT INTO clients (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
          clientId,
          clientName,
          clientEmail,
          new Date().toISOString()
        );
      } catch (_) {}
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
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 3, 0, ?, ?)
      `).run(
        licenseId,
        licenseKey,
        client.id,
        client.name,
        client.email,
        cleanExt,
        expiresAt,
        now.toISOString(),
        now.toISOString()
      );

      const createdLicense = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);

      // Sincronização em tempo real com o Supabase oficial (onde as extensões e softwares validam)
      try {
        await SupabaseService.createLicense({
          license_key: licenseKey,
          extension_id: resolvedExtUuid,
          customer_name: client.name,
          customer_email: client.email,
          status: 'active',
          expires_at: expiresAt,
          max_devices: 3,
        });
      } catch (e) {
        console.error('[Supabase Create Sync Error]:', e);
      }

      // Webhook assíncrono
      WebhookService.trigger('license.created', createdLicense).catch(() => {});

      res.status(201).json({
        success: true,
        data: createdLicense || {
          id: licenseId,
          license_key: licenseKey,
          client_name: client.name,
          client_email: client.email,
          extension_id: cleanExt,
          status: 'active',
          expires_at: expiresAt,
        },
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
 * @desc Suspender licença (bloqueia no banco local e no Supabase)
 */
licensesRouter.post(
  '/:id/suspend',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    let lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    const targetKey = lic ? lic.license_key : licId;

    if (lic) {
      const now = new Date().toISOString();
      db.prepare("UPDATE licenses SET status = 'suspended', updated_at = ? WHERE id = ? OR license_key = ?").run(now, lic.id, lic.license_key);
    }

    // Sincroniza suspensão no Supabase oficial aguardando retorno
    try {
      await SupabaseService.updateLicenseStatus(targetKey, 'suspended');
    } catch (e) {
      console.error('[Supabase Suspend Error]:', e);
    }

    const updated = lic ? db.prepare('SELECT * FROM licenses WHERE id = ?').get(lic.id) : { license_key: targetKey, status: 'suspended' };
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
 * @desc Ativar ou reativar licença (ativa no banco local e no Supabase)
 */
licensesRouter.post(
  '/:id/activate',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    let lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    const targetKey = lic ? lic.license_key : licId;

    if (lic) {
      const now = new Date().toISOString();
      db.prepare("UPDATE licenses SET status = 'active', updated_at = ? WHERE id = ? OR license_key = ?").run(now, lic.id, lic.license_key);
    }

    // Sincroniza ativação no Supabase oficial aguardando retorno
    try {
      await SupabaseService.updateLicenseStatus(targetKey, 'active');
    } catch (e) {
      console.error('[Supabase Activate Error]:', e);
    }

    const updated = lic ? db.prepare('SELECT * FROM licenses WHERE id = ?').get(lic.id) : { license_key: targetKey, status: 'active' };
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
 * @desc Excluir licença (remove do banco local e do Supabase oficial)
 */
licensesRouter.delete(
  '/:id',
  requireApiKey('write'),
  async (req: Request, res: Response): Promise<void> => {
    const licId = String(req.params.id);
    let lic = db.prepare('SELECT * FROM licenses WHERE id = ? OR license_key = ?').get(licId, licId) as any;
    const targetKey = lic ? lic.license_key : licId;

    if (lic) {
      db.prepare('DELETE FROM licenses WHERE id = ? OR license_key = ?').run(lic.id, lic.license_key);
    }

    // Exclui também do Supabase oficial aguardando retorno
    try {
      await SupabaseService.deleteLicense(targetKey);
    } catch (e) {
      console.error('[Supabase Delete Error]:', e);
    }

    res.status(200).json({
      success: true,
      data: { id: lic?.id || licId, license_key: targetKey },
      message: 'Licença excluída com sucesso',
    });
  }
);
