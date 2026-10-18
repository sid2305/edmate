// Every gateway test runs with the global fetch replaced: an adapter that ignored the injected
// fake transport and fell back to the global one fails loudly instead of reaching a server.
globalThis.fetch = () =>
  Promise.reject(new Error('real network is off in gateway tests; pass a fetch-mock'));
