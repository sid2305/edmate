'use client';
// Task 8.6 Phase D: the package builder. One "new package" form (two presets, "Free starter" and
// "Full course") plus a card per saved package showing its monthly AI-cost estimate. Fetch is a
// thin wrapper here (no separate client module is in this phase's file list); every body read is
// try/caught and every busy flag is cleared in a `finally` (lessons.md: "A studio page that trusts
// a 200 response gets stuck").
import type { PackageDraft } from '@edmate/db';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PackageView } from '../../../src/studio/packages';
import { costWarning, monthlyEstimate, PACKAGE_LIMITS, type MonthlyEstimate } from '../../../src/studio/costEstimate';

const BASE = '/api/studio/packages';
const JSON_HEADERS = { 'content-type': 'application/json' };
const L = PACKAGE_LIMITS;

/** Every skill the studio offers (SkillSchema minus `study_plan`, MVP-out; 8.6 plan Q5). */
const OFFERED_SKILLS = [
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
] as const;
type OfferedSkill = (typeof OFFERED_SKILLS)[number];

const ERROR_KEYS = [
  'validation',
  'input_too_large',
  'not_found',
  'unauthorized',
  'forbidden',
  'rate_limited',
  'provider_error',
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];
const REASON_KEYS = ['style_card_required', 'package_limit', 'conflict'] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

type FinalAnswers = 'never' | 'after_attempt' | 'allowed';
type LockedReply = 'name_package' | 'generic';

/** The form's own shape: like `PackageDraft` but with the price as a plain number of cents, and
 * never a currency (the server always sets it to USD). */
interface FormState {
  name: string;
  moduleIds: string[];
  skills: OfferedSkill[];
  helpCeiling: 1 | 2 | 3 | 4;
  finalAnswers: FinalAnswers;
  dailyMessageLimit: number;
  liveClassesPerMonth: number;
  amountMinor: number;
  trialDays: number;
  lockedReply: LockedReply;
}

const BLANK_FORM: FormState = {
  name: '',
  moduleIds: [],
  skills: [],
  helpCeiling: 2,
  finalAnswers: 'after_attempt',
  dailyMessageLimit: L.dailyMessagesDefault,
  liveClassesPerMonth: 0,
  amountMinor: 0,
  trialDays: 0,
  lockedReply: 'name_package',
};

function freeStarter(moduleIds: readonly string[]): FormState {
  return {
    name: 'Free starter',
    moduleIds: [...moduleIds],
    skills: ['explain', 'practice'],
    helpCeiling: 2,
    finalAnswers: 'after_attempt',
    dailyMessageLimit: 10,
    liveClassesPerMonth: 0,
    amountMinor: 0,
    trialDays: 0,
    lockedReply: 'name_package',
  };
}

// $55/month: at the daily limit below, the maximum estimate is 23% of the price (under the 25%
// warning). $29 at 20 messages a day would show 44%, over the warning at its own default; see
// docs/tasks/8.6d/handoff.md "Decisions".
const FULL_COURSE_PRICE_MINOR = 5500;

function fullCourse(moduleIds: readonly string[]): FormState {
  return {
    name: 'Full course',
    moduleIds: [...moduleIds],
    skills: [...OFFERED_SKILLS],
    helpCeiling: 3,
    finalAnswers: 'allowed',
    dailyMessageLimit: 20,
    liveClassesPerMonth: 2,
    amountMinor: FULL_COURSE_PRICE_MINOR,
    trialDays: 7,
    lockedReply: 'generic',
  };
}

function formOf(draft: PackageDraft): FormState {
  return {
    name: draft.name,
    moduleIds: [...draft.moduleIds],
    skills: draft.skills.filter((s): s is OfferedSkill =>
      (OFFERED_SKILLS as readonly string[]).includes(s),
    ),
    helpCeiling: draft.helpCeiling,
    finalAnswers: draft.finalAnswers,
    dailyMessageLimit: draft.dailyMessageLimit,
    liveClassesPerMonth: draft.liveClassesPerMonth,
    amountMinor: draft.pricePerMonth.amountMinor,
    trialDays: draft.trialDays ?? 0,
    lockedReply: draft.lockedReply,
  };
}

/** The exact body the API expects: strict, never a currency, a trial only on a paid package. */
function bodyOf(form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name,
    moduleIds: form.moduleIds,
    skills: form.skills,
    helpCeiling: form.helpCeiling,
    finalAnswers: form.finalAnswers,
    dailyMessageLimit: form.dailyMessageLimit,
    liveClassesPerMonth: form.liveClassesPerMonth,
    pricePerMonth: { amountMinor: form.amountMinor },
    lockedReply: form.lockedReply,
  };
  if (form.amountMinor > 0 && form.trialDays > 0) body.trialDays = form.trialDays;
  return body;
}

async function errorInfo(res: Response): Promise<{ code: string; reason?: string; link?: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown }; reason?: unknown; link?: unknown };
    const code = typeof body.error?.code === 'string' ? body.error.code : 'provider_error';
    const info: { code: string; reason?: string; link?: string } = { code };
    if (typeof body.reason === 'string') info.reason = body.reason;
    if (typeof body.link === 'string') info.link = body.link;
    return info;
  } catch {
    return { code: 'provider_error' };
  }
}

function errorKey(code: string): ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(code) ? (code as ErrorKey) : 'provider_error';
}
function reasonKey(reason: string | undefined): ReasonKey | undefined {
  return (REASON_KEYS as readonly string[]).includes(reason ?? '') ? (reason as ReasonKey) : undefined;
}

interface Setup {
  styleCard: boolean;
  styleCardLink: string;
}
interface ModuleOption {
  id: string;
  title: string;
}

function money(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export function PackagesView() {
  const t = useTranslations('packageBuilder');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<ErrorKey | null>(null);
  const [packages, setPackages] = useState<PackageView[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [setup, setSetup] = useState<Setup>({ styleCard: false, styleCardLink: '' });
  const [perTurnMicroUsd, setPerTurnMicroUsd] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<{ key: ErrorKey; reason?: ReasonKey; link?: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(BASE, { method: 'GET', cache: 'no-store' });
      if (!res.ok) {
        setBanner(errorKey((await errorInfo(res)).code));
        return;
      }
      const body = (await res.json()) as {
        packages: PackageView[];
        modules: ModuleOption[];
        setup: Setup;
        perTurnMicroUsd: number;
      };
      setPackages(body.packages);
      setModules(body.modules);
      setSetup(body.setup);
      setPerTurnMicroUsd(body.perTurnMicroUsd);
      setBanner(null);
    } catch {
      setBanner('provider_error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPreset = (preset: (moduleIds: readonly string[]) => FormState) => {
    setEditingId(null);
    setFormError(null);
    setForm(preset(modules.map((m) => m.id)));
  };

  const startEdit = (pkg: PackageView) => {
    setEditingId(pkg.packageId);
    setFormError(null);
    setForm(formOf(pkg.draft));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormError(null);
    setForm(BLANK_FORM);
  };

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const url = BASE;
      const method = editingId === null ? 'POST' : 'PUT';
      const body =
        editingId === null ? bodyOf(form) : { packageId: editingId, ...bodyOf(form) };
      const res = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (!res.ok) {
        const info = await errorInfo(res);
        const reason = reasonKey(info.reason);
        const next: { key: ErrorKey; reason?: ReasonKey; link?: string } = { key: errorKey(info.code) };
        if (reason !== undefined) next.reason = reason;
        if (info.link !== undefined) next.link = info.link;
        setFormError(next);
        return;
      }
      const saved = (await res.json()) as { package: PackageView };
      setPackages((prev) => {
        const i = prev.findIndex((p) => p.packageId === saved.package.packageId);
        return i === -1 ? [...prev, saved.package] : prev.map((p, j) => (j === i ? saved.package : p));
      });
      setEditingId(null);
      setForm(BLANK_FORM);
    } catch {
      setFormError({ key: 'provider_error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>{t('loading')}</p>;

  const liveEstimate: MonthlyEstimate = monthlyEstimate(
    perTurnMicroUsd,
    form.dailyMessageLimit,
    form.amountMinor,
  );
  const showWarning = costWarning(liveEstimate);

  return (
    <div className="package-builder">
      <p>{t('intro')}</p>
      {banner ? (
        <p role="alert" className="package-builder-error">
          {t(`errors.${banner}`)}
        </p>
      ) : null}
      {packages.length === 0 ? <p>{t('empty')}</p> : null}
      {packages.length > 0 ? (
        <ul className="package-builder-list" aria-label={t('listLabel')}>
          {packages.map((pkg) => {
            const estimate = pkg.estimate;
            return (
              <li key={pkg.packageId} className="package-builder-card">
                <h3>{pkg.draft.name}</h3>
                <p>{t('version', { version: pkg.version })}</p>
                <p>
                  {t('estimateLine', { typical: money(estimate.typicalMicroUsd), max: money(estimate.maxMicroUsd) })}
                </p>
                {estimate.shareOfPrice !== undefined ? (
                  <p>{t('shareOfPrice', { percent: estimate.shareOfPrice })}</p>
                ) : null}
                {costWarning(estimate) ? <p role="alert">{t('costWarning')}</p> : null}
                <button type="button" onClick={() => startEdit(pkg)}>
                  {t('editLabel', { name: pkg.draft.name })}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!setup.styleCard ? (
        <p>
          {t('setupRequired')}{' '}
          <a href={setup.styleCardLink}>{t('setupLink')}</a>
        </p>
      ) : (
        <section>
          <h2>{editingId === null ? t('newPackageTitle') : t('editingTitle', { name: form.name })}</h2>
          {editingId === null ? (
            <p className="package-builder-presets">
              <button type="button" onClick={() => applyPreset(freeStarter)}>
                {t('freePreset')}
              </button>
              <button type="button" onClick={() => applyPreset(fullCourse)}>
                {t('fullPreset')}
              </button>
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="package-builder-error">
              {formError.reason === 'style_card_required' && formError.link ? (
                <>
                  {t('setupRequired')} <a href={formError.link}>{t('setupLink')}</a>
                </>
              ) : formError.reason ? (
                t(`errors.${formError.reason}`)
              ) : (
                t(`errors.${formError.key}`)
              )}
            </p>
          ) : null}
          <form onSubmit={(e) => void onSave(e)}>
            <p className="package-builder-field">
              <label htmlFor="pkg-name">{t('nameLabel')}</label>
              <input
                id="pkg-name"
                value={form.name}
                maxLength={L.nameMaxLength}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </p>
            <fieldset>
              <legend>{t('modulesLabel')}</legend>
              {modules.map((m) => (
                <label key={m.id} className="package-builder-checkbox">
                  <input
                    type="checkbox"
                    checked={form.moduleIds.includes(m.id)}
                    onChange={() => setForm({ ...form, moduleIds: toggleIn(form.moduleIds, m.id) })}
                  />
                  {m.title}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t('skillsLabel')}</legend>
              {OFFERED_SKILLS.map((skill) => (
                <label key={skill} className="package-builder-checkbox">
                  <input
                    type="checkbox"
                    checked={form.skills.includes(skill)}
                    onChange={() => setForm({ ...form, skills: toggleIn(form.skills, skill) })}
                  />
                  {t(`skills.${skill}`)}
                </label>
              ))}
            </fieldset>
            <p className="package-builder-field">
              <label htmlFor="pkg-help-ceiling">{t('helpCeilingLabel')}</label>
              <select
                id="pkg-help-ceiling"
                value={form.helpCeiling}
                onChange={(e) =>
                  setForm({ ...form, helpCeiling: Number(e.target.value) as 1 | 2 | 3 | 4 })
                }
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </p>
            <p className="package-builder-field">
              <label htmlFor="pkg-final-answers">{t('finalAnswersLabel')}</label>
              <select
                id="pkg-final-answers"
                value={form.finalAnswers}
                onChange={(e) => setForm({ ...form, finalAnswers: e.target.value as FinalAnswers })}
              >
                {(['never', 'after_attempt', 'allowed'] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`finalAnswers.${v}`)}
                  </option>
                ))}
              </select>
            </p>
            <p className="package-builder-field">
              <label htmlFor="pkg-daily-limit">{t('dailyMessageLimitLabel')}</label>
              <input
                id="pkg-daily-limit"
                type="number"
                min={L.dailyMessagesMin}
                max={L.dailyMessagesMax}
                value={form.dailyMessageLimit}
                onChange={(e) => setForm({ ...form, dailyMessageLimit: Number(e.target.value) })}
              />
            </p>
            <p className="package-builder-field">
              <label htmlFor="pkg-live-classes">{t('liveClassesPerMonthLabel')}</label>
              <input
                id="pkg-live-classes"
                type="number"
                min={0}
                max={L.liveClassesMax}
                value={form.liveClassesPerMonth}
                onChange={(e) => setForm({ ...form, liveClassesPerMonth: Number(e.target.value) })}
              />
            </p>
            <p className="package-builder-field">
              <label htmlFor="pkg-price">{t('priceLabel')}</label>
              <input
                id="pkg-price"
                type="number"
                min={0}
                step={1}
                aria-describedby="pkg-price-hint"
                value={form.amountMinor / 100}
                onChange={(e) => setForm({ ...form, amountMinor: Math.round(Number(e.target.value) * 100) })}
              />
              <span id="pkg-price-hint">{t('freeHint')}</span>
            </p>
            {form.amountMinor > 0 ? (
              <p className="package-builder-field">
                <label htmlFor="pkg-trial-days">{t('trialDaysLabel')}</label>
                <input
                  id="pkg-trial-days"
                  type="number"
                  min={0}
                  max={L.trialDaysMax}
                  value={form.trialDays}
                  onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })}
                />
              </p>
            ) : null}
            <p className="package-builder-field">
              <label htmlFor="pkg-locked-reply">{t('lockedReplyLabel')}</label>
              <select
                id="pkg-locked-reply"
                value={form.lockedReply}
                onChange={(e) => setForm({ ...form, lockedReply: e.target.value as LockedReply })}
              >
                {(['name_package', 'generic'] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`lockedReply.${v}`)}
                  </option>
                ))}
              </select>
            </p>
            <p aria-live="polite">
              {t('estimateLine', { typical: money(liveEstimate.typicalMicroUsd), max: money(liveEstimate.maxMicroUsd) })}
            </p>
            {liveEstimate.shareOfPrice !== undefined ? (
              <p>{t('shareOfPrice', { percent: liveEstimate.shareOfPrice })}</p>
            ) : null}
            {showWarning ? <p role="alert">{t('costWarning')}</p> : null}
            <button type="submit" disabled={saving}>
              {saving ? t('saving') : editingId === null ? t('createButton') : t('saveButton')}
            </button>
            {editingId !== null ? (
              <button type="button" onClick={cancelEdit}>
                {t('cancelEdit')}
              </button>
            ) : null}
          </form>
        </section>
      )}
    </div>
  );
}
