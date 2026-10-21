// The browser's upload landed (task 8.2): check it, mark the document processing, enqueue ingest.
import { withRole } from '../../../../../../src/auth';
import { studioHandlers } from '../../../../../../src/studio';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], studioHandlers.complete);
