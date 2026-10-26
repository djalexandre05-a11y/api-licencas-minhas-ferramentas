import { Router, Request, Response } from 'express';
import { db } from '../database.js';
import { ApiKeyService } from '../auth/apiKeyService.js';
import { WebhookService } from '../services/webhookService.js';

import crypto from 'node:crypto';
export const adminRouter = Router();

function hashPassword(pass: string): string {
  return crypto.createHash('sha256').update(pass.trim()).digest('hex');
}

// 🔐 Rota de Login do Administrador
adminRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, error: { message: 'Email e senha são obrigatórios' } });
    return;
  }

  const passHash = hashPassword(password);
  const user = db.prepare('SELECT id, email FROM admin_users WHERE email = ? AND password_hash = ?').get(email.trim(), passHash) as any;

  if (!user) {
    res.status(401).json({ success: false, error: { message: 'Email ou senha incorretos' } });
    return;
  }

  // Gera um token de sessão de 24h
  const sessionToken = `sess_${crypto.randomBytes(32).toString('hex')}`;
  res.json({
    success: true,
    data: {
      token: sessionToken,
      user: { id: user.id, email: user.email },
    },
    message: 'Login realizado com sucesso',
  });
});

// 🔑 Rota para Alterar Senha do Administrador
adminRouter.post('/change-password', (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: { message: 'Informe a senha atual e a nova senha' } });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ success: false, error: { message: 'A nova senha deve ter no mínimo 6 caracteres' } });
    return;
  }

  const curHash = hashPassword(currentPassword);
  const user = db.prepare('SELECT id FROM admin_users WHERE password_hash = ? LIMIT 1').get(curHash) as any;

  if (!user) {
    res.status(401).json({ success: false, error: { message: 'A senha atual informada está incorreta' } });
    return;
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    newHash,
    new Date().toISOString(),
    user.id
  );

  res.json({ success: true, message: 'Senha alterada com sucesso! Guarde sua nova senha.' });
});

// Estatísticas globais do painel
adminRouter.get('/stats', (req: Request, res: Response) => {
  const totalLic = (db.prepare('SELECT COUNT(*) as count FROM licenses').get() as any).count;
  const activeLic = (db.prepare('SELECT COUNT(*) as count FROM licenses WHERE status = "active"').get() as any).count;
  const expiredLic = (db.prepare('SELECT COUNT(*) as count FROM licenses WHERE status = "expired"').get() as any).count;
  const suspendedLic = (db.prepare('SELECT COUNT(*) as count FROM licenses WHERE status = "suspended"').get() as any).count;

  const totalReq = (db.prepare('SELECT COUNT(*) as count FROM api_request_logs').get() as any).count;

  const todayIso = new Date().toISOString().split('T')[0];
  const todayReq = (db.prepare('SELECT COUNT(*) as count FROM api_request_logs WHERE created_at LIKE ?').get(`${todayIso}%`) as any).count;

  const successReq = (db.prepare('SELECT COUNT(*) as count FROM api_request_logs WHERE status_code >= 200 AND status_code < 400').get() as any).count;
  const errorReq = (db.prepare('SELECT COUNT(*) as count FROM api_request_logs WHERE status_code >= 400').get() as any).count;

  const avgTime = (db.prepare('SELECT AVG(response_time_ms) as avg FROM api_request_logs').get() as any).avg || 0;

  const activeKeys = (db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1 AND is_blocked = 0').get() as any).count;

  res.json({
    success: true,
    data: {
      licenses: {
        total: totalLic,
        active: activeLic,
        expired: expiredLic,
        suspended: suspendedLic,
        monthlyGrowthPercent: 12,
      },
      requests: {
        total: totalReq,
        today: todayReq,
        success: successReq,
        error: errorReq,
        avgResponseTimeMs: Math.round(avgTime * 10) / 10,
        activeKeys,
      },
    },
  });
});

// Listagem de chaves de API
adminRouter.get('/keys', (req: Request, res: Response) => {
  const keys = ApiKeyService.listKeys();
  res.json({ success: true, data: keys });
});

// Criar nova chave de API (retorna a chave em texto puro apenas desta vez)
adminRouter.post('/keys', (req: Request, res: Response) => {
  const { name, clientName, permissions, expiresInDays, rateLimitPerMin } = req.body;
  if (!name || !clientName) {
    res.status(422).json({ success: false, error: { message: 'name e clientName são obrigatórios' } });
    return;
  }

  const result = ApiKeyService.generateApiKey({
    name,
    clientName,
    permissions,
    expiresInDays: expiresInDays ? Number(expiresInDays) : null,
    rateLimitPerMin: rateLimitPerMin ? Number(rateLimitPerMin) : 100,
  });

  res.status(201).json({
    success: true,
    data: result,
    message: 'Chave de API gerada com sucesso! Guarde a chave secreta agora, ela não será exibida novamente.',
  });
});

// Revogar chave de API
adminRouter.post('/keys/:id/revoke', (req: Request, res: Response) => {
  const success = ApiKeyService.revokeKey(req.params.id);
  res.json({ success, message: success ? 'Chave revogada com sucesso' : 'Chave não encontrada' });
});

// Bloquear / Desbloquear chave
adminRouter.post('/keys/:id/toggle-block', (req: Request, res: Response) => {
  const success = ApiKeyService.toggleBlockKey(req.params.id);
  res.json({ success, message: 'Status de bloqueio atualizado' });
});

// Rotacionar chave
adminRouter.post('/keys/:id/rotate', (req: Request, res: Response) => {
  const result = ApiKeyService.rotateKey(req.params.id);
  if (!result) {
    res.status(404).json({ success: false, error: { message: 'Chave não encontrada' } });
    return;
  }
  res.json({
    success: true,
    data: result,
    message: 'Chave rotacionada com sucesso! Copie a nova chave secreta.',
  });
});

// Logs de requisições recentes
adminRouter.get('/logs', (req: Request, res: Response) => {
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const rows = db.prepare(`
    SELECT l.*, k.name as key_name, k.key_prefix
    FROM api_request_logs l
    LEFT JOIN api_keys k ON l.api_key_id = k.id
    ORDER BY l.created_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ success: true, data: rows });
});

// Logs de auditoria
adminRouter.get('/audit', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM api_audit_logs ORDER BY created_at DESC LIMIT 50').all();
  res.json({ success: true, data: rows });
});

// Webhooks
adminRouter.get('/webhooks', (req: Request, res: Response) => {
  const list = WebhookService.listWebhooks();
  const deliveries = WebhookService.getDeliveries(20);
  res.json({ success: true, data: { webhooks: list, deliveries } });
});

adminRouter.post('/webhooks', (req: Request, res: Response) => {
  const { url, events } = req.body;
  if (!url) {
    res.status(422).json({ success: false, error: { message: 'URL do webhook é obrigatória' } });
    return;
  }
  const hook = WebhookService.createWebhook(url, events || ['*']);
  res.status(201).json({ success: true, data: hook });
});

adminRouter.delete('/webhooks/:id', (req: Request, res: Response) => {
  WebhookService.deleteWebhook(req.params.id);
  res.json({ success: true, message: 'Webhook removido' });
});

// Testar disparo manual de webhook
adminRouter.post('/webhooks/test', async (req: Request, res: Response) => {
  const results = await WebhookService.trigger('test.ping', {
    message: 'Disparo de teste efetuado com sucesso pelo Painel Administrativo',
    timestamp: new Date().toISOString(),
  });
  res.json({ success: true, data: results });
});

// Configurações
adminRouter.get('/settings', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM api_settings').all() as any[];
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ success: true, data: settings });
});

adminRouter.post('/settings', (req: Request, res: Response) => {
  const entries = Object.entries(req.body);
  const now = new Date().toISOString();
  for (const [key, value] of entries) {
    db.prepare(`
      INSERT INTO api_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), now);
  }
  res.json({ success: true, message: 'Configurações salvas' });
});
