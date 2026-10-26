export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Autobot Telegram — Universal License & Integration REST API',
    version: '1.0.0',
    description: `API REST profissional para gerenciamento de licenças de software, extensões (dszap, tele, sender, youtube, etc.), autenticação segura por API Keys criptografadas, webhooks automáticos e rate limiting integrado.

### Autenticação
Todas as requisições autenticadas devem incluir a sua chave no cabeçalho:
\`\`\`http
Authorization: Bearer sk_live_...
\`\`\`
`,
    contact: {
      name: 'Suporte Autobot Telegram',
      email: 'autobotdigital515@gmail.com',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Servidor Atual (Produção / Vercel)',
    },
    {
      url: 'https://api-licencas-minhas-ferramentas.vercel.app',
      description: 'Servidor Oficial Vercel',
    },
    {
      url: 'http://localhost:3000',
      description: 'Servidor Local de Desenvolvimento',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key (sk_live_...)',
        description: 'Chave de API gerada no Painel Administrativo. Exemplo: `sk_live_...`',
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          message: { type: 'string', example: 'Operação realizada com sucesso' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INVALID_API_KEY' },
              message: { type: 'string', example: 'Chave de API inválida ou revogada' },
            },
          },
        },
      },
      License: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'lic_1' },
          license_key: { type: 'string', example: 'EJUM-YHEM-UC96-J1VD' },
          client_id: { type: 'string', example: 'cli_alexxx' },
          client_name: { type: 'string', example: 'alexxx' },
          client_email: { type: 'string', example: 'vf@gmail.com' },
          extension_id: { type: 'string', example: 'dszap' },
          status: { type: 'string', enum: ['active', 'expired', 'suspended'], example: 'active' },
          expires_at: { type: 'string', format: 'date', example: '2026-11-17' },
          max_activations: { type: 'integer', example: 1 },
          current_activations: { type: 'integer', example: 1 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      VerifyLicenseInput: {
        type: 'object',
        required: ['licenseKey'],
        properties: {
          licenseKey: { type: 'string', example: 'EJUM-YHEM-UC96-J1VD' },
          extensionId: { type: 'string', example: 'dszap' },
        },
      },
      CreateLicenseInput: {
        type: 'object',
        required: ['clientName', 'clientEmail', 'extensionId'],
        properties: {
          clientName: { type: 'string', example: 'Novo Cliente' },
          clientEmail: { type: 'string', format: 'email', example: 'cliente@exemplo.com' },
          extensionId: { type: 'string', example: 'dszap' },
          customKey: { type: 'string', example: 'CUSTOM-KEY-2026-ABCD' },
          validityDays: { type: 'integer', example: 365 },
        },
      },
    },
  },
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  paths: {
    '/api/v1/licenses/verify': {
      post: {
        summary: 'Verificação rápida de licença (Extensões & Bots)',
        description: 'Endpoint de altíssima performance para extensões de navegador e bots validarem se a licença está ativa e não expirada.',
        tags: ['Licenças'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/VerifyLicenseInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Licença válida e autorizada',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        valid: { type: 'boolean', example: true },
                        licenseKey: { type: 'string', example: 'EJUM-YHEM-UC96-J1VD' },
                        client: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', example: 'alexxx' },
                            email: { type: 'string', example: 'vf@gmail.com' },
                          },
                        },
                        extensionId: { type: 'string', example: 'dszap' },
                        status: { type: 'string', example: 'active' },
                        expiresAt: { type: 'string', example: '2026-11-17' },
                        daysRemaining: { type: 'integer', example: 388 },
                      },
                    },
                    message: { type: 'string', example: 'Licença válida e ativa' },
                  },
                },
              },
            },
          },
          '403': {
            description: 'Licença suspensa ou expirada',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '404': {
            description: 'Chave não encontrada',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/v1/licenses': {
      get: {
        summary: 'Listar todas as licenças',
        tags: ['Licenças'],
        parameters: [
          { name: 'q', in: 'query', description: 'Buscar por cliente, email ou chave', schema: { type: 'string' } },
          { name: 'status', in: 'query', description: 'Filtrar por status', schema: { type: 'string', enum: ['all', 'active', 'expired', 'suspended'] } },
          { name: 'extensionId', in: 'query', description: 'Filtrar por extensão', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Lista de licenças',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        licenses: { type: 'array', items: { $ref: '#/components/schemas/License' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Criar nova licença',
        tags: ['Licenças'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateLicenseInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Licença criada com sucesso',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
          },
        },
      },
    },
    '/api/v1/licenses/{id}/suspend': {
      post: {
        summary: 'Suspender uma licença',
        tags: ['Licenças'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Licença suspensa' },
        },
      },
    },
    '/api/v1/licenses/{id}/activate': {
      post: {
        summary: 'Ativar ou reativar uma licença',
        tags: ['Licenças'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Licença ativada' },
        },
      },
    },
    '/api/v1/extensions': {
      get: {
        summary: 'Listar extensões registradas',
        tags: ['Extensões'],
        responses: {
          '200': { description: 'Lista de extensões compatíveis' },
        },
      },
    },
    '/api/v1/clients': {
      get: {
        summary: 'Listar clientes',
        tags: ['Clientes'],
        responses: { '200': { description: 'Lista de clientes' } },
      },
    },
    '/api/v1/account': {
      get: {
        summary: 'Consultar dados e cotas da API Key atual',
        tags: ['Autenticação & Conta'],
        responses: { '200': { description: 'Dados da conta e consumo atual' } },
      },
    },
  },
};
