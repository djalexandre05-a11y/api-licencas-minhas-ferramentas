import assert from 'node:assert';
import { ApiKeyService } from '../src/auth/apiKeyService.js';
import { initDatabase, db } from '../src/database.js';

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes Automatizados do Sistema de API REST...\n');

  // Inicializa banco em memória/arquivo de teste
  initDatabase();

  // TESTE 1: Geração de API Key Criptografada
  console.log('▶ Teste 1: Geração de API Key Criptografada');
  const keyResult = ApiKeyService.generateApiKey({
    name: 'Chave de Teste Automatizado',
    clientName: 'Cliente Teste',
    permissions: ['read', 'licenses:verify'],
    expiresInDays: 30,
    rateLimitPerMin: 120,
  });

  assert(keyResult.apiKey.startsWith('sk_live_'), 'A chave deve iniciar com sk_live_');
  assert(keyResult.record.key_hash !== keyResult.apiKey, 'O banco não deve armazenar a chave em texto puro');
  assert.strictEqual(keyResult.record.rate_limit_per_min, 120, 'O rate limit deve ser 120');
  console.log('  ✔ Chave gerada com sucesso e hash SHA-256 armazenado com segurança!');

  // TESTE 2: Busca por Token Real
  console.log('▶ Teste 2: Validação da Chave por Token Real');
  const foundKey = ApiKeyService.getKeyByRawToken(keyResult.apiKey);
  assert(foundKey !== null, 'A chave válida deve ser encontrada');
  assert.strictEqual(foundKey?.id, keyResult.record.id);
  assert(foundKey?.permissions?.includes('licenses:verify'));
  console.log('  ✔ Chave identificada e permissões carregadas com sucesso!');

  // TESTE 3: Chave Inexistente / Incorreta
  console.log('▶ Teste 3: Rejeição de Chave Inválida');
  const invalidKey = ApiKeyService.getKeyByRawToken('sk_live_chave_falsa_que_nao_existe');
  assert.strictEqual(invalidKey, null, 'Chave falsa deve retornar null');
  console.log('  ✔ Chave falsa rejeitada com sucesso!');

  // TESTE 4: Rotação de Chave de API
  console.log('▶ Teste 4: Rotação de Chave');
  const rotated = ApiKeyService.rotateKey(keyResult.record.id);
  assert(rotated !== null, 'A rotação deve ter sucesso');
  assert(rotated.newApiKey !== keyResult.apiKey, 'A nova chave deve ser diferente da antiga');

  const oldLookup = ApiKeyService.getKeyByRawToken(keyResult.apiKey);
  assert.strictEqual(oldLookup, null, 'A chave antiga deve ser invalidada após rotação');

  const newLookup = ApiKeyService.getKeyByRawToken(rotated.newApiKey);
  assert(newLookup !== null, 'A nova chave deve ser autenticada normalmente');
  console.log('  ✔ Chave antiga invalidada e nova chave ativa com sucesso!');

  // TESTE 5: Revogação de Chave
  console.log('▶ Teste 5: Revogação de Chave');
  const revoked = ApiKeyService.revokeKey(keyResult.record.id);
  assert.strictEqual(revoked, true);
  const revokedKey = ApiKeyService.getKeyById(keyResult.record.id);
  assert.strictEqual(revokedKey?.is_active, 0, 'A chave revogada deve ter is_active = 0');
  console.log('  ✔ Chave revogada com sucesso!');

  // TESTE 6: Verificação de Licença no Banco
  console.log('▶ Teste 6: Consulta de Licença Existente');
  const lic = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get('EJUM-YHEM-UC96-J1VD') as any;
  assert(lic !== undefined, 'A licença seed EJUM-YHEM-UC96-J1VD deve existir');
  assert.strictEqual(lic.client_name, 'alexxx');
  assert.strictEqual(lic.extension_id, 'dszap');
  assert.strictEqual(lic.status, 'active');
  console.log('  ✔ Licençaseed carregada e dados verificados!');

  // TESTE 7: Verificação de Extensões
  console.log('▶ Teste 7: Consulta de Extensões Cadastradas');
  const exts = db.prepare('SELECT * FROM extensions').all() as any[];
  assert(exts.length >= 4, 'Devem existir pelo menos 4 extensões (dszap, tele, sender, youtube)');
  console.log(`  ✔ ${exts.length} extensões registradas e validadas!`);

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
