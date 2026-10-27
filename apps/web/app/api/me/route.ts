// A student's own account delete (task 13.4b). The policy row already exists
// (`apps/web/src/auth/policy.ts:47`): `DELETE /api/me`, student only.
import { withRole } from '../../../src/auth';
import { deleteHandler } from '../../../src/account/delete';

export const dynamic = 'force-dynamic';

export const DELETE = withRole(['student'], deleteHandler);
