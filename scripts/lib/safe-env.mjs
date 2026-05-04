const PRODUCT_ENV_PREFIX = 'SDKWORK_VIDEO_CUT_';
const LEGACY_PRODUCT_ENV_PREFIX = 'VIDEO_CUT_';
const BROWSER_EXPOSED_ENV_PREFIX = 'VITE_';

function shouldStripBrowserChildProcessKey(key) {
  const normalizedKey = String(key || '').toUpperCase();
  return (
    normalizedKey.startsWith(BROWSER_EXPOSED_ENV_PREFIX) ||
    normalizedKey.startsWith(LEGACY_PRODUCT_ENV_PREFIX) ||
    normalizedKey.startsWith(PRODUCT_ENV_PREFIX)
  );
}

export function createBrowserChildProcessEnv(baseEnv = process.env, overrides = {}) {
  const nextEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (shouldStripBrowserChildProcessKey(key) || value === undefined) {
      continue;
    }
    nextEnv[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (shouldStripBrowserChildProcessKey(key) || value === undefined) {
      continue;
    }
    nextEnv[key] = value;
  }

  return nextEnv;
}
