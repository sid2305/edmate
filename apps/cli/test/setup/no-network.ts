// CLI tests run with the global fetch replaced, so a live model call fails loudly instead of
// reaching a server (rule 4).
globalThis.fetch = () =>
  Promise.reject(new Error('real network is off in cli tests; use the scripted gateway'));
