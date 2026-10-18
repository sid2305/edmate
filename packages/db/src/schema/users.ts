// Data model rows: users, teacher_profiles, consents.
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz, userRole } from './_shared.js';

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
    ageConfirmedAt: tstz('age_confirmed_at'),
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
    subject: text('subject').notNull(),
    bio: text('bio').notNull().default(''),
    photo: text('photo'),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    verificationStatus: text('verification_status').notNull().default('pending'),
    payoutAccountRef: text('payout_account_ref'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('teacher_profiles_user_id_key').on(t.userId),
    uniqueIndex('teacher_profiles_slug_key').on(t.slug),
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
    ...timestamps(),
  },
  // Led by user_id, so it also serves lookups by user.
  (t) => [uniqueIndex('consents_user_id_kind_version_key').on(t.userId, t.kind, t.version)],
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
