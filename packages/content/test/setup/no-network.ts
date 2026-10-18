// Content validation reads local files only; a network call fails the test run (rule 4).
globalThis.fetch = () => Promise.reject(new Error('real network is off in content tests'));
