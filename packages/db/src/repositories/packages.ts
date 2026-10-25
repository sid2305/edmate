// Task 8.6b: a teacher's packages in the studio (create, save a new version, list). Every read and
// write carries the scope's teacher_id; the agent, package and every unlocked module must be that
// teacher's, checked in the same transaction as the insert (README rule 3). Versions are
// immutable: a save writes a new `package_versions` row and changes only `packages.name`.
// `packages.live_version` is never set here (publishing is 8.7).
import { randomUUID } from 'node:crypto';
import { PackageConfigSchema, type PackageConfig } from '@edmate/contracts';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, packages, packageVersions } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { toPackageConfig } from './map.js';
import { checkModules, lockPackageRow, type Tx } from './package-write.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** Most packages one teacher may have (task 8.6, Q6); `create` refuses more (`limit`). */
export const PACKAGES_MAX = 20;

/**
 * What a teacher edits: a package config without the ids the repository fills in (`id`,
 * `version`, `teacherId`, `agentId`). Strict, so a client-set one of those is `invalid`.
 */
const PackageDraftSchema = PackageConfigSchema.omit({
  id: true,
  version: true,
  teacherId: true,
  agentId: true,
});
export type PackageDraft = z.infer<typeof PackageDraftSchema>;

const CreateInput = z.strictObject({ agentId: IdSchema, draft: PackageDraftSchema });
const SaveInput = z.strictObject({
  packageId: IdSchema,
  agentId: IdSchema,
  draft: PackageDraftSchema,
});

/** One of the teacher's packages with its newest version's config (the studio list). */
export interface TeacherPackageRow {
  packageId: string;
  agentId: string;
  /** Null until 8.7 publishes a version. */
  liveVersion: number | null;
  /** The newest version (its `version` and `name` included). */
  config: PackageConfig;
}

/**
 * Namespace for the per-teacher package-count lock (two-key advisory form, so it can never meet
 * migrate.ts's single-key lock or another repository's namespace). Arbitrary, used nowhere else.
 */
const PACKAGE_LOCK_NAMESPACE = 8602;

/** Builds the full config from the scope and rows, inserts the version and its audit row. */
async function writeVersion(
  tx: Tx,
  method: string,
  teacherId: string,
  ids: { packageId: string; agentId: string; version: number },
  draft: PackageDraft,
): Promise<void> {
  const config = parseArg(
    PackageConfigSchema,
    { ...draft, id: ids.packageId, version: ids.version, teacherId, agentId: ids.agentId },
    method,
  );
  await tx.insert(packageVersions).values({
    teacherId,
    packageId: ids.packageId,
    version: ids.version,
    config,
  });
  // The package id and the version only: no price, no names. Task 8.7h already fixed the audit
  // redactor to carve UUID spans out of phone-candidate matching, so the id is safe in `after`
  // too (it no longer needs to be omitted to work around the old digit-led-UUID bug).
  await insertAuditEntry(tx, method, teacherId, null, {
    actor: teacherId,
    actorRole: 'teacher',
    action: 'package.save',
    target: `package:${ids.packageId}`,
    after: { packageId: ids.packageId, version: ids.version },
  });
}

export function packagesRepo(db: Db) {
  return {
    /**
     * Creates one of the scope's teacher's packages for one of that teacher's agents, and its
     * version 1, in one transaction. A foreign or unknown agent is `not_found`, a foreign or
     * unknown module `scope`, a teacher already at `PACKAGES_MAX` `limit`; nothing is written.
     */
    async create(
      scope: TeacherScope,
      input: { agentId: string; draft: PackageDraft },
    ): Promise<{ packageId: string; version: number }> {
      const method = 'packages.create';
      const { teacherId } = teacherScope(scope, method);
      const { agentId, draft } = parseArg(CreateInput, input, method);
      const packageId = randomUUID();
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${PACKAGE_LOCK_NAMESPACE}::int4, hashtext(${teacherId}))`,
          );
          const [agent] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, agentId), eq(agents.teacherId, teacherId)))
            .for('key share');
          if (!agent) throw new RepositoryError('not_found', method);
          await checkModules(tx, teacherId, draft.moduleIds, method);
          const [n] = await tx
            .select({ n: count() })
            .from(packages)
            .where(eq(packages.teacherId, teacherId));
          if (n!.n >= PACKAGES_MAX) throw new RepositoryError('limit', method);
          await tx.insert(packages).values({ id: packageId, teacherId, agentId, name: draft.name });
          await writeVersion(tx, method, teacherId, { packageId, agentId, version: 1 }, draft);
          return { packageId, version: 1 };
        }),
      );
    },

    /**
     * Saves a new version (newest + 1) of one of the scope's teacher's packages of the given
     * agent, and sets `packages.name` to the draft's name (the only column ever updated). A
     * package of another teacher or another agent is `not_found`, a foreign module `scope`;
     * nothing is written. Concurrent saves are serialised by a row lock on the package; the
     * unique (package_id, version) index stays the backstop (`invalid`).
     */
    async saveVersion(
      scope: TeacherScope,
      input: { packageId: string; agentId: string; draft: PackageDraft },
    ): Promise<{ packageId: string; version: number }> {
      const method = 'packages.saveVersion';
      const { teacherId } = teacherScope(scope, method);
      const { packageId, agentId, draft } = parseArg(SaveInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await lockPackageRow(tx, teacherId, { packageId, agentId }, method);
          await checkModules(tx, teacherId, draft.moduleIds, method);
          const [newest] = await tx
            .select({ max: sql<number>`coalesce(max(${packageVersions.version}), 0)::int` })
            .from(packageVersions)
            .where(
              and(
                eq(packageVersions.packageId, packageId),
                eq(packageVersions.teacherId, teacherId),
              ),
            );
          const version = newest!.max + 1;
          await writeVersion(tx, method, teacherId, { packageId, agentId, version }, draft);
          await tx
            .update(packages)
            .set({ name: draft.name, updatedAt: sql`now()` })
            .where(and(eq(packages.id, packageId), eq(packages.teacherId, teacherId)));
          return { packageId, version };
        }),
      );
    },

    /**
     * The scope's teacher's packages, oldest first, at most `PACKAGES_MAX`, each once with its
     * newest version's config.
     */
    async listForTeacher(scope: TeacherScope): Promise<TeacherPackageRow[]> {
      const method = 'packages.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({ id: packages.id, agentId: packages.agentId, liveVersion: packages.liveVersion })
        .from(packages)
        .where(eq(packages.teacherId, teacherId))
        .orderBy(asc(packages.createdAt), asc(packages.id))
        .limit(PACKAGES_MAX);
      if (rows.length === 0) return [];
      const versions = await db
        .selectDistinctOn([packageVersions.packageId], {
          teacherId: packageVersions.teacherId,
          packageId: packageVersions.packageId,
          version: packageVersions.version,
          config: packageVersions.config,
        })
        .from(packageVersions)
        .where(
          and(
            eq(packageVersions.teacherId, teacherId),
            inArray(
              packageVersions.packageId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(packageVersions.packageId, desc(packageVersions.version));
      const newest = new Map(versions.map((v) => [v.packageId, v]));
      return rows.map((r) => {
        const v = newest.get(r.id);
        // A package is always created with its version 1 (one transaction).
        if (!v) throw new RepositoryError('integrity', method);
        const config = toPackageConfig(v, method);
        if (config.agentId !== r.agentId) throw new RepositoryError('integrity', method);
        return { packageId: r.id, agentId: r.agentId, liveVersion: r.liveVersion, config };
      });
    },
  };
}
