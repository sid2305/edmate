// @vitest-environment jsdom
// Task 9.1: the shared shell -- skip link, header, optional nav, optional sign-out, main
// landmark. Written and red before AppShell.tsx exists (TDD); the axe assertion is the actual
// accessibility bar the plan's Acceptance section checks cheaply, not a retrofit.
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, expect, it, beforeAll } from 'vitest';
import { AppShell } from './AppShell';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('AppShell', () => {
  it('has a skip link to the main landmark', () => {
    render(
      <AppShell brand="Edmate">
        <p>content</p>
      </AppShell>,
    );
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('renders children inside the main landmark', () => {
    render(
      <AppShell brand="Edmate">
        <p>hello there</p>
      </AppShell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('hello there');
  });

  it('renders no nav and no sign-out form when neither is given', () => {
    render(
      <AppShell brand="Edmate">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('renders the given nav links', () => {
    render(
      <AppShell brand="Edmate" nav={[{ href: '/home', label: 'Home' }]}>
        <p>content</p>
      </AppShell>,
    );
    const link = screen.getByRole('link', { name: 'Home' });
    expect(link).toHaveAttribute('href', '/home');
  });

  it('renders a sign-out form when signOutAction is given', () => {
    const signOutAction = async () => {};
    render(
      <AppShell brand="Edmate" signOutAction={signOutAction}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('has no axe violations with nav and sign-out', async () => {
    const signOutAction = async () => {};
    const { container } = render(
      <AppShell brand="Edmate" nav={[{ href: '/home', label: 'Home' }]} signOutAction={signOutAction}>
        <p>content</p>
      </AppShell>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with neither nav nor sign-out', async () => {
    const { container } = render(
      <AppShell brand="Edmate">
        <p>content</p>
      </AppShell>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
