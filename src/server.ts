import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import { initDatabase, db } from './database.js';
import { requestTelemetryMiddleware } from './auth/authMiddleware.js';
import { ApiKeyService } from './auth/apiKeyService.js';
import { licensesRouter } from './routes/v1/licenses.js';
import { extensionsRouter } from './routes/v1/extensions.js';
import { clientsRouter } from './routes/v1/clients.js';
import { accountRouter } from './routes/v1/account.js';
import { walletRouter } from './routes/v1/wallet.js';
import { adminRouter } from './routes/adminRoutes.js';
import { openApiSpec } from './docs/openapi.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializa o banco de dados
initDatabase();

// Assegura uma chave de teste inicial caso não exista nenhuma
const existingKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys').get() as any;
if (existingKeys.count === 0) {
  const masterKey = ApiKeyService.generateApiKey({
    name: 'Chave Master Padrão',
    clientName: 'Administrador do Sistema',
    permissions: ['*'],
    rateLimitPerMin: 1000,
  });
  console.log('----------------------------------------------------');
  console.log('🔑 CHAVE DE API INICIAL GERADA COM SUCESSO:');
  console.log(masterKey.apiKey);
  console.log('----------------------------------------------------');
}

// Middlewares essenciais
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestTelemetryMiddleware);

// Servir frontend do Painel e Documentação
const publicDir = path.resolve(process.cwd(), 'public');
app.use(express.static(publicDir));

// Rota para a especificação OpenAPI 3.1 em formato JSON
app.get('/api/openapi.json', (req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Rota para documentação interativa Swagger UI
app.get('/api/docs', (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'docs.html'));
});

// Rotas da API REST v1
app.use('/api/v1/licenses', licensesRouter);
app.use('/api/v1/extensions', extensionsRouter);
app.use('/api/v1/clients', clientsRouter);
app.use('/api/v1/account', accountRouter);
app.use('/api/v1/wallet', walletRouter);
app.use('/api/v1', walletRouter); // Para rota /api/v1/licenses/pricing e /api/v1/admin/wallets

// Rotas administrativas internas do Painel
app.use('/admin/api', adminRouter);

// Rota raiz para o painel
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/admin', (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Tratamento de rotas não encontradas no padrão JSON universal
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `A rota ${req.method} ${req.path} não foi encontrada. Consulte /api/docs para os endpoints disponíveis.`,
    },
  });
});

// Tratamento global de erros
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[API Server Error]:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro interno no servidor ao processar a requisição.',
    },
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Sistema Profissional de API REST rodando com sucesso!`);
    console.log(`📡 URL Base da API: http://localhost:${PORT}/api/v1/`);
    console.log(`📚 Documentação Interativa: http://localhost:${PORT}/api/docs`);
    console.log(`⚙️  Painel Administrativo: http://localhost:${PORT}/`);
  });
}

export default app;
