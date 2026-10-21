'use server';
// Task 9.1 Phase C: the one sign-out action the teacher placeholder view's `AppShell` wires in.
import { signOut } from '../../src/auth';

export async function signOutAndRedirect(): Promise<void> {
  await signOut({ redirectTo: '/' });
}
