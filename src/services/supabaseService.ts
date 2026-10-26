/**
 * Serviço de Integração Bidirecional em Tempo Real com o Supabase
 * Garante que qualquer licença gerada pela API ou pelo Painel
 * seja gravada no Supabase oficial onde as extensões consultam.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuwvwhcmuktuhrkgqmzu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1d3Z3aGNtdWt0dWhya2dxbXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODM4ODQsImV4cCI6MjA4NTQ1OTg4NH0.dsTCbYPCXXy4R5Hx1Sww7JfedK0MYGzsmr282QvCxj0';

// Mapeamento de nomes de ferramentas para os UUIDs reais do Supabase
export const SUPABASE_EXTENSION_MAP: Record<string, string> = {
  'youtube': 'f414d27a-31e4-49ef-88c8-9250f58a8cf4',
  'dszap': '0f75aafd-6241-4c3c-b012-57bf36ff9ad7',
  'sender': '23c17007-cc16-4b41-85d8-134bfe8ef3a0',
  'tele': '61bf5cdd-5b20-41dc-9ad6-7af00e5105da',
  'email': '02f9b580-701e-4f88-98c7-987e1ac6beae',
  'imagempro': '547652fa-98e4-479a-a48b-5856dfe39e67',
  'lead google pro': '433c736e-8222-4382-88e3-46632e309fbc',
  'lead wave': 'c6e87697-be23-4052-8cc8-6599f0aef60e',
  'linkedin': '31037e81-c78e-4ab7-ac8e-87cdeb92f071',
  'robopro': 'a63fa36e-acf4-4701-a531-177dbc079a78',
  'wa sender': 'bbcd1d8d-f23b-4eb2-9b1c-81a94203e1ce',
  'sms pro': '3d8c266d-674a-48ca-890d-9fecf73c6922',
  'smstop': 'b30e915f-eba0-4906-8da7-95edd008d5e3',
  'maturador': 'e4e56456-b065-4fa2-95a4-ddabcbf83886',
  'lion': '760de1a3-d5ab-4548-b847-470c49771925',
  'whatsup': '8057e805-a861-470a-b138-317ce5e48243',
  'lovable': '02e10832-61a1-4abf-b217-ed24a7760395',
  'ultrabot': '00000000-0000-0000-0000-000000000000',
  'top': '87ecc332-4b84-4f6a-a5df-316c5d71bd75',
  'botmaster': '126210f7-36f1-4e5f-adb5-a718a8a4a914',
  'b2b': '70a374e7-a5f7-4465-91d8-982e35bb3742',
  'cnpj': '35f08291-fa22-4428-bc68-3580d3acc49e',
  'planeja': 'b5a94159-f0f6-491c-8b84-0f45aecdafd3',
  'social data extractor': 'f393cc66-7a16-4f6d-b316-0af8b8745b9b',
};

export class SupabaseService {
  /**
   * Resolve o UUID real da extensão no Supabase a partir do nome ou ID informado
   */
  static resolveExtensionUuid(nameOrId: string): string {
    const clean = String(nameOrId).trim().toLowerCase();
    if (SUPABASE_EXTENSION_MAP[clean]) {
      return SUPABASE_EXTENSION_MAP[clean];
    }
    // Se já for um UUID (formato com traços), retorna ele mesmo
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
      return clean;
    }
    return clean;
  }

  /**
   * Cria a licença diretamente no Supabase em tempo real
   */
  static async createLicense(license: {
    license_key: string;
    extension_id: string;
    customer_name: string;
    customer_email: string;
    status: string;
    expires_at: string;
    max_devices?: number;
  }): Promise<boolean> {
    try {
      const extUuid = this.resolveExtensionUuid(license.extension_id);

      const payload = {
        license_key: license.license_key,
        extension_id: extUuid,
        customer_name: license.customer_name,
        customer_email: license.customer_email,
        email: license.customer_email,
        status: license.status || 'active',
        expires_at: license.expires_at ? `${license.expires_at}T00:00:00` : null,
        max_devices: license.max_devices || 3,
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Supabase Create Error]:', res.status, errorText);
        return false;
      }

      console.log(`[Supabase Sync]: Licença ${license.license_key} gravada com sucesso no Supabase!`);
      return true;
    } catch (err) {
      console.error('[Supabase Sync Exception]:', err);
      return false;
    }
  }

  /**
   * Atualiza o status da licença no Supabase (active / suspended)
   */
  static async updateLicenseStatus(licenseKey: string, status: string): Promise<boolean> {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });

      return res.ok;
    } catch (err) {
      console.error('[Supabase Status Update Exception]:', err);
      return false;
    }
  }

  /**
   * Exclui a licença do Supabase
   */
  static async deleteLicense(licenseKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      });

      return res.ok;
    } catch (err) {
      console.error('[Supabase Delete Exception]:', err);
      return false;
    }
  }

  /**
   * Valida diretamente no Supabase se a licença está ativa
   */
  static async verifyLicense(licenseKey: string, extensionId?: string): Promise<{
    valid: boolean;
    license?: any;
    reason?: string;
  }> {
    try {
      let query = `${SUPABASE_URL}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}&select=*`;
      if (extensionId) {
        const extUuid = this.resolveExtensionUuid(extensionId);
        query += `&extension_id=eq.${encodeURIComponent(extUuid)}`;
      }

      const res = await fetch(query, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      });

      if (!res.ok) return { valid: false, reason: 'Erro ao consultar Supabase' };

      const rows = await res.json() as any[];
      if (!rows || rows.length === 0) {
        return { valid: false, reason: 'Licença não encontrada no Supabase' };
      }

      const lic = rows[0];
      if (lic.status !== 'active') {
        return { valid: false, reason: `Licença ${lic.status}`, license: lic };
      }

      if (lic.expires_at) {
        const expDate = new Date(lic.expires_at);
        if (expDate.getTime() < Date.now()) {
          return { valid: false, reason: 'Licença expirada', license: lic };
        }
      }

      return { valid: true, license: lic };
    } catch (err: any) {
      return { valid: false, reason: err.message };
    }
  }
}
