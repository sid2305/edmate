// Task 8.4a: draft a style card from the style interview for the teacher to preview and edit.
// Nothing is stored; saving is `PUT /api/studio/style-card`.
import { withRole } from '../../../../../src/auth';
import { styleCardHandlers } from '../../../../../src/studio';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], styleCardHandlers.draft);
