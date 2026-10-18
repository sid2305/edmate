import { LearnerProfileSchema } from '@edmate/contracts';
import type { z } from 'zod';
import { RepositoryError } from './errors.js';

// Built from the contracts' own id format (strict objects, 1..128 of [A-Za-z0-9_-]) without
// changing the contracts.
const TeacherScopeSchema = LearnerProfileSchema.pick({ teacherId: true });
const StudentScopeSchema = LearnerProfileSchema.pick({ studentId: true, teacherId: true });
/** A single id in the contracts' format. */
export const IdSchema = LearnerProfileSchema.shape.teacherId;

/** Teacher-owned data: agent and package config, the teacher's question inbox. */
export type TeacherScope = z.infer<typeof TeacherScopeSchema>;
/** Student data is always per student x teacher: sessions, profiles, evidence, questions. */
export type StudentScope = z.infer<typeof StudentScopeSchema>;

/**
 * Parses a teacher scope or throws `RepositoryError('scope')`. Every repository method calls this
 * before building any SQL: Drizzle's `and()` drops `undefined` conditions, so an unchecked
 * `undefined` id would silently widen a query.
 */
export function teacherScope(x: unknown, method = 'teacherScope'): TeacherScope {
  const r = TeacherScopeSchema.safeParse(x);
  if (!r.success) throw new RepositoryError('scope', method);
  return r.data;
}

/** Parses a student scope or throws `RepositoryError('scope')`. */
export function studentScope(x: unknown, method = 'studentScope'): StudentScope {
  const r = StudentScopeSchema.safeParse(x);
  if (!r.success) throw new RepositoryError('scope', method);
  return r.data;
}

/** Parses a non-scope argument or throws `RepositoryError('invalid')`. */
export function parseArg<T>(schema: z.ZodType<T>, x: unknown, method: string): T {
  const r = schema.safeParse(x);
  if (!r.success) throw new RepositoryError('invalid', method);
  return r.data;
}
