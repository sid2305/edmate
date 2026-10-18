import { MessageSchema, type Message } from '@edmate/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { messages, sessions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { toMessage } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';
import { ownSession } from './sessions.js';

/** Largest history page. */
export const HISTORY_MAX_LIMIT = 200;
const Limit = z.int().min(1).max(HISTORY_MAX_LIMIT);

export function messagesRepo(db: Db) {
  return {
    /**
     * The newest `limit` (1..200) messages of the scope's session, oldest first. Ties on
     * created_at are ordered by id. Another scope's session reads as empty.
     */
    async history(scope: StudentScope, sessionId: string, limit: number): Promise<Message[]> {
      const method = 'messages.history';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const n = parseArg(Limit, limit, method);
      const rows = await db
        .select({
          id: messages.id,
          role: messages.role,
          text: messages.text,
          sources: messages.sources,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(sessions, eq(sessions.id, messages.sessionId))
        .where(and(eq(messages.sessionId, id), ownSession(id, sc)))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(n);
      return rows.reverse().map((r) => toMessage(r, method));
    },

    /**
     * Appends a message to the scope's session; another scope's session is `not_found`. The id is
     * the caller's (the TranscriptStore port passes a whole Message) and ids are unique across all
     * sessions, so a duplicate id is also `not_found`: it can't tell anyone that the id exists in
     * someone else's session.
     */
    async append(scope: StudentScope, sessionId: string, m: Message): Promise<void> {
      const method = 'messages.append';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const msg = parseArg(MessageSchema, m, method);
      const result = await translateWrite(
        method,
        () =>
          db.execute(
            insertSelect(
              messages,
              [
                [messages.id, sql`${msg.id}::text`],
                [messages.sessionId, sql`${sessions.id}`],
                [messages.role, sql`${msg.role}::message_role`],
                [messages.text, sql`${msg.text}::text`],
                [
                  messages.sources,
                  msg.sources === undefined
                    ? sql`null::jsonb`
                    : sql`${JSON.stringify(msg.sources)}::jsonb`,
                ],
                [messages.createdAt, sql`${msg.createdAt}::timestamptz`],
              ],
              sql`from ${sessions} where ${ownSession(id, sc)}`,
            ),
          ),
        'not_found',
      );
      if (written(result) !== 1) throw new RepositoryError('not_found', method);
    },
  };
}
