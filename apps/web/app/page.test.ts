// Task 9.1 Phase C / 9.2 Q3: the `/` dispatcher. Written and red before `page.tsx` exists (TDD).
// Four branches over a stubbed `currentPrincipal`: anonymous now lands on `/teachers` (9.2), staff
// still lands on sign-in (no staff console exists yet -- a logged decision, not a blocker),
// student lands on `/home`, teacher on `/teacher`.
import { describe, expect, it, vi } from 'vitest';

const { currentPrincipal, redirect } = vi.hoisted(() => ({
  currentPrincipal: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('../src/auth', () => ({ currentPrincipal, SIGN_IN_PATH: '/sign-in' }));
vi.mock('next/navigation', () => ({ redirect }));

async function dispatch() {
  const { default: HomePage } = await import('./page');
  await HomePage();
}

describe('the `/` dispatcher', () => {
  it('sends an anonymous visitor to /teachers (9.2)', async () => {
    currentPrincipal.mockResolvedValueOnce(null);
    await expect(dispatch()).rejects.toThrow('REDIRECT /teachers');
  });

  it('sends a student to /home', async () => {
    currentPrincipal.mockResolvedValueOnce({ userId: 'u1', role: 'student' });
    await expect(dispatch()).rejects.toThrow('REDIRECT /home');
  });

  it('sends a teacher to /teacher', async () => {
    currentPrincipal.mockResolvedValueOnce({ userId: 'u2', role: 'teacher' });
    await expect(dispatch()).rejects.toThrow('REDIRECT /teacher');
  });

  it('sends staff to sign-in (no staff console exists yet)', async () => {
    currentPrincipal.mockResolvedValueOnce({ userId: 'u3', role: 'staff' });
    await expect(dispatch()).rejects.toThrow('REDIRECT /sign-in');
  });
});
