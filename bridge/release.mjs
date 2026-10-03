// Shared by health/diagnostics and the packaging gate. Never infer from an
// unrelated parent package.json (frozen runtimes are intentionally portable).
export const RELEASE_VERSION = '0.4.10-alpha';
