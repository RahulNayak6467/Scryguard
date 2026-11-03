if (process.env.TEST_LEAKED_HANDLE === 'true') {
  setInterval(() => undefined, 1_000);
}
