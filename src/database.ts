import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const isVercel = Boolean(process.env.VERCEL);
const dataDir = isVercel ? '/tmp' : path.resolve(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  db.exec('PRAGMA foreign_keys = ON;');

  // 1. Tabela de Extensões
  db.exec(`
    CREATE TABLE IF NOT EXISTS extensions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      description TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 2. Tabela de Clientes
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 3. Tabela de Licenças
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'suspended')) DEFAULT 'active',
      expires_at TEXT NOT NULL,
      max_activations INTEGER NOT NULL DEFAULT 1,
      current_activations INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
  `);

  // 4. Tabela de API Keys
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
      client_name TEXT NOT NULL,
      rate_limit_per_min INTEGER NOT NULL DEFAULT 100,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  `);

  // 5. Permissões de API Keys
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_key_permissions (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      permission TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_permissions_key ON api_key_permissions(api_key_id);
  `);

  // 6. Logs de Requisições da API
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_request_logs (
      id TEXT PRIMARY KEY,
      api_key_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_time_ms REAL NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_logs_created ON api_request_logs(created_at);
  `);

  // 7. Webhooks
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["*"]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // 8. Entregas de Webhook
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES api_webhooks(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 1,
      delivered_at TEXT NOT NULL
    );
  `);

  // 9. Configurações Globais da API
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 10. Logs de Auditoria
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON api_audit_logs(created_at);
  `);

  // 11. Carteiras dos Revendedores (valores sempre em centavos inteiros)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reseller_wallets (
      id TEXT PRIMARY KEY,
      reseller_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents >= 0),
      total_credited_cents INTEGER NOT NULL DEFAULT 0,
      total_debited_cents INTEGER NOT NULL DEFAULT 0,
      total_licenses_generated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('active', 'blocked', 'suspended')) DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_reseller ON reseller_wallets(reseller_id);
    CREATE INDEX IF NOT EXISTS idx_wallets_email ON reseller_wallets(email);
  `);

  // 12. Extrato Financeiro / Movimentações da Carteira
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES reseller_wallets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('credit', 'debit', 'adjustment', 'refund')),
      amount_cents INTEGER NOT NULL,
      balance_before_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      reference_id TEXT,
      idempotency_key TEXT UNIQUE,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON wallet_transactions(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON wallet_transactions(created_at);
  `);

  // 13. Tabela de Preços de Emissão por Produto/Revendedor
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_pricing (
      id TEXT PRIMARY KEY,
      extension_id TEXT,
      wallet_id TEXT REFERENCES reseller_wallets(id) ON DELETE CASCADE,
      price_cents INTEGER NOT NULL DEFAULT 1500,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 14. Registro de Cobranças por Licença Gerada
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_charges (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL REFERENCES reseller_wallets(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES wallet_transactions(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_charges_lic ON license_charges(license_id);
  `);

  // 15. Registro de Recargas (Manual / Pix / Mercado Pago)
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_topups (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES reseller_wallets(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'approved',
      payment_method TEXT NOT NULL DEFAULT 'manual_pix',
      external_id TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 16. Registro de Idempotência de Requisições
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      request_path TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_records(idempotency_key);
  `);

  // Migração segura para coluna wallet_id na tabela api_keys
  try {
    db.exec('ALTER TABLE api_keys ADD COLUMN wallet_id TEXT REFERENCES reseller_wallets(id);');
  } catch (_) {}

  // 17. Usuários Administradores para Login do Painel
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Criar ou atualizar administrador padrão com o email oficial autobotdigital21@outlook.com
  const defaultPassHash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'; // sha256 de "admin123456"
  try {
    db.prepare(`
      INSERT OR REPLACE INTO admin_users (id, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'admin_1',
      'autobotdigital21@outlook.com',
      defaultPassHash,
      new Date().toISOString(),
      new Date().toISOString()
    );
  } catch (_) {}

  seedData();
}

function seedData() {
  // Configurações padrão
  const defaultSettings = [
    { key: 'api_version', value: '1.0.0' },
    { key: 'default_rate_limit', value: '100' },
    { key: 'cors_origins', value: '*' },
    { key: 'webhook_retry_limit', value: '3' },
  ];

  for (const s of defaultSettings) {
    const existing = db.prepare('SELECT key FROM api_settings WHERE key = ?').get(s.key);
    if (!existing) {
      db.prepare('INSERT INTO api_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
        s.key,
        s.value,
        new Date().toISOString()
      );
    }
  }

  // Todas as 30 ferramentas cadastradas no ecossistema e no Supabase
  const extensions = [
    { id: 'ultrabot', name: 'ultrabot', version: 'v1.0', description: 'UltraBot de atendimento C# e inteligência' },
    { id: 'omnius ai', name: 'Omnius AI', version: 'v1.0', description: 'Omnius AI Intelligence' },
    { id: 'olx', name: 'OLX', version: 'v1.0', description: 'Extrator e automação OLX' },
    { id: 'lead wave', name: 'Lead Wave', version: 'v1.0', description: 'Captação e funil de leads' },
    { id: 'sms pro', name: 'sms pro', version: 'v1.0', description: 'Disparo de SMS em massa' },
    { id: 'bulk button pro', name: 'Bulk Button Pro', version: 'v1.0', description: 'Botões em massa WhatsApp' },
    { id: 'business sender', name: 'Business Sender', version: 'v1.0', description: 'Disparador WhatsApp Business' },
    { id: 'social data extractor', name: 'Social Data Extractor', version: 'v1.0', description: 'Extrator de dados de redes sociais' },
    { id: 'lead google pro', name: 'Lead Google Pro', version: 'v1.0', description: 'Extrator de leads do Google Maps e Busca' },
    { id: 'wa sender', name: 'Wa Sender', version: 'v1.0', description: 'WhatsApp Sender profissional' },
    { id: 'linkedin', name: 'LinkedIn', version: 'v1.0', description: 'Extrator e automação para LinkedIn' },
    { id: 'crm', name: 'crm', version: 'v1.0', description: 'Sistema de gestão CRM' },
    { id: 'top', name: 'top', version: 'v1.0', description: 'Ferramenta Top de engajamento' },
    { id: 'botmaster', name: 'botmaster', version: 'v1.0', description: 'BotMaster automação' },
    { id: 'sender', name: 'sender', version: 'v1.0', description: 'Envio massivo multicanal' },
    { id: 'dszap', name: 'dszap', version: 'v1.0', description: 'Extensão de automação WhatsApp' },
    { id: 'lion', name: 'lion', version: 'v5.4', description: 'Módulo avançado Lion de disparos' },
    { id: 'whatsup', name: 'whatsup', version: 'v1.0', description: 'Monitoramento e extração de contatos WhatsApp' },
    { id: 'cnpj', name: 'cnpj', version: 'v1.0', description: 'Consulta e enriquecimento de CNPJ' },
    { id: 'pro', name: 'pro', version: 'v1.0', description: 'Módulo Pro de automações' },
    { id: 'email', name: 'email', version: 'v1.0', description: 'Disparador e extrator de Email' },
    { id: 'planeja', name: 'planeja', version: 'v1.0', description: 'Planejador de envios' },
    { id: 'lovable', name: 'lovable', version: 'v1.0', description: 'Integração e automação Lovable' },
    { id: 'smstop', name: 'smstop', version: 'v1.0', description: 'Gateway e automação SMS Top' },
    { id: 'maturador', name: 'maturador', version: 'v1.0', description: 'Maturador de chips WhatsApp' },
    { id: 'robopro', name: 'robopro', version: 'v1.0', description: 'Robô de automação inteligente' },
    { id: 'b2b', name: 'B2B', version: 'v1.0', description: 'Extrator de contatos B2B' },
    { id: 'youtube', name: 'youtube', version: 'v1.0', description: 'Extrator de leads e comentários YouTube' },
    { id: 'imagempro', name: 'imagempro', version: 'v1.0', description: 'Processamento e otimização de imagens' },
    { id: 'tele', name: 'tele', version: 'v1.0', description: 'Automação e robô Telegram' },
  ];

  for (const ext of extensions) {
    const existing = db.prepare('SELECT id FROM extensions WHERE id = ?').get(ext.id);
    if (!existing) {
      db.prepare(
        'INSERT INTO extensions (id, name, version, description, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(ext.id, ext.name, ext.version, ext.description, new Date().toISOString());
    } else {
      db.prepare('UPDATE extensions SET version = ?, name = ? WHERE id = ?').run(ext.version, ext.name, ext.id);
    }
  }

  // Clientes reais do print
  const clients = [
    { id: 'cli_alexxx', name: 'alexxx', email: 'vf@gmail.com' },
    { id: 'cli_ariana', name: 'ariana', email: 'arua@gmail.com' },
    { id: 'cli_plays', name: 'plays', email: 'pl@gmail.com' },
    { id: 'cli_aleeee', name: 'aleeee', email: 'cdcd@gmail.com' },
    { id: 'cli_useiptv', name: 'useiptv', email: 'bq@gmail.com' },
  ];

  for (const c of clients) {
    const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(c.id);
    if (!existing) {
      db.prepare('INSERT INTO clients (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
        c.id,
        c.name,
        c.email,
        new Date().toISOString()
      );
    }
  }

  // Licenças reais vistas no print
  const licenses = [
    { id: 'lic_1', key: 'EJUM-YHEM-UC96-J1VD', client: 'cli_alexxx', ext: 'dszap', status: 'active', expires: '2026-11-17' },
    { id: 'lic_2', key: '7NJH-3TU8-H8LJ-0VSV', client: 'cli_ariana', ext: 'tele', status: 'active', expires: '2026-11-15' },
    { id: 'lic_3', key: 'TPXG-WVXV-EH3Y-NDKN', client: 'cli_plays', ext: 'sender', status: 'active', expires: '2027-04-14' },
    { id: 'lic_4', key: 'U9SJ-Y079-LBTA-44KX', client: 'cli_aleeee', ext: 'youtube', status: 'active', expires: '2026-11-13' },
    { id: 'lic_5', key: 'BKHA-VPNY-3BVM-2SUM', client: 'cli_useiptv', ext: 'sender', status: 'active', expires: '2027-01-09' },
    { id: 'lic_6', key: 'SUSP-8821-K992-ZZ01', client: 'cli_alexxx', ext: 'tele', status: 'suspended', expires: '2026-12-01' },
    { id: 'lic_7', key: 'SUSP-3312-WW44-LL99', client: 'cli_plays', ext: 'youtube', status: 'suspended', expires: '2026-10-30' },
  ];

  for (const lic of licenses) {
    const existing = db.prepare('SELECT id FROM licenses WHERE id = ?').get(lic.id);
    if (!existing) {
      const client = clients.find((c) => c.id === lic.client)!;
      db.prepare(`
        INSERT INTO licenses (
          id, license_key, client_id, client_name, client_email, extension_id,
          status, expires_at, max_activations, current_activations, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(
        lic.id,
        lic.key,
        client.id,
        client.name,
        client.email,
        lic.ext,
        lic.status,
        lic.expires,
        new Date().toISOString(),
        new Date().toISOString()
      );
    }
  }

  // Preço padrão global de R$ 15,00 por emissão (1500 centavos)
  const defaultPricing = db.prepare('SELECT id FROM license_pricing WHERE extension_id IS NULL AND wallet_id IS NULL').get();
  if (!defaultPricing) {
    db.prepare(`
      INSERT INTO license_pricing (id, extension_id, wallet_id, price_cents, is_active, created_at, updated_at)
      VALUES ('prc_default', NULL, NULL, 1500, 1, ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());
  }

  // Carteira inicial do revendedor Smart Lojas com R$ 150,00 (15000 centavos) para testes
  const smartWallet = db.prepare("SELECT id FROM reseller_wallets WHERE reseller_id = 'res_smartlojas'").get();
  if (!smartWallet) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO reseller_wallets (
        id, reseller_id, name, email, balance_cents, total_credited_cents, total_debited_cents,
        total_licenses_generated, status, created_at, updated_at
      ) VALUES ('wal_smartlojas', 'res_smartlojas', 'Smart Lojas Bot', 'contato@smartlojas.com.br', 15000, 15000, 0, 0, 'active', ?, ?)
    `).run(now, now);

    // Transação inicial de crédito
    db.prepare(`
      INSERT INTO wallet_transactions (
        id, wallet_id, type, amount_cents, balance_before_cents, balance_after_cents,
        description, created_by, created_at
      ) VALUES ('tx_init_smart', 'wal_smartlojas', 'credit', 15000, 0, 15000, 'Saldo inicial autorizado (R$ 150,00)', 'admin_manual', ?)
    `).run(now);
  }
}

