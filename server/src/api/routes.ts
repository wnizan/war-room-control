import type { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import type { Unit } from '../../../shared/types.js';

const QuerySchema = z.object({
  status:    z.enum(['active', 'attacking', 'moving', 'idle', 'destroyed']).optional(),
  healthMin: z.coerce.number().min(0).max(100).optional(),
  healthMax: z.coerce.number().min(0).max(100).optional(),
  name:      z.string().max(100).optional(),
  limit:     z.coerce.number().min(1).max(1000).default(200),
  offset:    z.coerce.number().min(0).default(0),
});

function parseQuery(url: string): Record<string, string> {
  const qs = url.includes('?') ? url.split('?')[1] ?? '' : '';
  const params: Record<string, string> = {};
  for (const pair of qs.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eq));
    const v = decodeURIComponent(pair.slice(eq + 1));
    params[k] = v;
  }
  return params;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createRequestHandler(getUnits: () => Map<string, Unit>) {
  return function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'GET' && url === '/health') {
      json(res, 200, { status: 'ok', units: getUnits().size });
      return;
    }

    if (req.method === 'GET' && url.startsWith('/api/units')) {
      const parsed = QuerySchema.safeParse(parseQuery(url));

      if (!parsed.success) {
        json(res, 400, { error: 'Invalid query parameters', details: parsed.error.flatten() });
        return;
      }

      const { status, healthMin, healthMax, name, limit, offset } = parsed.data;

      let results: Unit[] = Array.from(getUnits().values());

      if (status !== undefined)    results = results.filter(u => u.status === status);
      if (healthMin !== undefined) results = results.filter(u => u.health >= healthMin);
      if (healthMax !== undefined) results = results.filter(u => u.health <= healthMax);
      if (name !== undefined) {
        const lower = name.toLowerCase();
        results = results.filter(u => u.name.toLowerCase().includes(lower));
      }

      const total = results.length;
      const page  = results.slice(offset, offset + limit);

      json(res, 200, { total, offset, limit, units: page });
      return;
    }

    json(res, 404, { error: 'Not found' });
  };
}
