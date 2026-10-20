// Every ingest test runs with the global fetch replaced: code that ignored the injected fake
// transport and fell back to the global one fails loudly instead of reaching a server (rule 4).
globalThis.fetch = () =>
  Promise.reject(new Error('real network is off in ingest tests; inject a fake fetch'));
