// Task 9.2 Phase B: the public /teachers page's nav -- "Sign in" for an anonymous visitor, or the
// visitor's own home link plus a sign-out button for anyone signed in. Reuses the one sign-out
// action `/home` already wires in (read-only import; this file does not change home/actions.ts).
import { signOutAndRedirect } from '../../app/home/actions';
import { HOME_PATH, SIGN_IN_PATH, TEACHER_PATH, type Principal } from '../auth';
import type { NavLink } from '../ui/AppShell';

export interface PublicNavLabels {
  signIn: string;
  home: string;
}

export interface PublicNav {
  nav: NavLink[];
  signOutAction?: () => void | Promise<void>;
}

const ROLE_HOME: Partial<Record<Principal['role'], string>> = {
  student: HOME_PATH,
  teacher: TEACHER_PATH,
};

/** `principal` comes from `currentPrincipal()`, which never throws (it reads as signed out). */
export function publicNav(principal: Principal | null, labels: PublicNavLabels): PublicNav {
  if (!principal) return { nav: [{ href: SIGN_IN_PATH, label: labels.signIn }] };
  const href = ROLE_HOME[principal.role] ?? SIGN_IN_PATH;
  return { nav: [{ href, label: labels.home }], signOutAction: signOutAndRedirect };
}
