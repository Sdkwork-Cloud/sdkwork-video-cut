import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const loaderUrl = pathToFileURL(
  path.join(import.meta.dirname, 'typescript-loader.mjs'),
).href;
register(loaderUrl, import.meta.url);

await import(pathToFileURL(
  path.join(import.meta.dirname, 'check-autocut-slicer-planner.mjs'),
).href);
