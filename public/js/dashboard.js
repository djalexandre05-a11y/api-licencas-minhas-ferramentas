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
  loadWallets();
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
      if (targetTab === 'tab-wallets') loadWallets();
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
    'tab-wallets': { title: '💰 Carteiras & Revendedores', sub: 'Gestão de saldo pré-pago, cobrança automática de R$ 15,00 por licença e recargas Pix' },
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
    const licRes = await fetch('/api/v1/licenses?limit=1000', {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    }).catch(() => null);

    let rows = [];
    if (licRes && licRes.ok) {
      const json = await licRes.json();
      rows = json.data?.licenses || [];
    }
    
    if (rows.length === 0) {
      const fallback = await fetch('/admin/api/licenses').catch(() => null);
      if (fallback) {
        const json = await fallback.json();
        rows = json.data || [];
      }
    }

    licensesData = rows;
    renderLicenses(licensesData);
    updateCardCounts();
    loadStats();
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
      const statusClass = lic.status === 'active' ? 'active' : lic.status === 'suspended' ? 'suspended' : 'expired';
      const statusLabel = lic.status === 'active' ? 'Ativa' : lic.status === 'suspended' ? 'Suspensa' : 'Expirada';

      return `
      <tr id="row-${lic.license_key}">
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
            <h4>${lic.client_name || 'Cliente'}</h4>
            <span>${lic.client_email || ''}</span>
          </div>
        </td>
        <td>
          <span class="ext-badge">${lic.extension_id}</span>
        </td>
        <td>
          <div class="status-dropdown-container" id="status-container-${lic.license_key}">
            <button class="status-pill-btn ${statusClass}" id="status-btn-${lic.license_key}" onclick="toggleStatusMenu(event, '${lic.license_key}')" title="Alterar Status">
              <span id="status-label-${lic.license_key}">${statusLabel}</span>
              <i class="fa-solid fa-chevron-down" style="font-size: 10px; margin-left: 4px;"></i>
            </button>
            <div class="status-dropdown-menu" id="status-menu-${lic.license_key}">
              <div class="status-dropdown-item ${lic.status === 'active' ? 'selected' : ''}" onclick="selectStatus(event, '${lic.license_key}', 'active')">
                <span class="status-dot green"></span> Ativa
              </div>
              <div class="status-dropdown-item ${lic.status === 'suspended' ? 'selected' : ''}" onclick="selectStatus(event, '${lic.license_key}', 'suspended')">
                <span class="status-dot amber"></span> Suspensa
              </div>
              <div class="status-dropdown-item ${lic.status === 'expired' ? 'selected' : ''}" onclick="selectStatus(event, '${lic.license_key}', 'expired')">
                <span class="status-dot red"></span> Expirada
              </div>
            </div>
          </div>
        </td>
        <td>
          <i class="fa-regular fa-calendar" style="color: #94a3b8; margin-right: 4px;"></i>
          ${formatDate(lic.expires_at)}
        </td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end;">
            <button class="action-icon-btn" onclick="openEditLicenseModal('${lic.license_key}')" title="Editar Licença"><i class="fa-solid fa-pencil" style="font-size: 13px;"></i></button>
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

// SUBMIT CRIAR LICENÇA COM INSERÇÃO IMEDIATA NA TELA (SEM RELOAD)
async function submitCreateLicense(e) {
  e.preventDefault();
  const clientName = document.getElementById('lic-form-client-name').value.trim();
  const clientEmail = document.getElementById('lic-form-client-email').value.trim();
  const extensionId = document.getElementById('lic-form-extension').value;
  const validityDays = Number(document.getElementById('lic-form-days').value) || 365;
  const customKey = document.getElementById('lic-form-custom-key').value.trim();

  // Fecha o modal na hora para resposta imediata
  closeModal('modal-create-license');
  showToast('Gerando chave e sincronizando com Supabase...', 'info');

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
      showToast('Erro ao criar licença: ' + (json.error?.message || 'Falha'), 'error');
      return;
    }

    const created = json.data;
    const newLic = {
      id: created.id || created.license_key,
      license_key: created.license_key,
      client_name: created.client_name || clientName,
      client_email: created.client_email || clientEmail,
      extension_id: created.extension_id || extensionId,
      status: 'active',
      expires_at: created.expires_at,
      created_at: new Date().toISOString(),
    };

    // Insere no topo da lista em memória e re-renderiza NA HORA na tela!
    licensesData.unshift(newLic);
    renderLicenses(licensesData);
    updateCardCounts();

    showToast(`Licença criada e ativa no Supabase: ${created.license_key}`, 'success');

    // Limpa os campos do formulário
    document.getElementById('lic-form-client-name').value = '';
    document.getElementById('lic-form-client-email').value = '';
    document.getElementById('lic-form-custom-key').value = '';
  } catch (err) {
    showToast('Erro de conexão ao criar licença', 'error');
  }
}

// DROPDOWN DE STATUS (IDÊNTICO AO PRINT)
function toggleStatusMenu(event, key) {
  event.stopPropagation();
  const currentMenu = document.getElementById(`status-menu-${key}`);
  const isShown = currentMenu?.classList.contains('show');

  // Fecha todos os menus abertos
  document.querySelectorAll('.status-dropdown-menu.show').forEach((menu) => {
    menu.classList.remove('show');
  });

  if (!isShown && currentMenu) {
    currentMenu.classList.add('show');
  }
}

// Fecha menus ao clicar fora
document.addEventListener('click', () => {
  document.querySelectorAll('.status-dropdown-menu.show').forEach((menu) => {
    menu.classList.remove('show');
  });
});

// SELECIONAR STATUS DIRETO PELO DROPDOWN
async function selectStatus(event, licenseKey, newStatus) {
  event.stopPropagation();

  // Fecha o menu
  const menu = document.getElementById(`status-menu-${licenseKey}`);
  if (menu) menu.classList.remove('show');

  // Atualiza visualmente NA HORA no DOM
  const btn = document.getElementById(`status-btn-${licenseKey}`);
  const label = document.getElementById(`status-label-${licenseKey}`);
  if (btn && label) {
    btn.className = `status-pill-btn ${newStatus}`;
    label.innerText = newStatus === 'active' ? 'Ativa' : newStatus === 'suspended' ? 'Suspensa' : 'Expirada';
  }

  // Atualiza no array em memória
  const lic = licensesData.find((l) => l.license_key === licenseKey);
  if (lic) lic.status = newStatus;

  // Atualiza contadores nos cards
  updateCardCounts();

  const labelPt = newStatus === 'active' ? 'Ativa' : newStatus === 'suspended' ? 'Suspensa' : 'Expirada';
  showToast(`Status alterado para ${labelPt}`, 'success');

  // Sincroniza em background com a API e Supabase
  try {
    const endpoint = newStatus === 'suspended' ? 'suspend' : 'activate';
    await fetch(`/api/v1/licenses/${licenseKey}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });
  } catch (err) {
    console.error('Erro ao sincronizar status:', err);
    showToast('Falha ao sincronizar status na nuvem', 'error');
  }
}

// ATUALIZA OS CONTADORES DOS CARDS EM TEMPO REAL
function updateCardCounts() {
  const total = licensesData.length;
  const active = licensesData.filter((l) => l.status === 'active').length;
  const suspended = licensesData.filter((l) => l.status === 'suspended').length;
  const expired = licensesData.filter((l) => l.status === 'expired').length;

  const totalEl = document.getElementById('stat-total-licenses');
  const activeEl = document.getElementById('stat-active-licenses');
  const suspEl = document.getElementById('stat-suspended-licenses');
  const expEl = document.getElementById('stat-expired-licenses');

  if (totalEl) totalEl.innerText = total;
  if (activeEl) activeEl.innerText = active;
  if (suspEl) suspEl.innerText = suspended;
  if (expEl) expEl.innerText = expired;
}

// EXCLUIR LICENÇA COM REMOÇÃO INSTANTÂNEA DA TELA
async function deleteLicense(key) {
  if (!confirm(`Deseja realmente excluir a licença ${key}? Esta ação não pode ser desfeita.`)) return;

  // Remove da tela NA HORA
  const row = document.getElementById(`row-${key}`);
  if (row) row.remove();

  licensesData = licensesData.filter((l) => l.license_key !== key);
  updateCardCounts();
  showToast('Licença excluída com sucesso', 'info');

  // Remove no banco e Supabase em background
  try {
    await fetch(`/api/v1/licenses/${key}`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });
  } catch (err) {
    console.error('Erro ao excluir:', err);
  }
}

// EDITAR LICENÇA
function openEditLicenseModal(key) {
  const lic = licensesData.find((l) => l.license_key === key);
  if (!lic) return;
  const newName = prompt(`Editar nome do cliente para ${key}:`, lic.client_name || '');
  if (newName === null) return;
  lic.client_name = newName.trim() || lic.client_name;
  renderLicenses(licensesData);
  showToast('Dados da licença atualizados', 'success');
}

// TOAST NOTIFICATIONS PROFISSIONAIS (SEM TRAVAR COM ALERT)
function showToast(message, type = 'success') {
  let container = document.getElementById('global-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'global-toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-xmark' : 'fa-circle-info';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
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
    showToast('Chave copiada para a área de transferência!', 'success');
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

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return dateStr;
  }
}

// ==========================================
// 💰 GESTÃO DE CARTEIRAS E REVENDEDORES
// ==========================================
let walletsData = [];

async function loadWallets() {
  try {
    const res = await fetch('/api/v1/admin/wallets', {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });

    const json = await res.json();
    if (!json.success) return;

    walletsData = json.data || [];

    // Calcula métricas
    let totalBalanceCents = 0;
    let totalCreditedCents = 0;
    let totalDebitedCents = 0;
    let totalLicenses = 0;

    walletsData.forEach((w) => {
      totalBalanceCents += w.balance_cents || 0;
      totalCreditedCents += w.total_credited_cents || 0;
      totalDebitedCents += w.total_debited_cents || 0;
      totalLicenses += w.total_licenses_generated || 0;
    });

    const balEl = document.getElementById('wallet-stat-total-balance');
    const topEl = document.getElementById('wallet-stat-total-topups');
    const conEl = document.getElementById('wallet-stat-total-consumed');

    if (balEl) balEl.innerText = `R$ ${(totalBalanceCents / 100).toFixed(2)}`;
    if (topEl) topEl.innerText = `R$ ${(totalCreditedCents / 100).toFixed(2)}`;
    if (conEl) conEl.innerText = `R$ ${(totalDebitedCents / 100).toFixed(2)}`;

    // Renderiza tabela de carteiras
    renderWalletsTable(walletsData);

    // Carrega extrato global
    loadWalletTransactions();

    // Popula select da modal de recarga
    populateTopupWalletSelect(walletsData);
  } catch (err) {
    console.error('Erro ao carregar carteiras:', err);
  }
}

function renderWalletsTable(list) {
  const tbody = document.getElementById('wallets-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 24px;">Nenhuma carteira de revendedor cadastrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((w) => {
      const statusPill =
        w.status === 'active'
          ? `<span class="status-badge active" style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">● Ativa</span>`
          : `<span class="status-badge suspended" style="background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">● Bloqueada</span>`;

      return `
      <tr>
        <td>
          <div style="font-weight: 600; color: #0f172a;">${w.name}</div>
          <span style="font-size: 12px; color: #64748b;">${w.email}</span>
        </td>
        <td>
          <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${w.reseller_id}</code>
        </td>
        <td>
          <span style="font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 8px; font-size: 14px;">
            R$ ${w.balance_brl}
          </span>
        </td>
        <td>R$ ${w.total_credited_brl}</td>
        <td>R$ ${w.total_debited_brl}</td>
        <td><strong>${w.total_licenses_generated}</strong></td>
        <td>${statusPill}</td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end; gap: 6px;">
            <button class="btn-primary" style="padding: 4px 10px; font-size: 12px; background: #10b981;" onclick="openTopupModal('${w.id}')" title="Adicionar Saldo">
              <i class="fa-solid fa-plus"></i> Saldo
            </button>
            <button class="action-icon-btn" onclick="openAdjustModal('${w.id}', '${w.name}', '${w.balance_brl}')" title="Ajuste Manual">
              <i class="fa-solid fa-scale-balanced" style="font-size: 13px;"></i>
            </button>
            <button class="action-icon-btn ${w.status === 'active' ? 'danger' : ''}" onclick="toggleBlockWallet('${w.id}')" title="${w.status === 'active' ? 'Bloquear Carteira' : 'Desbloquear Carteira'}">
              <i class="fa-solid ${w.status === 'active' ? 'fa-ban' : 'fa-check'}"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

async function loadWalletTransactions() {
  const tbody = document.getElementById('transactions-table-body');
  if (!tbody) return;

  try {
    // Busca transações da primeira carteira ou do revendedor principal
    const targetWallet = walletsData[0];
    if (!targetWallet) return;

    const res = await fetch(`/api/v1/wallet/transactions?limit=25`, {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });

    const json = await res.json();
    const list = json.data?.transactions || [];

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 24px;">Nenhuma movimentação financeira registrada ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((tx) => {
        const typeBadge =
          tx.type === 'credit'
            ? `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">+ CRÉDITO</span>`
            : tx.type === 'debit'
            ? `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">- DÉBITO</span>`
            : `<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">⚖ AJUSTE</span>`;

        const amountColor = tx.type === 'credit' ? '#15803d' : tx.type === 'debit' ? '#b91c1c' : '#334155';
        const sign = tx.type === 'credit' ? '+' : tx.type === 'debit' ? '-' : '';

        return `
        <tr>
          <td style="font-size: 12px; color: #64748b;">${formatDateTime(tx.created_at)}</td>
          <td>${typeBadge}</td>
          <td style="font-weight: 700; color: ${amountColor}; font-size: 13.5px;">${sign} R$ ${tx.amount_brl}</td>
          <td style="font-weight: 600; color: #0f172a;">R$ ${tx.balance_after_brl}</td>
          <td><span style="font-size: 13px; color: #334155;">${tx.description}</span></td>
          <td><code style="font-size: 11px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${tx.idempotency_key || tx.reference_id || '-'}</code></td>
          <td><span style="font-size: 12px; color: #64748b;">${tx.created_by}</span></td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Erro ao carregar transações:', err);
  }
}

function populateTopupWalletSelect(wallets) {
  const select = document.getElementById('topup-wallet-select');
  if (!select) return;

  select.innerHTML = (wallets || [])
    .map((w) => `<option value="${w.id}">${w.name} (${w.email}) — Saldo atual: R$ ${w.balance_brl}</option>`)
    .join('');
}

async function openTopupModal(walletId) {
  if (!walletsData || walletsData.length === 0) {
    await loadWallets();
  }
  populateTopupWalletSelect(walletsData);
  if (walletId) {
    const select = document.getElementById('topup-wallet-select');
    if (select) select.value = walletId;
  }
  const modal = document.getElementById('modal-topup-wallet');
  if (modal) modal.classList.add('active');
}

async function submitTopupWallet(e) {
  e.preventDefault();
  const select = document.getElementById('topup-wallet-select');
  const walletId = select ? select.value : '';
  const amount = Number(document.getElementById('topup-amount')?.value);
  const paymentMethod = document.getElementById('topup-method')?.value || 'pix_manual';
  const externalId = document.getElementById('topup-external-id')?.value?.trim() || '';
  const notes = document.getElementById('topup-notes')?.value?.trim() || '';

  if (!walletId || isNaN(amount) || amount <= 0) {
    showToast('Informe um valor de recarga válido', 'error');
    return;
  }

  closeModal('modal-topup-wallet');
  showToast('Processando recarga na carteira...', 'info');

  try {
    const res = await fetch(`/api/v1/admin/wallets/${walletId}/credit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
      body: JSON.stringify({ amount, paymentMethod, externalId, notes }),
    });

    const json = await res.json();
    if (json.success) {
      showToast(`Recarga de R$ ${amount.toFixed(2)} creditada com sucesso! Novo saldo: R$ ${json.data.new_balance_brl}`, 'success');
      loadWallets();
    } else {
      showToast('Erro: ' + (json.error?.message || 'Falha ao creditar saldo'), 'error');
    }
  } catch (err) {
    showToast('Erro de rede ao adicionar saldo', 'error');
  }
}

function openAdjustModal(walletId, walletName, currentBalance) {
  const modal = document.getElementById('modal-adjust-wallet');
  const wId = document.getElementById('adjust-wallet-id');
  const wName = document.getElementById('adjust-wallet-name');
  const wBal = document.getElementById('adjust-new-balance');
  const wReason = document.getElementById('adjust-reason');

  if (wId) wId.value = walletId;
  if (wName) wName.value = `${walletName} (Saldo Atual: R$ ${currentBalance})`;
  if (wBal) wBal.value = currentBalance;
  if (wReason) wReason.value = '';
  if (modal) modal.classList.add('active');
}

async function submitAdjustWallet(e) {
  e.preventDefault();
  const walletId = document.getElementById('adjust-wallet-id')?.value;
  const newBalance = Number(document.getElementById('adjust-new-balance')?.value);
  const reason = document.getElementById('adjust-reason')?.value?.trim();

  if (isNaN(newBalance) || newBalance < 0 || !reason) {
    showToast('Preencha o novo saldo e o motivo do ajuste', 'error');
    return;
  }

  closeModal('modal-adjust-wallet');
  showToast('Aplicando ajuste financeiro...', 'info');

  try {
    const res = await fetch(`/api/v1/admin/wallets/${walletId}/adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
      body: JSON.stringify({ newBalance, reason }),
    });

    const json = await res.json();
    if (json.success) {
      showToast(`Saldo ajustado para R$ ${json.data.adjusted_balance_brl} com sucesso!`, 'success');
      loadWallets();
    } else {
      showToast('Erro: ' + (json.error?.message || 'Falha ao ajustar saldo'), 'error');
    }
  } catch (err) {
    showToast('Erro de rede ao ajustar saldo', 'error');
  }
}

async function toggleBlockWallet(walletId) {
  if (!confirm('Deseja realmente alterar o status de bloqueio desta carteira?')) return;

  try {
    const res = await fetch(`/api/v1/admin/wallets/${walletId}/toggle-block`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || 'sess_master'),
        'x-admin-session': 'true',
      },
    });

    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      loadWallets();
    }
  } catch (err) {
    showToast('Erro ao alterar status da carteira', 'error');
  }
}

// Vincula todas as funções de modal e ações explicitamente no objeto window global
window.openTopupModal = openTopupModal;
window.submitTopupWallet = submitTopupWallet;
window.openAdjustModal = openAdjustModal;
window.submitAdjustWallet = submitAdjustWallet;
window.toggleBlockWallet = toggleBlockWallet;
window.loadWallets = loadWallets;
window.closeModal = closeModal;


