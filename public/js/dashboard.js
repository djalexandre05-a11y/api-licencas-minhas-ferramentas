// 🔐 Proteção de Acesso: Redireciona para o login se não estiver autenticado
if (!localStorage.getItem('admin_token')) {
  window.location.href = '/login.html';
}

// Estado da Aplicação
let currentTab = 'tab-licenses';
let licensesData = [];
let extensionsData = [];

document.addEventListener('DOMContentLoaded', () => {
  // Exibe o email do admin logado
  const emailLabel = document.getElementById('admin-email-label');
  if (emailLabel) {
    emailLabel.innerText = localStorage.getItem('admin_email') || 'ONLINE';
  }

  initTabs();
  loadStats();
  loadLicenses();
  loadExtensions();
  loadApiKeys();
  loadWebhooks();
  loadRequestLogs();

  // Filtros de busca de licença
  document.getElementById('license-search-input')?.addEventListener('input', filterLicenses);
  document.getElementById('license-filter-select')?.addEventListener('change', filterLicenses);
});

function logoutAdmin() {
  if (confirm('Deseja realmente sair do painel?')) {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_email');
    window.location.href = '/login.html';
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const curPass = document.getElementById('cur-pass').value;
  const newPass = document.getElementById('new-pass').value;
  const confirmPass = document.getElementById('confirm-new-pass').value;

  if (newPass !== confirmPass) {
    alert('A nova senha e a confirmação não coincidem.');
    return;
  }

  try {
    const res = await fetch('/admin/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
    });

    const json = await res.json();
    if (json.success) {
      alert('Senha alterada com sucesso! Guarde sua nova senha.');
      document.getElementById('change-pass-form')?.reset();
    } else {
      alert('Erro: ' + (json.error?.message || 'Falha ao alterar senha'));
    }
  } catch (err) {
    alert('Erro de conexão ao alterar senha');
  }
}

// Navegação entre abas
function initTabs() {
  const menuItems = document.querySelectorAll('.menu-item[data-tab]');
  menuItems.forEach((item) => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      if (!targetTab) return;

      menuItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.tab-content').forEach((tab) => {
        tab.classList.remove('active');
      });

      const tabEl = document.getElementById(targetTab);
      if (tabEl) tabEl.classList.add('active');

      currentTab = targetTab;
      updateHeaderTitle(targetTab);

      // Recarrega dados específicos da aba
      if (targetTab === 'tab-licenses') loadLicenses();
      if (targetTab === 'tab-keys') loadApiKeys();
      if (targetTab === 'tab-monitoring') loadMonitoring();
      if (targetTab === 'tab-webhooks') loadWebhooks();
      if (targetTab === 'tab-security') loadRequestLogs();
    });
  });
}

function updateHeaderTitle(tabId) {
  const titleMap = {
    'tab-licenses': { title: 'Gerenciador de Licenças', sub: 'Controle de acessos, extensões ativas e integração REST API' },
    'tab-extensions': { title: 'Extensões Registradas', sub: 'Módulos e softwares autorizados a validar licenças' },
    'tab-keys': { title: '🔑 API Keys & Autenticação', sub: 'Chaves criptografadas (SHA-256) com controle de expiração e rate limit' },
    'tab-monitoring': { title: '📊 Monitoramento & Métricas', sub: 'Volume de requisições, tempo de resposta e performance' },
    'tab-webhooks': { title: '🔔 Webhooks & Eventos', sub: 'Disparo automatizado de notificações para sistemas externos' },
    'tab-security': { title: '🔐 Auditoria & Logs da API', sub: 'Rastreamento em tempo real de chamadas e segurança' },
    'tab-settings': { title: '⚙️ Configurações da API', sub: 'Parâmetros globais, limites e políticas de CORS' },
  };

  const info = titleMap[tabId] || titleMap['tab-licenses'];
  document.getElementById('page-title').innerText = info.title;
  document.getElementById('page-subtitle').innerText = info.sub;
}

// 1. CARREGAR ESTATÍSTICAS
async function loadStats() {
  try {
    const res = await fetch('/admin/api/stats');
    const json = await res.json();
    if (!json.success) return;

    const lic = json.data.licenses;
    const req = json.data.requests;

    document.getElementById('stat-total-licenses').innerText = lic.total;
    document.getElementById('stat-active-licenses').innerText = lic.active;
    document.getElementById('stat-expired-licenses').innerText = lic.expired;
    document.getElementById('stat-suspended-licenses').innerText = lic.suspended;

    // Monitoramento
    document.getElementById('mon-total-req').innerText = req.total;
    document.getElementById('mon-today-req').innerText = req.today;
    document.getElementById('mon-success-req').innerText = req.success;
    document.getElementById('mon-error-req').innerText = req.error;
    document.getElementById('mon-avg-time').innerText = `${req.avgResponseTimeMs} ms`;
  } catch (err) {
    console.error('Erro ao carregar estatísticas:', err);
  }
}

// 2. CARREGAR E RENDERIZAR LICENÇAS
async function loadLicenses() {
  try {
    loadStats();

    const licRes = await fetch('/api/v1/licenses?limit=100', {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    }).catch(() => null);

    let rows = [];
    if (licRes && licRes.ok) {
      const json = await licRes.json();
      rows = json.data.licenses || [];
    } else {
      const fallback = await fetch('/admin/api/licenses').catch(() => null);
      if (fallback) {
        const json = await fallback.json();
        rows = json.data || [];
      }
    }

    licensesData = rows;
    renderLicenses(licensesData);
  } catch (err) {
    console.error('Erro ao carregar licenças:', err);
  }
}

function renderLicenses(list) {
  const tbody = document.getElementById('licenses-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 32px;">Nenhuma licença encontrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((lic) => {
      const statusPill =
        lic.status === 'active'
          ? `<span class="status-badge active">● Ativa</span>`
          : lic.status === 'suspended'
          ? `<span class="status-badge suspended">● Suspensa</span>`
          : `<span class="status-badge expired">● Expirada</span>`;

      return `
      <tr>
        <td>
          <div class="key-code">
            <span>${lic.license_key}</span>
            <button class="copy-btn" onclick="copyToClipboard('${lic.license_key}')" title="Copiar Chave">
              <i class="fa-regular fa-copy"></i>
            </button>
          </div>
        </td>
        <td>
          <div class="client-info">
            <h4>${lic.client_name}</h4>
            <span>${lic.client_email}</span>
          </div>
        </td>
        <td>
          <span class="ext-badge">${lic.extension_id}</span>
        </td>
        <td>
          ${statusPill}
        </td>
        <td>
          <i class="fa-regular fa-calendar" style="color: #94a3b8; margin-right: 4px;"></i>
          ${formatDate(lic.expires_at)}
        </td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end;">
            ${
              lic.status === 'active'
                ? `<button class="action-icon-btn" onclick="toggleSuspendLicense('${lic.license_key}', 'suspend')" title="Suspender Licença"><i class="fa-solid fa-pause"></i></button>`
                : `<button class="action-icon-btn" onclick="toggleSuspendLicense('${lic.license_key}', 'activate')" title="Ativar Licença"><i class="fa-solid fa-play" style="color: #10b981;"></i></button>`
            }
            <button class="action-icon-btn danger" onclick="deleteLicense('${lic.license_key}')" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

function filterLicenses() {
  const query = document.getElementById('license-search-input')?.value.toLowerCase().trim() || '';
  const filter = document.getElementById('license-filter-select')?.value || 'all';

  const filtered = licensesData.filter((lic) => {
    const matchesQuery =
      lic.license_key.toLowerCase().includes(query) ||
      lic.client_name.toLowerCase().includes(query) ||
      lic.client_email.toLowerCase().includes(query);

    const matchesStatus = filter === 'all' || lic.status === filter;
    return matchesQuery && matchesStatus;
  });

  renderLicenses(filtered);
}

// 3. CARREGAR EXTENSÕES (Todas as ferramentas com o visual idêntico ao print)
async function loadExtensions() {
  try {
    const res = await fetch('/api/v1/extensions');
    const json = await res.json();
    if (!json.success) return;

    extensionsData = json.data || [];
    const tbody = document.getElementById('extensions-table-body');
    if (tbody) {
      if (extensionsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 24px;">Nenhuma ferramenta cadastrada.</td></tr>`;
      } else {
        tbody.innerHTML = extensionsData
          .map((ext) => {
            const initial = (ext.name || ext.id).trim().charAt(0).toUpperCase();
            return `
            <tr>
              <td>
                <div style="width: 32px; height: 32px; border-radius: 8px; background: #eef2ff; color: #4f46e5; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;">
                  ${initial}
                </div>
              </td>
              <td>
                <strong style="font-size: 14px; color: #0f172a;">${ext.name}</strong>
              </td>
              <td>
                <span class="ext-badge" style="background: #f1f5f9; color: #475569; font-weight: 600; padding: 3px 8px; border-radius: 6px; font-size: 12px;">
                  ${ext.version || 'v1.0'}
                </span>
              </td>
              <td style="color: #64748b; font-size: 13px;">
                ${formatDateLong(ext.created_at)}
              </td>
              <td style="text-align: right;">
                <button class="action-icon-btn danger" onclick="deleteExtension('${ext.id}')" title="Excluir Ferramenta">
                  <i class="fa-regular fa-trash-can"></i>
                </button>
              </td>
            </tr>
          `;
          })
          .join('');
      }
    }

    // Preenche o select no formulário de criar licença dinamicamente com todas as 20 ferramentas
    const licExtSelect = document.getElementById('lic-form-extension');
    if (licExtSelect) {
      licExtSelect.innerHTML = extensionsData
        .map((ext) => `<option value="${ext.id}">${ext.name} (${ext.version || 'v1.0'})</option>`)
        .join('');
    }
  } catch (err) {
    console.error('Erro ao carregar extensões:', err);
  }
}

function openCreateExtensionModal() {
  document.getElementById('modal-create-extension').classList.add('active');
}

async function submitCreateExtension(e) {
  e.preventDefault();
  const id = document.getElementById('ext-form-id').value.trim();
  const name = document.getElementById('ext-form-name').value.trim();
  const version = document.getElementById('ext-form-version').value.trim();
  const description = document.getElementById('ext-form-desc').value.trim();

  try {
    const res = await fetch('/api/v1/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, version, description }),
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modal-create-extension');
      loadExtensions();
      alert('Ferramenta cadastrada com sucesso!');
    } else {
      alert('Erro: ' + (json.error?.message || 'Falha ao cadastrar'));
    }
  } catch (err) {
    alert('Erro de conexão ao salvar ferramenta');
  }
}

async function deleteExtension(id) {
  if (!confirm(`Deseja realmente excluir a ferramenta "${id}"?`)) return;
  try {
    const res = await fetch(`/api/v1/extensions/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      loadExtensions();
    }
  } catch (err) {
    alert('Erro ao excluir ferramenta');
  }
}

function formatDateLong(dateStr) {
  if (!dateStr) return 'Recente';
  try {
    const d = new Date(dateStr);
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day} de ${month}. de ${year}`;
  } catch (_) {
    return dateStr;
  }
}

// 4. CARREGAR E GERENCIAR API KEYS
async function loadApiKeys() {
  try {
    const res = await fetch('/admin/api/keys');
    const json = await res.json();
    if (!json.success) return;

    const keys = json.data || [];
    const tbody = document.getElementById('keys-table-body');
    if (!tbody) return;

    if (keys.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 24px;">Nenhuma API Key gerada ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = keys
      .map((k) => {
        const perms = (k.permissions || []).map((p) => `<span class="ext-badge" style="font-size: 11px;">${p}</span>`).join(' ');
        const statusBadge = !k.is_active
          ? `<span class="status-badge expired">Revogada</span>`
          : k.is_blocked
          ? `<span class="status-badge suspended">Bloqueada</span>`
          : `<span class="status-badge active">Ativa</span>`;

        return `
        <tr>
          <td><strong>${k.name}</strong></td>
          <td><code style="background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 4px;">${k.key_prefix}</code></td>
          <td>${k.client_name}</td>
          <td>${perms}</td>
          <td>${k.rate_limit_per_min} req/min</td>
          <td><strong>${k.request_count}</strong> reqs</td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">
            <div class="actions-cell" style="justify-content: flex-end;">
              <button class="action-icon-btn" onclick="rotateApiKey('${k.id}')" title="Rotacionar Chave"><i class="fa-solid fa-arrows-rotate"></i></button>
              <button class="action-icon-btn" onclick="toggleBlockApiKey('${k.id}')" title="${k.is_blocked ? 'Desbloquear' : 'Bloquear'}"><i class="fa-solid fa-ban"></i></button>
              ${
                k.is_active
                  ? `<button class="action-icon-btn danger" onclick="revokeApiKey('${k.id}')" title="Revogar Chave"><i class="fa-solid fa-trash"></i></button>`
                  : ''
              }
            </div>
          </td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Erro ao carregar API Keys:', err);
  }
}

// 5. MONITORAMENTO
function loadMonitoring() {
  loadStats();
}

// 6. CARREGAR E GERENCIAR WEBHOOKS
async function loadWebhooks() {
  try {
    const res = await fetch('/admin/api/webhooks');
    const json = await res.json();
    if (!json.success) return;

    const hooks = json.data.webhooks || [];
    const deliveries = json.data.deliveries || [];

    const hooksTbody = document.getElementById('webhooks-table-body');
    if (hooksTbody) {
      if (hooks.length === 0) {
        hooksTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum webhook cadastrado.</td></tr>`;
      } else {
        hooksTbody.innerHTML = hooks
          .map(
            (h) => `
          <tr>
            <td><code>${h.url}</code></td>
            <td><span class="ext-badge">${h.events}</span></td>
            <td><code style="font-size: 11px;">${h.secret.slice(0, 10)}...</code></td>
            <td>${formatDate(h.created_at)}</td>
            <td style="text-align: right;">
              <button class="action-icon-btn danger" onclick="deleteWebhook('${h.id}')" title="Excluir Webhook"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>
        `
          )
          .join('');
      }
    }

    const delivTbody = document.getElementById('webhook-deliveries-body');
    if (delivTbody) {
      if (deliveries.length === 0) {
        delivTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum disparo registrado ainda.</td></tr>`;
      } else {
        delivTbody.innerHTML = deliveries
          .map(
            (d) => `
          <tr>
            <td><span class="ext-badge">${d.event}</span></td>
            <td><code>${d.webhook_url || '-'}</code></td>
            <td><strong>HTTP ${d.status_code || 0}</strong></td>
            <td>${d.success ? '<span class="status-badge active">Entregue</span>' : '<span class="status-badge expired">Falhou</span>'}</td>
            <td>${formatDate(d.delivered_at)}</td>
          </tr>
        `
          )
          .join('');
      }
    }
  } catch (err) {
    console.error('Erro ao carregar Webhooks:', err);
  }
}

// 7. CARREGAR LOGS DE REQUISIÇÃO (AUDITORIA)
async function loadRequestLogs() {
  try {
    const res = await fetch('/admin/api/logs?limit=40');
    const json = await res.json();
    if (!json.success) return;

    const logs = json.data || [];
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 24px;">Nenhuma requisição registrada ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map((l) => {
        const methodBadge =
          l.method === 'GET'
            ? `<span style="color: #0284c7; font-weight: 700;">GET</span>`
            : l.method === 'POST'
            ? `<span style="color: #10b981; font-weight: 700;">POST</span>`
            : l.method === 'DELETE'
            ? `<span style="color: #ef4444; font-weight: 700;">DELETE</span>`
            : `<span style="color: #f59e0b; font-weight: 700;">${l.method}</span>`;

        const statusBadge =
          l.status_code < 300
            ? `<span class="status-badge active">${l.status_code}</span>`
            : l.status_code < 400
            ? `<span class="status-badge suspended">${l.status_code}</span>`
            : `<span class="status-badge expired">${l.status_code}</span>`;

        return `
        <tr>
          <td>${methodBadge}</td>
          <td><code>${l.path}</code></td>
          <td>${statusBadge}</td>
          <td>${Math.round(l.response_time_ms)} ms</td>
          <td><span style="font-size: 12px; color: #64748b;">${l.key_name || 'Anônimo / Master'}</span></td>
          <td><code style="font-size: 11px;">${l.ip_address}</code></td>
          <td style="font-size: 12px; color: #94a3b8;">${formatDate(l.created_at)}</td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

// AÇÕES DE MODAIS & FORMULÁRIOS
function openCreateLicenseModal() {
  document.getElementById('modal-create-license').classList.add('active');
}
function openCreateKeyModal() {
  document.getElementById('modal-create-key').classList.add('active');
}
function openCreateWebhookModal() {
  document.getElementById('modal-create-webhook').classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// SUBMIT CRIAR LICENÇA
async function submitCreateLicense(e) {
  e.preventDefault();
  const clientName = document.getElementById('lic-form-client-name').value;
  const clientEmail = document.getElementById('lic-form-client-email').value;
  const extensionId = document.getElementById('lic-form-extension').value;
  const validityDays = Number(document.getElementById('lic-form-days').value) || 365;
  const customKey = document.getElementById('lic-form-custom-key').value;

  try {
    const res = await fetch('/api/v1/licenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
      body: JSON.stringify({ clientName, clientEmail, extensionId, validityDays, customKey: customKey || undefined }),
    });

    const json = await res.json();
    if (!json.success) {
      alert('Erro ao criar licença: ' + (json.error?.message || 'Falha'));
      return;
    }

    closeModal('modal-create-license');
    loadLicenses();
    alert('Licença criada com sucesso: ' + json.data.license_key);
  } catch (err) {
    alert('Erro de conexão ao criar licença');
  }
}

// SUBMIT GERAR API KEY
async function submitCreateKey(e) {
  e.preventDefault();
  const name = document.getElementById('key-form-name').value;
  const clientName = document.getElementById('key-form-client').value;
  const expiresInDays = document.getElementById('key-form-expires').value;
  const rateLimitPerMin = Number(document.getElementById('key-form-rate').value) || 100;

  const perms = Array.from(document.querySelectorAll('input[name="perm"]:checked')).map((el) => el.value);

  try {
    const res = await fetch('/admin/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clientName, permissions: perms, expiresInDays, rateLimitPerMin }),
    });

    const json = await res.json();
    if (!json.success) {
      alert('Erro ao gerar API Key: ' + (json.error?.message || 'Falha'));
      return;
    }

    closeModal('modal-create-key');
    loadApiKeys();

    // Abrir modal de revelação única
    document.getElementById('revealed-key-text').innerText = json.data.apiKey;
    document.getElementById('modal-reveal-key').classList.add('active');
  } catch (err) {
    alert('Erro de rede ao gerar API Key');
  }
}

// COPIAR CHAVE REVELADA
function copyRevealedKey() {
  const text = document.getElementById('revealed-key-text').innerText;
  copyToClipboard(text);
  alert('Chave de API copiada com sucesso para a área de transferência!');
}

// SUBMIT WEBHOOK
async function submitCreateWebhook(e) {
  e.preventDefault();
  const url = document.getElementById('webhook-form-url').value;
  const events = Array.from(document.querySelectorAll('input[name="whevent"]:checked')).map((el) => el.value);

  try {
    const res = await fetch('/admin/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events }),
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modal-create-webhook');
      loadWebhooks();
      alert('Webhook cadastrado com sucesso!');
    }
  } catch (err) {
    alert('Erro ao cadastrar webhook');
  }
}

// TESTAR DISPARO DE WEBHOOK
async function triggerTestWebhook() {
  try {
    const res = await fetch('/admin/api/webhooks/test', { method: 'POST' });
    const json = await res.json();
    alert('Evento de teste disparado! Verifique a tabela de entregas.');
    loadWebhooks();
  } catch (err) {
    alert('Erro ao disparar teste de webhook');
  }
}

// AÇÕES RÁPIDAS DE LICENÇA
async function toggleSuspendLicense(id, action) {
  try {
    const res = await fetch(`/api/v1/licenses/${id}/${action}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });
    const json = await res.json();
    if (json.success) {
      loadLicenses();
    }
  } catch (err) {
    alert('Erro ao alterar status da licença');
  }
}

async function deleteLicense(id) {
  if (!confirm('Deseja realmente excluir esta licença? Esta ação não pode ser desfeita.')) return;
  try {
    const res = await fetch(`/api/v1/licenses/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });
    const json = await res.json();
    if (json.success) {
      loadLicenses();
    }
  } catch (err) {
    alert('Erro ao excluir licença');
  }
}

// AÇÕES DE API KEY
async function revokeApiKey(id) {
  if (!confirm('Tem certeza que deseja revogar esta chave de API? Todas as integrações com ela pararão de funcionar imediatamente.')) return;
  const res = await fetch(`/admin/api/keys/${id}/revoke`, { method: 'POST' });
  const json = await res.json();
  if (json.success) loadApiKeys();
}

async function toggleBlockApiKey(id) {
  const res = await fetch(`/admin/api/keys/${id}/toggle-block`, { method: 'POST' });
  const json = await res.json();
  if (json.success) loadApiKeys();
}

async function rotateApiKey(id) {
  if (!confirm('Deseja rotacionar esta chave de API? A chave antiga deixará de funcionar e uma nova chave secreta será gerada.')) return;
  const res = await fetch(`/admin/api/keys/${id}/rotate`, { method: 'POST' });
  const json = await res.json();
  if (json.success) {
    loadApiKeys();
    document.getElementById('revealed-key-text').innerText = json.data.newApiKey;
    document.getElementById('modal-reveal-key').classList.add('active');
  }
}

async function deleteWebhook(id) {
  if (!confirm('Deseja excluir este webhook?')) return;
  const res = await fetch(`/admin/api/webhooks/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (json.success) loadWebhooks();
}

// UTILITÁRIOS
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Feedback sutil
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
  } catch (_) {
    return dateStr;
  }
}
