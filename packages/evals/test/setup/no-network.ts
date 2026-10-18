// Every evals test runs with the global fetch replaced, so a live model call fails loudly
// instead of reaching a server (rule 4; 3.12 "runs fully offline in CI").
globalThis.fetch = () =>
  Promise.reject(new Error('real network is off in evals tests; use the scripted gateway'));
