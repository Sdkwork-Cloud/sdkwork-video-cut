// Node ESM loader hook that resolves extensionless relative imports of
// TypeScript source files to their `.ts` / `.tsx` counterparts. This lets
// check scripts consume the project source directly via `node` without
// requiring every re-export to spell out a `.ts` extension.
//
// Resolution strategy:
//   1. If the specifier is not relative, leave it alone (the package manager
//      and the rest of Node's resolver handle it).
//   2. If the specifier already has an explicit extension, leave it alone.
//   3. Otherwise try `.ts`, `.tsx`, `/index.ts`, `/index.tsx` in order and
//      use the first hit. This mirrors the way Vite, tsx, and tsc resolve
//      relative imports in the project.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname as dirnameOf, resolve as resolvePath } from 'node:path';

const TS_EXTENSIONS = ['.ts', '.tsx'];
const HAS_KNOWN_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/iu;

function resolveWithExtensions(parentUrl, specifier) {
  const baseDir = parentUrl.startsWith('file://')
    ? dirnameOf(fileURLToPath(parentUrl))
    : process.cwd();
  const absoluteBase = resolvePath(baseDir, specifier);

  const candidates = [
    absoluteBase,
    ...TS_EXTENSIONS.map((ext) => `${absoluteBase}${ext}`),
    ...TS_EXTENSIONS.flatMap((ext) => [`${absoluteBase}/index${ext}`]),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate);
        if (stats.isFile()) {
          return pathToFileURL(candidate).href;
        }
        if (stats.isDirectory()) {
          for (const ext of TS_EXTENSIONS) {
            const indexCandidate = `${candidate}/index${ext}`;
            if (existsSync(indexCandidate)) {
              return pathToFileURL(indexCandidate).href;
            }
          }
        }
      } catch {
        // ignore stat failures and keep trying
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !HAS_KNOWN_EXTENSION.test(specifier)
  ) {
    const parentUrl = context.parentURL ?? '';
    const resolved = resolveWithExtensions(parentUrl, specifier);
    if (resolved) {
      return nextResolve(resolved, context);
    }
  }
  return nextResolve(specifier, context);
}
