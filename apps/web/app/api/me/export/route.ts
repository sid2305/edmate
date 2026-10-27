// A student's account-wide export: every teacher they've subscribed to, plus their own account
// fields (task 13.4b). The per-agent export (9.6b) is `/api/me/export/:agentId`, a separate
// route. Falls under the existing `/api/me/**` GET policy row.
import { withRole } from '../../../../src/auth';
import { accountExportHandler } from '../../../../src/export/accountExport';

export const dynamic = 'force-dynamic';

export const GET = withRole(['student'], accountExportHandler);
