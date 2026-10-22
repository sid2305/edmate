import { randomUUID } from 'node:crypto';
import { PackageConfigSchema, type PackageConfig } from '@edmate/contracts';
import { and, asc, desc, eq, exists, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, modules, packages, packageVersions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { toPackageConfig } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

const Ref = z.strictObject({ packageId: IdSchema, version: z.int().min(0) });
const PublicAgentPackages = z.strictObject({ agentId: IdSchema });

/** Most packages `packageVersions.listForAgent` returns (a teacher has a handful per agent). */
export const AGENT_PACKAGES_MAX = 100;

/** One of the teacher's own previewable packages (task 8.5): id and name only. */
export interface TeacherPackageSummary {
  packageId: string;
  name: string;
}

/**
 * What a student sees of one live package when comparing (task 9.3): the public fields only.
 * Never the teacher's internal config (`teacherId`, `moduleIds`, `helpCeiling`, `finalAnswers`,
 * `lockedReply`) -- this object goes to a client component.
 */
export interface PackageOffer {
  packageId: string;
  name: string;
  pricePerMonth: PackageConfig['pricePerMonth'];
  /** 0 = no trial. */
  trialDays: number;
  dailyMessageLimit: number;
  liveClassesPerMonth: number;
  skills: PackageConfig['skills'];
}

/** One of a live agent's live packages (task 9.3). Only `offer` may leave the server. */
export interface LivePackage {
  /** The `package_versions` row's own id (what a subscription points at) -- not the package id. */
  packageVersionId: string;
  offer: PackageOffer;
}

/** The public projection of a stored package config. */
function toOffer(c: PackageConfig): PackageOffer {
  return {
    packageId: c.id,
    name: c.name,
    pricePerMonth: { ...c.pricePerMonth },
    trialDays: c.trialDays ?? 0,
    dailyMessageLimit: c.dailyMessageLimit,
    liveClassesPerMonth: c.liveClassesPerMonth,
    skills: [...c.skills],
  };
}

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
     * Task 8.5 (teacher test chat): the scope's teacher's packages for one of its agents that have
     * at least one version (so `latest` can preview them), any agent or package status, newest
     * created first (then id), at most `AGENT_PACKAGES_MAX`. Another teacher's or a missing agent
     * is `[]`. Teacher-side twin of `liveForAgent`, which stays public and live-only.
     */
    async listForAgent(scope: TeacherScope, agentId: string): Promise<TeacherPackageSummary[]> {
      const method = 'packageVersions.listForAgent';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, agentId, method);
      return db
        .select({ packageId: packages.id, name: packages.name })
        .from(packages)
        .where(
          and(
            eq(packages.teacherId, teacherId),
            eq(packages.agentId, id),
            exists(
              db
                .select({ one: sql`1` })
                .from(packageVersions)
                .where(
                  and(
                    eq(packageVersions.packageId, packages.id),
                    eq(packageVersions.teacherId, teacherId),
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(packages.createdAt), asc(packages.id))
        .limit(AGENT_PACKAGES_MAX);
    },

    /**
     * The live packages of a live agent, for a student comparing packages (task 9.3). The one
     * public scope (mirror `agents.owner`): parsed like a scope, before any SQL. Nothing for a
     * draft, suspended or unknown agent (inner join on `agents.status = 'live'`). The join is by
     * `agent_id` only, never a client-given `teacherId`, so it is never another teacher's packages
     * either. Returns the public `offer` projection only (9.3 fix round 1).
     */
    async liveForAgent(scope: { agentId: string }): Promise<LivePackage[]> {
      const method = 'packageVersions.liveForAgent';
      const r = PublicAgentPackages.safeParse(scope);
      if (!r.success) throw new RepositoryError('scope', method);
      const rows = await db
        .select({
          teacherId: packageVersions.teacherId,
          packageId: packageVersions.packageId,
          id: packageVersions.id,
          version: packageVersions.version,
          config: packageVersions.config,
        })
        .from(packages)
        .innerJoin(agents, and(eq(agents.id, packages.agentId), eq(agents.status, 'live')))
        .innerJoin(
          packageVersions,
          and(
            eq(packageVersions.packageId, packages.id),
            eq(packageVersions.version, packages.liveVersion),
          ),
        )
        .where(and(eq(packages.agentId, r.data.agentId), isNotNull(packages.liveVersion)));
      return rows.map((row) => ({
        packageVersionId: row.id,
        offer: toOffer(toPackageConfig(row, method)),
      }));
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
