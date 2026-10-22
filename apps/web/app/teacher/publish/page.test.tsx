// @vitest-environment jsdom
// Task 8.7 Phase D: the /teacher/publish page. Teachers only; the guard runs before anything
// else renders, and the page itself never reads the database (the client component fetches the
// API).
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock('../../../src/auth', () => ({ requireRole: state.requireRole, TEACHER_PATH: '/teacher' }));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./PublishView', () => ({
  PublishView: () => <p>publish view</p>,
}));

import PublishPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
});

describe('/teacher/publish', () => {
  it('asks for a teacher before rendering anything', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await PublishPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Publish');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Publish' })).toHaveAttribute(
      'href',
      '/teacher/publish',
    );
  });

  it('renders nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(PublishPage()).rejects.toThrow('NOT_FOUND');
  });
});
