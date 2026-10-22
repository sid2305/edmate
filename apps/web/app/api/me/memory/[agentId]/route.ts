// A student's view, export (GET) and reset (DELETE) of their tutor's memory of them (task 6.5).
// GET falls under the existing `/api/me/**` policy row; DELETE has its own row (destructive).
import { withRole } from '../../../../../src/auth';
import { memoryHandlers } from '../../../../../src/memory/routes';

export const dynamic = 'force-dynamic';

export const GET = withRole(['student'], memoryHandlers.export);
export const DELETE = withRole(['student'], memoryHandlers.reset);
