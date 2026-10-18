// Liveness check used by Docker Compose (task 0.2) and uptime monitors.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { status: 200, headers: { 'cache-control': 'no-store' } });
}
