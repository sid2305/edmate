// Task 9.1: the shared shell every route mounts into -- skip link, header, an optional nav
// slot, an optional sign-out form, and the one `#main` landmark. 8.1's onboarding pages wrap in
// this instead of writing their own chrome (see this task's plan, "Files 9.1 owns").
import type { ReactNode } from 'react';

export interface NavLink {
  href: string;
  label: string;
}

export interface AppShellProps {
  /** The app name shown in the header. */
  brand: string;
  /** Nav links shown in the header; omitted entirely (no empty `<nav>`) when not given. */
  nav?: readonly NavLink[];
  /** A server action for the sign-out form; omitted entirely when not given. */
  signOutAction?: () => void | Promise<void>;
  signOutLabel?: string;
  skipLabel?: string;
  children: ReactNode;
}

/**
 * The shared page chrome: a skip link to `#main`, a header with the brand and an optional nav,
 * an optional one-button sign-out form, and the `<main id="main">` landmark children render in.
 */
export function AppShell({
  brand,
  nav,
  signOutAction,
  signOutLabel = 'Sign out',
  skipLabel = 'Skip to content',
  children,
}: AppShellProps) {
  return (
    <>
      <a className="skip-link" href="#main">
        {skipLabel}
      </a>
      <header className="app-header">
        <span className="app-brand">{brand}</span>
        {nav && nav.length > 0 ? (
          <nav aria-label="Main">
            <ul className="app-nav">
              {nav.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {signOutAction ? (
          <form action={signOutAction}>
            <button type="submit">{signOutLabel}</button>
          </form>
        ) : null}
      </header>
      <main id="main" className="app-main">
        {children}
      </main>
    </>
  );
}
