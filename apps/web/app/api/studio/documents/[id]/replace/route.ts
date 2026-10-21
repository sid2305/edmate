// Replace a document's file (task 8.2): a new server-built key and upload URL; then `complete`.
import { withRole } from '../../../../../../src/auth';
import { studioHandlers } from '../../../../../../src/studio';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], studioHandlers.replace);
