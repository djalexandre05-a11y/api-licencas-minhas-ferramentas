# 🚀 ZapFlow Universal License & REST API Platform

Sistema completo e profissional de API REST com geração e gerenciamento de API Keys criptografadas, autenticação segura por Bearer Token, controle de acesso/rate limit por minuto, documentação automática OpenAPI 3.1 + Swagger UI, webhooks assinados com HMAC SHA-256 e Painel Administrativo de alta performance.

---

## 📌 Funcionalidades Principais

- **🔑 Gerador Criptográfico de API Keys**: Chaves com prefixo seguro `sk_live_...`, hash SHA-256 no banco de dados (nunca em texto puro), com rotação de chaves e revogação imediata.
- **🛡️ Autenticação & Rate Limiting**: Proteção com Bearer Token (`Authorization: Bearer sk_live_...`), cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` e código HTTP 429 configurável por chave ou IP.
- **⚡ Endpoint de Verificação Instantânea para Extensões**: `POST /api/v1/licenses/verify` para extensões (`dszap`, `tele`, `sender`, `youtube`) e bots validarem licenças em tempo recorde.
- **📚 Documentação OpenAPI 3.1 Interativa**: Swagger UI acessível em `/api/docs` com suporte ao botão "Testar Endpoint".
- **🔔 Webhooks Automatizados**: Assinatura criptográfica HMAC SHA-256 nos cabeçalhos (`X-Webhook-Signature`, `X-Webhook-Timestamp`, `X-Webhook-Id`) e reenvio automático em caso de falha.
- **📊 Telemetria & Logs em Tempo Real**: Rastreamento de tempo de resposta em milissegundos, IP de origem, status code e taxa de sucesso.
- **🖥️ Painel Administrativo Moderno**: Interface responsiva, com a identidade visual dos sistemas de gerenciamento de licenças e extensões.

---

## 🛠️ Como Executar Localmente

### Pré-requisitos
- Node.js v18+ (testado no Node.js v24.16.0)

### Instalação e Execução
```bash
# 1. Entrar na pasta do projeto
cd "C:\Users\Alexandre\.gemini\antigravity-ide\scratch\license-api-system"

# 2. Instalar dependências (já instaladas)
npm install

# 3. Executar em modo desenvolvimento
npm run dev

# 4. Executar os testes automatizados
npm test
```

---

## 🌐 URLs de Acesso

- **Painel Administrativo**: [http://localhost:3000/](http://localhost:3000/)
- **Documentação Swagger UI**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- **Especificação OpenAPI JSON**: [http://localhost:3000/api/openapi.json](http://localhost:3000/api/openapi.json)
- **Base da API REST v1**: `http://localhost:3000/api/v1/`

---

## 📡 Endpoints Disponíveis

| Método | Endpoint | Permissão | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/licenses/verify` | `licenses:verify` | Verificação rápida para extensões e bots |
| `GET` | `/api/v1/licenses` | `read` | Listar licenças com busca e filtros |
| `POST` | `/api/v1/licenses` | `write` | Criar nova licença (com código ou automático) |
| `GET` | `/api/v1/licenses/:id` | `read` | Detalhes de uma licença específica |
| `POST` | `/api/v1/licenses/:id/suspend` | `write` | Suspender licença |
| `POST` | `/api/v1/licenses/:id/activate` | `write` | Ativar ou reativar licença |
| `DELETE` | `/api/v1/licenses/:id` | `write` | Excluir licença |
| `GET` | `/api/v1/extensions` | `read` | Listar softwares e extensões compatíveis |
| `GET` | `/api/v1/clients` | `read` | Listar clientes cadastrados |
| `POST` | `/api/v1/clients` | `write` | Cadastrar novo cliente |
| `GET` | `/api/v1/account` | `read` | Consultar limites e consumo da API Key |

---

## 💻 Exemplos de Integração

### 1. JavaScript / Node.js
```javascript
const response = await fetch('http://localhost:3000/api/v1/licenses/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk_live_SUA_CHAVE_AQUI'
  },
  body: JSON.stringify({
    licenseKey: 'EJUM-YHEM-UC96-J1VD',
    extensionId: 'dszap'
  })
});

const data = await response.json();
console.log(data);
```

### 2. Python
```python
import requests

url = "http://localhost:3000/api/v1/licenses/verify"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk_live_SUA_CHAVE_AQUI"
}
payload = {
    "licenseKey": "EJUM-YHEM-UC96-J1VD",
    "extensionId": "dszap"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

### 3. cURL
```bash
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk_live_SUA_CHAVE_AQUI" \
  -d '{
    "licenseKey": "EJUM-YHEM-UC96-J1VD",
    "extensionId": "dszap"
  }'
```
