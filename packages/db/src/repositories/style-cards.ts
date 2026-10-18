import { type StyleCard, StyleCardSchema } from '@edmate/contracts';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { styleCards } from '../schema/index.js';
import { checked } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

export function styleCardsRepo(db: Db) {
  return {
    /**
     * One immutable style card row of the scope's teacher; null if missing or another teacher's.
     * Each version is its own row with its own id, so `AgentConfig.styleCardId` names one version.
     */
    async get(scope: TeacherScope, id: string): Promise<StyleCard | null> {
      const method = 'styleCards.get';
      const { teacherId } = teacherScope(scope, method);
      const cardId = parseArg(IdSchema, id, method);
      const [row] = await db
        .select({
          id: styleCards.id,
          teacherId: styleCards.teacherId,
          version: styleCards.version,
          text: styleCards.text,
          mistakeTags: styleCards.mistakeTags,
        })
        .from(styleCards)
        .where(and(eq(styleCards.id, cardId), eq(styleCards.teacherId, teacherId)))
        .limit(1);
      return row ? checked(StyleCardSchema, row, method) : null;
    },
  };
}
