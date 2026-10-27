import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { modules } from '../schema/index.js';
import { teacherScope, type TeacherScope } from './scope.js';

export function modulesRepo(db: Db) {
  return {
    /**
     * Every module id of the scope's teacher, in id order. An entitlement's locked modules are
     * these minus its package's (MVP: one course per teacher).
     */
    async ids(scope: TeacherScope): Promise<string[]> {
      const method = 'modules.ids';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({ id: modules.id })
        .from(modules)
        .where(eq(modules.teacherId, teacherId))
        .orderBy(asc(modules.id));
      return rows.map((r) => r.id);
    },

    /**
     * 8.2a Phase C: every module of the scope's teacher with its title, in id order (same scope
     * and order as `ids`) -- for a picker that must show a real name, not a placeholder.
     */
    async list(scope: TeacherScope): Promise<ModuleListItem[]> {
      const method = 'modules.list';
      const { teacherId } = teacherScope(scope, method);
      return db
        .select({ id: modules.id, title: modules.title })
        .from(modules)
        .where(eq(modules.teacherId, teacherId))
        .orderBy(asc(modules.id));
    },
  };
}

export interface ModuleListItem {
  id: string;
  title: string;
}
