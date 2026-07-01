export type AutoCutRuntimeEnvironment = 'dev' | 'release';

const AUTO_CUT_RUNTIME_ENVIRONMENTS: readonly AutoCutRuntimeEnvironment[] = ['dev', 'release'];
const AUTO_CUT_DEFAULT_RUNTIME_ENVIRONMENT: AutoCutRuntimeEnvironment = 'release';

let configuredAutoCutRuntimeEnvironment: AutoCutRuntimeEnvironment = AUTO_CUT_DEFAULT_RUNTIME_ENVIRONMENT;

export function configureAutoCutRuntimeEnvironment(environment: AutoCutRuntimeEnvironment) {
  configuredAutoCutRuntimeEnvironment = normalizeAutoCutRuntimeEnvironment(environment);
}

export function getAutoCutRuntimeEnvironment(): AutoCutRuntimeEnvironment {
  return configuredAutoCutRuntimeEnvironment;
}

export function createAutoCutRuntimeScopedName(name: string): string {
  return `${configuredAutoCutRuntimeEnvironment}-${name}`;
}

function normalizeAutoCutRuntimeEnvironment(environment: AutoCutRuntimeEnvironment): AutoCutRuntimeEnvironment {
  return AUTO_CUT_RUNTIME_ENVIRONMENTS.includes(environment)
    ? environment
    : AUTO_CUT_DEFAULT_RUNTIME_ENVIRONMENT;
}
