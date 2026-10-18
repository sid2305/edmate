// Auth.js endpoints: sign-in, OAuth callback, session, csrf, sign-out (task 1.3).
import { handlers, publicRoute } from '../../../../src/auth';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(handlers.GET);
export const POST = publicRoute(handlers.POST);
