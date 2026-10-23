// Data model rows: users, teacher_profiles, consents.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, teacherVerificationStatus, timestamps, tstz, tsvector, userRole } from './_shared.js';

/** Students, teachers and staff. */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email'),
    phone: text('phone'),
    /** Display name. Never sent to a model (Data model). */
    name: text('name').notNull(),
    locale: text('locale').notNull(),
    market: text('market').notNull(),
    role: userRole('role').notNull(),
    /** Set when the learner passes the age gate (1.7). */
    ageConfirmedAt: tstz('age_confirmed_at'),
    /** The learner's own answer at the age gate (1.7): a year only, never a full date of birth. */
    birthYear: smallint('birth_year'),
    /**
     * Set when an under-age erase is blocked by a row the store does not own (1.7 fix round 1):
     * the account stays open but is treated as `under_age` forever, until staff clear it (12.1).
     */
    ageBlockedAt: tstz('age_blocked_at'),
    /** When the sign-in provider (or 1.4's magic link) last confirmed the email (task 1.3). */
    emailVerifiedAt: tstz('email_verified_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_key')
      .on(t.email)
      .where(sql`${t.email} is not null`),
    uniqueIndex('users_phone_key')
      .on(t.phone)
      .where(sql`${t.phone} is not null`),
    index('users_role_idx').on(t.role),
    check('users_birth_year_check', sql`${t.birthYear} between 1900 and 2100`),
  ],
);

/** A teacher's public profile; one per teacher user. */
export const teacherProfiles = pgTable(
  'teacher_profiles',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    slug: text('slug').notNull(),
    /**
     * Task 9.2d: the public name the teacher chose in onboarding, shown on discovery and the
     * teacher page instead of the sign-in name (`users.name`). Null until the teacher sets one;
     * the public reads fall back to `slug`, never to `users.name` (scope decision 2).
     */
    displayName: text('display_name'),
    subject: text('subject').notNull(),
    bio: text('bio').notNull().default(''),
    photo: text('photo'),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    verificationStatus: teacherVerificationStatus('verification_status').notNull().default('pending'),
    payoutAccountRef: text('payout_account_ref'),
    /**
     * Task 9.2: free-text search over subject (weight A) and bio (weight B), 'simple' config (no
     * language-specific stemming, works for every locale, like chunks.search).
     */
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', "subject"), 'A') || setweight(to_tsvector('simple', "bio"), 'B')`,
      ),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('teacher_profiles_user_id_key').on(t.userId),
    uniqueIndex('teacher_profiles_slug_key').on(t.slug),
    index('teacher_profiles_search_idx').using('gin', t.search),
    index('teacher_profiles_languages_idx').using('gin', t.languages),
  ],
);

/** Privacy notice, age and rights declarations: one row per user, kind and version agreed to. */
export const consents = pgTable(
  'consents',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    ts: tstz('ts').notNull().defaultNow(),
    /** Who agreed (1.7): the user themself, or their parent for a 13-17 learner. */
    grantedBy: text('granted_by').notNull().default('self'),
    /** Set when the consent is withdrawn (1.7); a withdrawn consent no longer counts. */
    withdrawnAt: tstz('withdrawn_at'),
    ...timestamps(),
  },
  (t) => [
    // Led by user_id, so it also serves lookups by user.
    uniqueIndex('consents_user_id_kind_version_key').on(t.userId, t.kind, t.version),
    check('consents_granted_by_check', sql`${t.grantedBy} in ('self', 'parent')`),
  ],
);

/** `teacher_id` column: not null, references users. */
export const teacherId = () =>
  text('teacher_id')
    .notNull()
    .references(() => users.id);

/** `student_id` column: not null, references users. */
export const studentId = () =>
  text('student_id')
    .notNull()
    .references(() => users.id);
