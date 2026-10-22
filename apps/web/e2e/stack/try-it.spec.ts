// Task 9.0 Phase C: the try-it flow (docs/try-it.md), end to end on the local compose stack
// through Caddy. Staff, the demo teacher and a fresh student sign in through Mailpit links; the
// teacher edits the profile, staff verify it, the teacher uploads docs/try-it/sample-lesson.md and
// it reaches Ready; the student passes the age gate, starts the paid package and asks the lesson's
// question. With EDMATE_DEV_MODEL=scripted the reply quotes the lesson; EDMATE_STACK_EXPECT=real
// only asks for a final reply with no error. Fictional .test / .invalid addresses only.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { dbCli, signInByEmail } from './mail';

const HERE = dirname(fileURLToPath(import.meta.url));
const LESSON = join(HERE, '..', '..', '..', '..', 'docs', 'try-it', 'sample-lesson.md');
const STAFF = 'staff@example.test';
const TEACHER = 'demo-teacher@example.invalid';
const QUESTION = 'What is the tamarind counter rule?';
const EXPECT_REAL = process.env.EDMATE_STACK_EXPECT === 'real';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test('try it: teacher uploads a lesson, a student chats about it', async ({ browser }) => {
  // Staff: sign in once (everyone starts as a student), then grant the role from the CLI. A rerun
  // skips the sign-in, which saves one of the address's 5 sign-in links an hour.
  const grant = () => dbCli('grant-role.js', ['--email', STAFF, '--role', 'staff', '--by', 'operator']);
  let granted: string;
  try {
    granted = grant();
  } catch {
    const staffContext = await browser.newContext();
    await signInByEmail(await staffContext.newPage(), STAFF);
    await staffContext.close();
    granted = grant();
  }
  const staffId = /user (\S+) is now staff/.exec(granted)?.[1];
  expect(staffId, granted).toBeTruthy();

  // Teacher: edit the profile, staff verify it, the banner says so.
  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  await signInByEmail(teacher, TEACHER);
  await teacher.goto('/teacher/onboarding');
  await teacher.getByLabel('Bio').fill(`Python teacher. Profile saved by the try-it run, ${new Date().toISOString()}.`);
  await teacher.getByRole('button', { name: 'Save changes' }).click();
  await expect(teacher.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  // Scoped to the form: Next's route announcer is an empty role="alert" too.
  await expect(teacher.locator('form').getByRole('alert')).toHaveCount(0);
  dbCli('verify-teacher.js', ['--email', TEACHER, '--status', 'verified', '--by', staffId!]);
  await teacher.reload();
  await expect(teacher.getByRole('status')).toHaveText('Your profile is verified.');
  await shot(teacher, '1-teacher-verified');

  // Upload: the page polls every 4 s; wait for one more Ready row than before.
  await teacher.goto('/teacher/uploads');
  const rows = teacher.locator('.uploads-row', { hasText: 'sample-lesson' });
  const readyRows = rows.filter({ hasText: 'Ready' });
  await expect(teacher.getByText('Loading your files…')).toHaveCount(0);
  const readyBefore = await readyRows.count();
  await teacher.getByLabel('Upload a file').setInputFiles(LESSON);
  await expect(readyRows).toHaveCount(readyBefore + 1, { timeout: 90_000 });
  await shot(teacher, '2-upload-ready');
  await teacherContext.close();

  // Student: a fresh address each run (5 sign-in links per address per hour).
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await signInByEmail(student, `student-${Date.now()}@example.test`);
  await student.goto('/welcome/age');
  await student.getByLabel('Where do you live?').selectOption('US');
  await student.getByRole('button', { name: 'Next' }).click();
  await student.getByLabel('What year were you born?').fill('1990');
  await student.getByRole('button', { name: 'Continue' }).click();
  await expect(student).not.toHaveURL(/\/welcome\/age/);
  await shot(student, '3-student-age-done');

  await student.goto('/home');
  await student.getByRole('link', { name: 'Start a package' }).click();
  await expect(student).toHaveURL(/\/packages\/demo-agent/);
  await student
    .locator('li', { has: student.getByRole('heading', { name: 'Full course' }) })
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(student).toHaveURL(/\/learn\/demo-agent/);
  await shot(student, '4-student-package-started');

  // Chat: wait for the final (not provisional) reply.
  // Retry until the client has hydrated and the question shows in the thread.
  const thread = student.locator('ol[aria-live="polite"]');
  await expect(async () => {
    await student.getByLabel('Your message').fill(QUESTION);
    await student.getByRole('button', { name: 'Send' }).click();
    await expect(thread).toContainText(QUESTION, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(student.getByText('The tutor is replying…')).toHaveCount(0, { timeout: 120_000 });
  await expect(student.locator('.chat-provisional')).toHaveCount(0);
  await expect(student.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  if (EXPECT_REAL) {
    await expect(thread.locator('li').last()).not.toBeEmpty();
  } else {
    await expect(thread).toContainText('[dev model]');
    await expect(thread).toContainText('starts at 7 and goes up by 3');
  }
  await shot(student, '5-student-chat-reply');
  await studentContext.close();
});
