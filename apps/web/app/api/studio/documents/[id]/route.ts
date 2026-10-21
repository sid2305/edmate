// Delete one of the signed-in teacher's documents (task 8.2): its chunks and row, then its file.
import { withRole } from '../../../../../src/auth';
import { studioHandlers } from '../../../../../src/studio';

export const dynamic = 'force-dynamic';

export const DELETE = withRole(['teacher'], studioHandlers.remove);
