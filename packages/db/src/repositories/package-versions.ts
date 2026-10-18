import { randomUUID } from 'node:crypto';
import { PackageConfigSchema, type PackageConfig } from '@edmate/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { modules, packages, packageVersions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { toPackageConfig } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

const Ref = z.strictObject({ packageId: IdSchema, version: z.int().min(0) });

export function packageVersionsRepo(db: Db) {
  return {
    /** One immutable package version of the scope's teacher; null if missing or another teacher's. */
    async get(
      scope: TeacherScope,
      ref: { packageId: string; version: number },
    ): Promise<PackageConfig | null> {
      const method = 'packageVersions.get';
      const { teacherId } = teacherScope(scope, method);
      const { packageId, version } = parseArg(Ref, ref, method);
      const [row] = await db
        .select({
          teacherId: packageVersions.teacherId,
          packageId: packageVersions.packageId,
          version: packageVersions.version,
          config: packageVersions.config,
        })
        .from(packageVersions)
        .where(
          and(
            eq(packageVersions.teacherId, teacherId),
            eq(packageVersions.packageId, packageId),
            eq(packageVersions.version, version),
          ),
        )
        .limit(1);
      return row ? toPackageConfig(row, method) : null;
    },

    /**
     * The package version a subscription points at (`subscriptions.package_version_id`), of the
     * scope's teacher; null if missing or another teacher's.
     */
    async getById(scope: TeacherScope, packageVersionId: string): Promise<PackageConfig | null> {
      const method = 'packageVersions.getById';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, packageVersionId, method);
      const [row] = await db
        .select({
          teacherId: packageVersions.teacherId,
          packageId: packageVersions.packageId,
          version: packageVersions.version,
          config: packageVersions.config,
        })
        .from(packageVersions)
        .where(and(eq(packageVersions.id, id), eq(packageVersions.teacherId, teacherId)))
        .limit(1);
      return row ? toPackageConfig(row, method) : null;
    },

    /** The newest version of one of the scope's teacher's packages (teacher preview); or null. */
    async latest(scope: TeacherScope, packageId: string): Promise<PackageConfig | null> {
      const method = 'packageVersions.latest';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, packageId, method);
      const [row] = await db
        .select({
          teacherId: packageVersions.teacherId,
          packageId: packageVersions.packageId,
          version: packageVersions.version,
          config: packageVersions.config,
        })
        .from(packageVersions)
        .where(and(eq(packageVersions.packageId, id), eq(packageVersions.teacherId, teacherId)))
        .orderBy(desc(packageVersions.version))
        .limit(1);
      return row ? toPackageConfig(row, method) : null;
    },

    /**
     * Stores a new immutable package version. The config must be the scope's teacher's
     * (`scope`), every module it unlocks must be one of that teacher's modules (`scope`: a package
     * can never unlock another teacher's material), and its package must be that teacher's with
     * the same agent (`not_found`). An existing (package, version) is `invalid`.
     */
    async create(scope: TeacherScope, config: PackageConfig): Promise<void> {
      const method = 'packageVersions.create';
      const { teacherId } = teacherScope(scope, method);
      const c = parseArg(PackageConfigSchema, config, method);
      if (c.teacherId !== teacherId) throw new RepositoryError('scope', method);
      const moduleIds = [...new Set(c.moduleIds)];

      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          if (moduleIds.length > 0) {
            // KEY SHARE: the modules can't be deleted (or re-keyed) before the insert commits.
            const owned = await tx
              .select({ id: modules.id })
              .from(modules)
              .where(and(eq(modules.teacherId, teacherId), inArray(modules.id, moduleIds)))
              .for('key share');
            if (owned.length !== moduleIds.length) throw new RepositoryError('scope', method);
          }
          const result = await tx.execute(
            insertSelect(
              packageVersions,
              [
                [packageVersions.id, sql`${randomUUID()}::text`],
                [packageVersions.teacherId, sql`${packages.teacherId}`],
                [packageVersions.packageId, sql`${packages.id}`],
                [packageVersions.version, sql`${c.version}::integer`],
                [packageVersions.config, sql`${JSON.stringify(c)}::jsonb`],
              ],
              sql`from ${packages} where ${and(
                eq(packages.id, c.id),
                eq(packages.teacherId, teacherId),
                eq(packages.agentId, c.agentId),
              )}`,
            ),
          );
          if (written(result) !== 1) throw new RepositoryError('not_found', method);
        }),
      );
    },
  };
}
