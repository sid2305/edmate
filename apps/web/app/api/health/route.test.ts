import { describe, expect, it } from 'vitest';
import { dynamic, GET } from './route';

describe('GET /api/health', () => {
  it('returns 200 with status ok as JSON', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is never cached', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(GET().headers.get('cache-control')).toBe('no-store');
  });
});
