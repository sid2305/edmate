// Task 9.2e item 8. No test file existed for nav.ts before this; covers the four principal shapes
// ROLE_HOME can see, each with/without a sign-out action.
import { describe, expect, it } from 'vitest';
import { publicNav } from './nav';

const labels = { signIn: 'Sign in', home: 'Home' };

describe('publicNav', () => {
  it('sends an anonymous visitor to sign-in, with no sign-out action', () => {
    const nav = publicNav(null, labels);
    expect(nav.nav).toEqual([{ href: '/sign-in', label: 'Sign in' }]);
    expect(nav.signOutAction).toBeUndefined();
  });

  it('sends a student to their home, with a sign-out action', () => {
    const nav = publicNav({ userId: 'u1', role: 'student' }, labels);
    expect(nav.nav).toEqual([{ href: '/home', label: 'Home' }]);
    expect(nav.signOutAction).toBeDefined();
  });

  it('sends a teacher to their home, with a sign-out action', () => {
    const nav = publicNav({ userId: 'u1', role: 'teacher' }, labels);
    expect(nav.nav).toEqual([{ href: '/teacher', label: 'Home' }]);
    expect(nav.signOutAction).toBeDefined();
  });

  it('sends a staff principal to /staff, with a sign-out action', () => {
    const nav = publicNav({ userId: 'u1', role: 'staff' }, labels);
    expect(nav.nav).toEqual([{ href: '/staff', label: 'Home' }]);
    expect(nav.signOutAction).toBeDefined();
  });
});
