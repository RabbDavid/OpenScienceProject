import type { RequestHandler } from 'express';
import { ApiError } from './store.ts';

const queries: Record<string, readonly string[]> = {
  '/api/v1/skills': ['ids'],
  '/api/v1/sources': ['field'],
  '/api/v1/papers': ['field', 'q', 'limit', 'offset'],
  '/api/v1/tasks': ['field', 'status', 'q', 'limit', 'offset'],
  '/api/v1/contributions': ['task', 'status', 'limit', 'offset'],
  '/api/v1/events': ['after', 'limit'],
};

/** Cheap process-local admission before authentication, body parsing and database work.
 * This does not protect function-invocation/CDN quotas and is not a distributed limiter. */
export function requestAdmission(limit = 120): RequestHandler {
  let resetAt = Date.now() + 60_000;
  let count = 0;
  return (req, _res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
    if (
      !(path === '/api' || path.startsWith('/api/') || path === '/.well-known/openscience.json') ||
      path === '/api/health'
    ) {
      next();
      return;
    }
    const stamp = Date.now();
    if (stamp >= resetAt) {
      count = 0;
      resetAt = stamp + 60_000;
    }
    if (++count > limit) {
      next(
        new ApiError(
          429,
          'request_rate_limited',
          'Request limit reached for this service instance. Retry in one minute.',
        ),
      );
      return;
    }
    if (Buffer.byteLength(req.originalUrl, 'utf8') > 2048) {
      next(new ApiError(414, 'request_target_too_long', 'Request URL exceeds 2048 UTF-8 bytes.'));
      return;
    }
    const allowed =
      req.method === 'GET' || req.method === 'HEAD'
        ? (queries[path] ??
          (/^\/api\/v1\/tasks\/[^/]+\/context$/.test(path)
            ? ['max_bytes']
            : /^\/api\/v1\/contributions\/[^/]+$/.test(path)
              ? ['revision']
              : []))
        : [];
    for (const [key, value] of Object.entries(req.query)) {
      if (!allowed.includes(key) || typeof value !== 'string' || value.length > 200) {
        next(
          new ApiError(
            400,
            'invalid_query',
            'Use only the documented query parameters, once each, with values at most 200 characters.',
          ),
        );
        return;
      }
    }
    next();
  };
}
