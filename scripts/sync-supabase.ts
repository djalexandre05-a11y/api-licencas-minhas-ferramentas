import { db } from '../src/database.js';

const SUPABASE_URL = 'https://yuwvwhcmuktuhrkgqmzu.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_Wt4Z2jX7WSS185v7mGTTEQ_WUeaOE4S';

async function sync() {
  console.log('🔄 Conectando ao Supabase oficial (leads.botao.centraloficial2.com.br)...');

  // 1. Obter Extensões reais
  const resExt = await fetch(SUPABASE_URL + 'extensions?select=*', {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const extensions = (await resExt.json()) as any[];
  console.log(`📦 Encontradas ${extensions.length} extensões no Supabase!`);

  for (const ext of extensions) {
    const existing = db.prepare('SELECT id FROM extensions WHERE id = ?').get(ext.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO extensions (id, name, version, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        ext.id,
        ext.name,
        ext.version || 'v1.0',
        `Extensão ${ext.name}`,
        ext.created_at || new Date().toISOString()
      );
    }
    // Também garante pelo nome (ex: "dszap")
    const existingName = db.prepare('SELECT id FROM extensions WHERE id = ?').get(ext.name);
    if (!existingName) {
      db.prepare(`
        INSERT INTO extensions (id, name, version, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        ext.name,
        ext.name,
        ext.version || 'v1.0',
        `Extensão ${ext.name}`,
        ext.created_at || new Date().toISOString()
      );
    }
  }

  // 2. Obter Licenças reais
  const resLic = await fetch(SUPABASE_URL + 'licenses?select=*', {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const licenses = (await resLic.json()) as any[];
  console.log(`🔑 Encontradas ${licenses.length} licenças no Supabase!`);

  let importedCount = 0;
  for (const lic of licenses) {
    const clientId = `cli_${lic.customer_email || lic.id}`;
    const clientName = lic.customer_name || 'Cliente';
    const clientEmail = lic.customer_email || `${lic.id.slice(0, 8)}@cliente.com`;

    // Cadastrar cliente se não existir
    const existingClient = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
    if (!existingClient) {
      try {
        db.prepare(`
          INSERT INTO clients (id, name, email, phone, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          clientId,
          clientName,
          clientEmail,
          lic.customer_phone || null,
          lic.created_at || new Date().toISOString()
        );
      } catch (_) {}
    }

    // Identificar a extensão
    let extensionId = lic.extension_name || lic.extension_id || 'dszap';
    const foundExt = extensions.find((e) => e.id === lic.extension_id);
    if (foundExt) extensionId = foundExt.name;

    // Inserir licença
    const existingLic = db.prepare('SELECT id FROM licenses WHERE license_key = ?').get(lic.license_key);
    if (!existingLic) {
      try {
        db.prepare(`
          INSERT INTO licenses (
            id, license_key, client_id, client_name, client_email, extension_id,
            status, expires_at, max_activations, current_activations, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          lic.id,
          lic.license_key,
          clientId,
          clientName,
          clientEmail,
          extensionId,
          lic.status || 'active',
          lic.expires_at ? lic.expires_at.split('T')[0] : '2027-12-31',
          lic.max_devices || 1,
          lic.created_at || new Date().toISOString(),
          new Date().toISOString()
        );
        importedCount++;
      } catch (_) {}
    }
  }

  const totalLic = (db.prepare('SELECT COUNT(*) as c FROM licenses').get() as any).c;
  const totalExt = (db.prepare('SELECT COUNT(*) as c FROM extensions').get() as any).c;

  console.log(`\n========================================================`);
  console.log(`🎉 SINCRONIZAÇÃO COMPLETA COM SUCESSO!`);
  console.log(`🔑 Licenças Novas Importadas: ${importedCount}`);
  console.log(`📊 Total Geral de Licenças no Sistema: ${totalLic}`);
  console.log(`🧩 Total Geral de Extensões Disponíveis: ${totalExt}`);
  console.log(`========================================================\n`);
}

sync().catch(console.error);
