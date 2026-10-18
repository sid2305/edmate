// Liveness check used by Docker Compose (task 0.2) and uptime monitors. Public (task 1.3).
import { publicRoute } from '../../../src/auth';

export const dynamic = 'force-dynamic';

export const GET = publicRoute((): Response => {
  return Response.json({ status: 'ok' }, { status: 200, headers: { 'cache-control': 'no-store' } });
});
