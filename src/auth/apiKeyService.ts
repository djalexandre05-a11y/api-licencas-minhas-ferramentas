import crypto from 'node:crypto';
import { db } from '../database.js';

export interface CreateApiKeyInput {
  name: string;
  clientName: string;
  clientId?: string;
  permissions?: string[];
  expiresInDays?: number | null; // null = sem expiração
  rateLimitPerMin?: number;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  client_id: string | null;
  client_name: string;
  rate_limit_per_min: number;
  expires_at: string | null;
  is_active: number;
  is_blocked: number;
  request_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  permissions?: string[];
}

export class ApiKeyService {
  /**
   * Gera uma nova chave de API com prefixo `sk_live_` e armazena apenas o hash SHA-256
   */
  static generateApiKey(input: CreateApiKeyInput): { apiKey: string; record: ApiKeyRecord } {
    const rawSecret = crypto.randomBytes(24).toString('base64url');
    const fullApiKey = `sk_live_${rawSecret}`;
    const keyHash = this.hashApiKey(fullApiKey);
    const keyPrefix = `${fullApiKey.slice(0, 11)}...${fullApiKey.slice(-4)}`;

    const id = `key_${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0
        ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const rateLimit = input.rateLimitPerMin && input.rateLimitPerMin > 0 ? input.rateLimitPerMin : 100;
    const permissions = input.permissions && input.permissions.length > 0 ? input.permissions : ['read', 'licenses:verify'];

    // Inserir no banco
    db.prepare(`
      INSERT INTO api_keys (
        id, name, key_prefix, key_hash, client_id, client_name,
        rate_limit_per_min, expires_at, is_active, is_blocked,
        request_count, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)
    `).run(
      id,
      input.name,
      keyPrefix,
      keyHash,
      input.clientId || null,
      input.clientName,
      rateLimit,
      expiresAt,
      now.toISOString(),
      now.toISOString()
    );

    // Inserir permissões
    for (const perm of permissions) {
      db.prepare(`
        INSERT INTO api_key_permissions (id, api_key_id, permission)
        VALUES (?, ?, ?)
      `).run(`perm_${crypto.randomUUID()}`, id, perm);
    }

    // Registrar auditoria
    db.prepare(`
      INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'CREATE_API_KEY', 'api_key', ?, ?, '127.0.0.1', ?)
    `).run(
      `audit_${crypto.randomUUID()}`,
      id,
      JSON.stringify({ name: input.name, prefix: keyPrefix, permissions }),
      now.toISOString()
    );

    const record = this.getKeyById(id)!;
    return { apiKey: fullApiKey, record };
  }

  static hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key.trim()).digest('hex');
  }

  static getKeyByRawToken(rawKey: string): ApiKeyRecord | null {
    if (!rawKey || !rawKey.startsWith('sk_live_')) return null;
    const hash = this.hashApiKey(rawKey);
    const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash) as any;
    if (!row) return null;

    const perms = db
      .prepare('SELECT permission FROM api_key_permissions WHERE api_key_id = ?')
      .all(row.id) as any[];

    return {
      ...row,
      permissions: perms.map((p) => p.permission),
    };
  }

  static getKeyById(id: string): ApiKeyRecord | null {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as any;
    if (!row) return null;

    const perms = db
      .prepare('SELECT permission FROM api_key_permissions WHERE api_key_id = ?')
      .all(id) as any[];

    return {
      ...row,
      permissions: perms.map((p) => p.permission),
    };
  }

  static listKeys(): ApiKeyRecord[] {
    const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];
    return rows.map((row) => {
      const perms = db
        .prepare('SELECT permission FROM api_key_permissions WHERE api_key_id = ?')
        .all(row.id) as any[];
      return {
        ...row,
        permissions: perms.map((p) => p.permission),
      };
    });
  }

  static revokeKey(id: string): boolean {
    const key = this.getKeyById(id);
    if (!key) return false;

    db.prepare('UPDATE api_keys SET is_active = 0, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id
    );

    db.prepare(`
      INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'REVOKE_API_KEY', 'api_key', ?, ?, '127.0.0.1', ?)
    `).run(`audit_${crypto.randomUUID()}`, id, JSON.stringify({ prefix: key.key_prefix }), new Date().toISOString());

    return true;
  }

  static toggleBlockKey(id: string): boolean {
    const key = this.getKeyById(id);
    if (!key) return false;
    const newStatus = key.is_blocked ? 0 : 1;

    db.prepare('UPDATE api_keys SET is_blocked = ?, updated_at = ? WHERE id = ?').run(
      newStatus,
      new Date().toISOString(),
      id
    );

    db.prepare(`
      INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'api_key', ?, ?, '127.0.0.1', ?)
    `).run(
      `audit_${crypto.randomUUID()}`,
      newStatus ? 'BLOCK_API_KEY' : 'UNBLOCK_API_KEY',
      id,
      JSON.stringify({ prefix: key.key_prefix }),
      new Date().toISOString()
    );

    return true;
  }

  static rotateKey(id: string): { newApiKey: string; record: ApiKeyRecord } | null {
    const oldKey = this.getKeyById(id);
    if (!oldKey) return null;

    const rawSecret = crypto.randomBytes(24).toString('base64url');
    const fullApiKey = `sk_live_${rawSecret}`;
    const keyHash = this.hashApiKey(fullApiKey);
    const keyPrefix = `${fullApiKey.slice(0, 11)}...${fullApiKey.slice(-4)}`;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE api_keys
      SET key_prefix = ?, key_hash = ?, is_active = 1, is_blocked = 0, updated_at = ?
      WHERE id = ?
    `).run(keyPrefix, keyHash, now, id);

    db.prepare(`
      INSERT INTO api_audit_logs (id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'ROTATE_API_KEY', 'api_key', ?, ?, '127.0.0.1', ?)
    `).run(`audit_${crypto.randomUUID()}`, id, JSON.stringify({ newPrefix: keyPrefix }), now);

    return {
      newApiKey: fullApiKey,
      record: this.getKeyById(id)!,
    };
  }

  static recordUsage(id: string) {
    db.prepare(`
      UPDATE api_keys
      SET request_count = request_count + 1, last_used_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  }
}
