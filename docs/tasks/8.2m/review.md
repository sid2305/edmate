# 8.2m review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

parseDocument and the worker's new categorizeFileKind switch end in `never`-typed defaults, so a new DocumentKind or IngestFileKind fails to compile until it is handled; buildSource no longer needs an unchecked cast. parseVtt checks the header and cue timing before the title, and parseSrt checks timing before the title, each with a test showing the earlier error wins. The queue test change is formatting only. Behaviour for valid files is unchanged.

## Findings

None.
