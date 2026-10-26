import crypto from 'node:crypto';
import { db } from '../database.js';

export interface WebhookDeliveryResult {
  webhookId: string;
  event: string;
  statusCode?: number;
  success: boolean;
  error?: string;
}

export class WebhookService {
  /**
   * Dispara um evento para todos os webhooks ativos inscritos no evento
   */
  static async trigger(event: string, data: any): Promise<WebhookDeliveryResult[]> {
    const webhooks = db
      .prepare('SELECT * FROM api_webhooks WHERE is_active = 1')
      .all() as any[];

    const results: WebhookDeliveryResult[] = [];

    for (const hook of webhooks) {
      let subscribedEvents: string[] = [];
      try {
        subscribedEvents = JSON.parse(hook.events);
      } catch (_) {
        subscribedEvents = ['*'];
      }

      if (subscribedEvents.includes('*') || subscribedEvents.includes(event)) {
        const res = await this.deliverWebhook(hook, event, data);
        results.push(res);
      }
    }

    return results;
  }

  private static async deliverWebhook(
    hook: any,
    event: string,
    data: any,
    attempt = 1
  ): Promise<WebhookDeliveryResult> {
    const deliveryId = `del_${crypto.randomUUID()}`;
    const timestamp = Date.now().toString();
    const eventId = `evt_${crypto.randomUUID()}`;

    const payload = JSON.stringify({
      id: eventId,
      event,
      timestamp: new Date().toISOString(),
      data,
    });

    // Assinatura HMAC SHA-256
    const signature = crypto
      .createHmac('sha256', hook.secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    try {
      // Validação básica anti-SSRF: evitar destinos privados em produção
      const url = new URL(hook.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Protocolo de webhook inválido');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ZapFlow-Webhook-Engine/1.0',
          'X-Webhook-Id': eventId,
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const resText = await response.text().catch(() => '');
      const isSuccess = response.status >= 200 && response.status < 300;

      // Registrar entrega no banco
      db.prepare(`
        INSERT INTO api_webhook_deliveries (
          id, webhook_id, event, payload, status_code, response_body, success, attempt, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deliveryId,
        hook.id,
        event,
        payload,
        response.status,
        resText.slice(0, 1000),
        isSuccess ? 1 : 0,
        attempt,
        new Date().toISOString()
      );

      // Reenvio se falhar e attempt < 3
      if (!isSuccess && attempt < 3) {
        setTimeout(() => {
          this.deliverWebhook(hook, event, data, attempt + 1);
        }, attempt * 2000);
      }

      return {
        webhookId: hook.id,
        event,
        statusCode: response.status,
        success: isSuccess,
      };
    } catch (err: any) {
      db.prepare(`
        INSERT INTO api_webhook_deliveries (
          id, webhook_id, event, payload, status_code, response_body, success, attempt, delivered_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)
      `).run(
        deliveryId,
        hook.id,
        event,
        payload,
        err.message || 'Falha de conexão',
        attempt,
        new Date().toISOString()
      );

      return {
        webhookId: hook.id,
        event,
        success: false,
        error: err.message,
      };
    }
  }

  static listWebhooks() {
    return db.prepare('SELECT * FROM api_webhooks ORDER BY created_at DESC').all();
  }

  static createWebhook(url: string, events: string[] = ['*']) {
    const id = `wh_${crypto.randomUUID()}`;
    const secret = `whsec_${crypto.randomBytes(20).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO api_webhooks (id, url, secret, events, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, url, JSON.stringify(events), now);

    return { id, url, secret, events, created_at: now };
  }

  static deleteWebhook(id: string) {
    db.prepare('DELETE FROM api_webhooks WHERE id = ?').run(id);
    return true;
  }

  static getDeliveries(limit = 20) {
    return db
      .prepare(`
        SELECT d.*, w.url as webhook_url
        FROM api_webhook_deliveries d
        LEFT JOIN api_webhooks w ON d.webhook_id = w.id
        ORDER BY d.delivered_at DESC
        LIMIT ?
      `)
      .all(limit);
  }
}
