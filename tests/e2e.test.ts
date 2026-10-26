import assert from 'node:assert';
import http from 'node:http';
import app from '../src/server.js';
import { ApiKeyService } from '../src/auth/apiKeyService.js';

async function runE2ETests() {
  console.log('🌐 Iniciando Testes End-to-End (E2E) HTTP da API REST...\n');

  const testPort = 3099;
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(testPort, () => resolve());
  });

  const baseUrl = `http://localhost:${testPort}`;

  try {
    // 1. Criar uma API Key para os testes
    const testKey = ApiKeyService.generateApiKey({
      name: 'Chave E2E',
      clientName: 'Robô de Teste E2E',
      permissions: ['read', 'write', 'licenses:verify'],
      rateLimitPerMin: 50,
    });

    console.log('▶ Teste E2E 1: Requisição sem token (Esperado 401 Unauthorized)');
    const resUnauth = await fetch(`${baseUrl}/api/v1/licenses`);
    const jsonUnauth = await resUnauth.json();
    assert.strictEqual(resUnauth.status, 401);
    assert.strictEqual(jsonUnauth.success, false);
    assert.strictEqual(jsonUnauth.error.code, 'UNAUTHORIZED');
    console.log('  ✔ Bloqueio 401 sem token funcionando perfeitamente!');

    console.log('▶ Teste E2E 2: Listar licenças com Bearer Token');
    const resAuth = await fetch(`${baseUrl}/api/v1/licenses`, {
      headers: { Authorization: `Bearer ${testKey.apiKey}` },
    });
    const jsonAuth = await resAuth.json();
    assert.strictEqual(resAuth.status, 200);
    assert.strictEqual(jsonAuth.success, true);
    assert(Array.isArray(jsonAuth.data.licenses));
    assert(jsonAuth.data.licenses.length > 0);
    assert(resAuth.headers.get('x-ratelimit-limit') === '50');
    console.log(`  ✔ Licenças recuperadas com sucesso! Headers de Rate Limit validados (Limit: ${resAuth.headers.get('x-ratelimit-limit')}, Remaining: ${resAuth.headers.get('x-ratelimit-remaining')})`);

    console.log('▶ Teste E2E 3: Verificação de Licença (POST /api/v1/licenses/verify)');
    const resVerify = await fetch(`${baseUrl}/api/v1/licenses/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testKey.apiKey}`,
      },
      body: JSON.stringify({
        licenseKey: 'EJUM-YHEM-UC96-J1VD',
        extensionId: 'dszap',
      }),
    });
    const jsonVerify = await resVerify.json();
    assert.strictEqual(resVerify.status, 200);
    assert.strictEqual(jsonVerify.success, true);
    assert.strictEqual(jsonVerify.data.valid, true);
    assert.strictEqual(jsonVerify.data.extensionId, 'dszap');
    console.log('  ✔ Verificação instantânea de licença para extensões validada com sucesso!');

    console.log('▶ Teste E2E 4: Verificação de Licença Suspensa (Esperado 403 Forbidden)');
    const resVerifySusp = await fetch(`${baseUrl}/api/v1/licenses/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testKey.apiKey}`,
      },
      body: JSON.stringify({
        licenseKey: 'SUSP-8821-K992-ZZ01',
      }),
    });
    const jsonVerifySusp = await resVerifySusp.json();
    assert.strictEqual(resVerifySusp.status, 403);
    assert.strictEqual(jsonVerifySusp.error.code, 'LICENSE_SUSPENDED');
    console.log('  ✔ Licença suspensa bloqueada com código 403 correto!');

    console.log('▶ Teste E2E 5: Criar nova Licença (POST /api/v1/licenses)');
    const resCreate = await fetch(`${baseUrl}/api/v1/licenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testKey.apiKey}`,
      },
      body: JSON.stringify({
        clientName: 'Cliente E2E Novo',
        clientEmail: 'e2e@teste.com',
        extensionId: 'youtube',
        validityDays: 180,
      }),
    });
    const jsonCreate = await resCreate.json();
    assert.strictEqual(resCreate.status, 201);
    assert.strictEqual(jsonCreate.success, true);
    assert(jsonCreate.data.license_key.length > 10);
    console.log(`  ✔ Nova licença gerada com sucesso! Chave: ${jsonCreate.data.license_key}`);

    console.log('▶ Teste E2E 6: Acesso à Especificação OpenAPI 3.1 (/api/openapi.json)');
    const resOpenApi = await fetch(`${baseUrl}/api/openapi.json`);
    const jsonOpenApi = await resOpenApi.json();
    assert.strictEqual(resOpenApi.status, 200);
    assert.strictEqual(jsonOpenApi.openapi, '3.1.0');
    assert(jsonOpenApi.paths['/api/v1/licenses/verify']);
    console.log('  ✔ Especificação OpenAPI 3.1 validada!');

    console.log('\n======================================================');
    console.log('🎉 TODOS OS TESTES E2E PASSARAM COM SUCESSO TOTAL!');
    console.log('======================================================\n');
  } finally {
    server.close();
  }
}

runE2ETests().catch((err) => {
  console.error('❌ Falha nos testes E2E:', err);
  process.exit(1);
});
