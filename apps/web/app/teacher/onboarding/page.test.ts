// @vitest-environment jsdom
// Task 8.1a: the /teacher/onboarding page. Teachers only; the guard runs before any database
// read, and the profile read is always the session's own teacher (never a request field).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  get: vi.fn(async (_scope: { teacherId: string }) => null as unknown),
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { teacherProfiles: { get: state.get } } }),
  TEACHER_PATH: '/teacher',
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import OnboardingPage from './page';

const PROFILE = {
  id: 'tp_1',
  teacherId: 'tch_a',
  slug: 'asha-math',
  subject: 'Math',
  bio: '',
  languages: [],
  verificationStatus: 'pending' as const,
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.get.mockReset();
  state.get.mockResolvedValue(null);
});

describe('/teacher/onboarding', () => {
  it('asks for a teacher, then reads only that teacher\'s own profile', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await OnboardingPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.get).toHaveBeenCalledWith({ teacherId: 'tch_a' });
  });

  it('teacher with no profile renders create mode', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.get.mockResolvedValueOnce(null);
    render(await OnboardingPage());
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
  });

  it('teacher with a profile renders edit mode, prefilled, with its banner', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.get.mockResolvedValueOnce(PROFILE);
    render(await OnboardingPage());
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Math')).toBeInTheDocument();
    expect(screen.getByText(/waits on staff verification/i)).toBeInTheDocument();
  });

  it('reads no profile when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(OnboardingPage()).rejects.toThrow('NOT_FOUND');
    expect(state.get).not.toHaveBeenCalled();
  });
});
