// Lets Node run the TypeScript sources directly: the project imports are
// extensionless (bundler resolution), Node's built-in type stripping wants
// explicit `.ts`. Usage: node --import ./bench/register.mjs bench/run.ts
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[a-z]+$/i.test(specifier) &&
      context.parentURL
    ) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of ['.ts', '/index.ts']) {
        if (fs.existsSync(base + ext)) {
          return next(pathToFileURL(base + ext).href, context);
        }
      }
    }
    return next(specifier, context);
  },
});
