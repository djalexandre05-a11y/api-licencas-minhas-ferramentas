import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { ApiKeyService, ApiKeyRecord } from './apiKeyService.js';
import { db } from '../database.js';

// Extender o tipo Request do Express para carregar a API Key autenticada
declare global {
  namespace Express {
    interface Request {
      apiKeyRecord?: ApiKeyRecord;
      startTime?: number;
    }
  }
}

// Armazenamento em memória para Rate Limiting rápido (janela deslizante de 1 min)
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

// Limpeza periódica do mapa de rate limit a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitMap.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Middleware para registrar métricas e tempo de resposta de cada requisição
 */
export function requestTelemetryMiddleware(req: Request, res: Response, next: NextFunction) {
  req.startTime = Date.now();

  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const apiKeyId = req.apiKeyRecord ? req.apiKeyRecord.id : null;

    try {
      db.prepare(`
        INSERT INTO api_request_logs (
          id, api_key_id, method, path, status_code, response_time_ms,
          ip_address, user_agent, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        `log_${crypto.randomUUID()}`,
        apiKeyId,
        req.method,
        req.path,
        res.statusCode,
        duration,
        ip,
        userAgent,
        new Date().toISOString()
      );
    } catch (_) {}
  });

  next();
}

/**
 * Middleware de Autenticação por API Key e Verificação de Permissões
 */
export function requireApiKey(requiredPermission?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Extrair token do Authorization Header ou X-API-Key
    let token = '';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Chave de API não fornecida. Use Authorization: Bearer SUA_API_KEY',
        },
      });
      return;
    }

    // 2. Buscar e validar chave
    const keyRecord = ApiKeyService.getKeyByRawToken(token);
    if (!keyRecord) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Chave de API inválida ou inexistente',
        },
      });
      return;
    }

    // 3. Verificar se está ativa
    if (!keyRecord.is_active) {
      res.status(403).json({
        success: false,
        error: {
          code: 'REVOKED_API_KEY',
          message: 'Esta chave de API foi revogada',
        },
      });
      return;
    }

    // 4. Verificar se está bloqueada
    if (keyRecord.is_blocked) {
      res.status(403).json({
        success: false,
        error: {
          code: 'BLOCKED_API_KEY',
          message: 'Esta chave de API foi bloqueada por motivos de segurança',
        },
      });
      return;
    }

    // 5. Verificar expiração
    if (keyRecord.expires_at) {
      const expiresAt = new Date(keyRecord.expires_at).getTime();
      if (Date.now() > expiresAt) {
        res.status(403).json({
          success: false,
          error: {
            code: 'EXPIRED_API_KEY',
            message: `Esta chave de API expirou em ${keyRecord.expires_at}`,
          },
        });
        return;
      }
    }

    // 6. Verificar permissões
    if (requiredPermission) {
      const perms = keyRecord.permissions || [];
      const hasWildcard = perms.includes('*') || perms.includes('admin');
      const hasDirect = perms.includes(requiredPermission);

      if (!hasWildcard && !hasDirect) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `A chave de API não possui a permissão necessária: '${requiredPermission}'`,
          },
        });
        return;
      }
    }

    // 7. Rate Limiting por Chave
    const now = Date.now();
    const limit = keyRecord.rate_limit_per_min || 100;
    const bucketKey = `rate_${keyRecord.id}`;
    let bucket = rateLimitMap.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 1,
        resetAt: now + 60 * 1000,
      };
      rateLimitMap.set(bucketKey, bucket);
    } else {
      bucket.count += 1;
    }

    const remaining = Math.max(0, limit - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (bucket.count > limit) {
      res.setHeader('Retry-After', resetSeconds);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Limite de requisições excedido (${limit} req/min). Tente novamente em ${resetSeconds} segundos.`,
        },
      });
      return;
    }

    // Atualizar contador de uso
    ApiKeyService.recordUsage(keyRecord.id);
    req.apiKeyRecord = keyRecord;

    next();
  };
}
