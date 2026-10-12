// Native-bundle fixtures are memory/disk-heavy. Match the existing Windows CI
// concurrency by default instead of starting one test-file process per CPU.
// Keep every test, assertion and deadline. An explicit developer option is
// forwarded unchanged; this does not affect production workers or providers.
export function boundedStudioTestOptions(options) {
  return options.some(arg=>arg==='--test-concurrency'||arg.startsWith('--test-concurrency='))
    ? [...options] : ['--test-concurrency=3',...options];
}
