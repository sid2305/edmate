'use client';
// Task 8.1a: the onboarding form (create and edit). Every string is from messages/en.json. The
// slug is set at create only (8.1's own decision): once a profile exists it is shown read-only.
import type { TeacherProfileRow } from '@edmate/db';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

export interface OnboardingFormProps {
  initialProfile: TeacherProfileRow | null;
}

interface ErrorBody {
  error?: { message?: string };
}

/** Splits a comma-separated languages field into a trimmed, non-empty list. */
function parseLanguages(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function OnboardingForm({ initialProfile }: OnboardingFormProps) {
  const t = useTranslations('onboarding');
  const [profile, setProfile] = useState(initialProfile);
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? '');
  const [subject, setSubject] = useState(initialProfile?.subject ?? '');
  const [bio, setBio] = useState(initialProfile?.bio ?? '');
  const [languagesText, setLanguagesText] = useState((initialProfile?.languages ?? []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = profile?.verificationStatus ?? 'pending';
  const bannerKey =
    status === 'verified'
      ? 'statusVerified'
      : status === 'rejected'
        ? 'statusRejected'
        : 'statusPending';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const languages = parseLanguages(languagesText);
    const body = profile
      ? {
          ...(displayName.trim().length > 0 ? { displayName } : {}),
          subject,
          bio,
          languages,
        }
      : { slug, displayName, subject, bio, languages };
    try {
      const res = await fetch('/api/studio/profile', {
        method: profile ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as ErrorBody;
        setError(parsed.error?.message ?? t('errors.generic'));
        return;
      }
      const { profile: saved } = (await res.json()) as { profile: TeacherProfileRow };
      setProfile(saved);
      // Resync every field from the saved profile: a patch can omit a key (e.g. clearing
      // displayName keeps the stored value server-side), so the form must reflect what was
      // actually persisted, not what the teacher typed.
      setDisplayName(saved.displayName ?? '');
      setSubject(saved.subject ?? '');
      setBio(saved.bio ?? '');
      setLanguagesText((saved.languages ?? []).join(', '));
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <p role="status">{t(bannerKey)}</p>
      {error ? <p role="alert">{error}</p> : null}
      {profile ? (
        <p>
          <span id="onboarding-slug-label">{t('slugLabel')}</span> <span>{profile.slug}</span>
        </p>
      ) : (
        <p>
          <label htmlFor="onboarding-slug">{t('slugLabel')}</label>
          <input
            id="onboarding-slug"
            value={slug}
            aria-describedby="onboarding-slug-hint"
            onChange={(e) => setSlug(e.target.value)}
          />
          <span id="onboarding-slug-hint">{t('slugHint')}</span>
        </p>
      )}
      <p>
        <label htmlFor="onboarding-display-name">{t('displayNameLabel')}</label>
        <input
          id="onboarding-display-name"
          value={displayName}
          maxLength={60}
          aria-describedby="onboarding-display-name-hint"
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <span id="onboarding-display-name-hint">{t('displayNameHint')}</span>
        {profile && !profile.displayName ? (
          <span>{t('displayNameFallback', { slug: profile.slug })}</span>
        ) : null}
      </p>
      <p>
        <label htmlFor="onboarding-subject">{t('subjectLabel')}</label>
        <input
          id="onboarding-subject"
          value={subject}
          aria-describedby={profile ? 'onboarding-subject-hint' : undefined}
          onChange={(e) => setSubject(e.target.value)}
        />
        {profile ? <span id="onboarding-subject-hint">{t('subjectHint')}</span> : null}
      </p>
      <p>
        <label htmlFor="onboarding-bio">{t('bioLabel')}</label>
        <textarea id="onboarding-bio" value={bio} onChange={(e) => setBio(e.target.value)} />
      </p>
      <p>
        <label htmlFor="onboarding-languages">{t('languagesLabel')}</label>
        <input
          id="onboarding-languages"
          value={languagesText}
          aria-describedby="onboarding-languages-hint"
          onChange={(e) => setLanguagesText(e.target.value)}
        />
        <span id="onboarding-languages-hint">{t('languagesHint')}</span>
      </p>
      <button type="submit" disabled={submitting}>
        {submitting ? t('saving') : profile ? t('saveButton') : t('createButton')}
      </button>
    </form>
  );
}
