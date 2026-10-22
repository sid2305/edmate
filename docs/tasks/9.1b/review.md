# 9.1b review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

All three reviewers approved with no findings. currentPrincipal now logs a failed lookup through the existing describeError helper (error name and Auth.js type only, never the message) and still returns null, so who is signed in does not change. HOME_PATH and TEACHER_PATH sit next to SIGN_IN_PATH and replace every full-route literal; sub-routes stay as they were, so no route or redirect changes. Only the /home page's self-link was removed. Each change has a test that fails without it.

## Findings
- none
