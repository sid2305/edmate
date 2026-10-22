// A student's complete JSON export of what Edmate keeps about their learning with one teacher
// (task 9.6 Phase B). Falls under the existing `/api/me/**` GET policy row.
import { withRole } from '../../../../../src/auth';
import { exportHandlers } from '../../../../../src/export/routes';

export const dynamic = 'force-dynamic';

export const GET = withRole(['student'], exportHandlers.json);
