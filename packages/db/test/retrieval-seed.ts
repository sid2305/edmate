// Task 5.3 Phase A: a small synthetic world for the retrieval tests. Two teachers; teacher A has an
// allowed, a locked and a draft (unpackaged) module, teacher B one module. Every text is made up.
// The scripted embedder maps a few keywords to fixed axes, so vector search is deterministic and
// no model is ever called.
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import { EMBEDDING_DIMENSIONS } from '../src/schema/index.js';

export const RA = 'tch_ra';
export const RB = 'tch_rb';
export const MOD = {
  allowed: 'mod_ra_allowed',
  locked: 'mod_ra_locked',
  draft: 'mod_ra_draft',
  other: 'mod_rb_1',
} as const;

export async function seedRetrievalWorld(db: Db): Promise<void> {
  await db
    .insert(s.users)
    .values(
      [RA, RB].map((id) => ({
        id,
        name: `${id} teacher`,
        locale: 'en',
        market: 'test',
        role: 'teacher' as const,
      })),
    );
  await db.insert(s.courses).values([
    { id: 'crs_ra', teacherId: RA, title: 'A course', order: 0 },
    { id: 'crs_rb', teacherId: RB, title: 'B course', order: 0 },
  ]);
  await db.insert(s.modules).values([
    { id: MOD.allowed, teacherId: RA, courseId: 'crs_ra', title: 'Plants', order: 1 },
    { id: MOD.locked, teacherId: RA, courseId: 'crs_ra', title: 'Volcanoes', order: 2 },
    { id: MOD.draft, teacherId: RA, courseId: 'crs_ra', title: 'Draft', order: 3 },
    { id: MOD.other, teacherId: RB, courseId: 'crs_rb', title: 'B plants', order: 1 },
  ]);
}

/** Keyword -> axis. A text's vector is the normalised sum of its keywords' axes. */
const AXES: Record<string, number> = {
  photosynthesis: 0,
  sunlight: 0,
  pigment: 0,
  roots: 1,
  water: 1,
  volcano: 2,
  magma: 2,
  fractions: 3,
};
const NOTHING_AXIS = EMBEDDING_DIMENSIONS - 1;

export function scriptedVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let any = false;
  for (const w of words) {
    const axis = AXES[w];
    if (axis !== undefined) {
      v[axis] = (v[axis] ?? 0) + 1;
      any = true;
    }
  }
  if (!any) v[NOTHING_AXIS] = 1;
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / norm);
}

/** A `Pick<ModelGateway, 'embed'>` that never calls a model. */
export const scriptedEmbedder = {
  calls: 0,
  async embed(texts: string[]): Promise<number[][]> {
    scriptedEmbedder.calls += 1;
    return texts.map(scriptedVector);
  },
};
