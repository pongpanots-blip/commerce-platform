import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture fitness test enforcing the module dependency direction from the
 * design (§5). A module scope may only import from the scopes listed below
 * (plus its own scope and non-module code like shared-kernel/config). This is
 * what keeps the monolith extractable into microservices later.
 *
 *   core        -> (nothing above it)
 *   platform    -> core
 *   commerce    -> core, platform
 *   integration -> core, commerce, platform
 */
const ALLOWED: Record<string, Set<string>> = {
  core: new Set<string>(),
  platform: new Set(['core']),
  commerce: new Set(['core', 'platform']),
  integration: new Set(['core', 'commerce', 'platform']),
};

const MODULES_ROOT = path.resolve(__dirname);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) return [full];
    return [];
  });
}

function scopeOf(absPath: string): string | null {
  const rel = path.relative(MODULES_ROOT, absPath);
  const first = rel.split(path.sep)[0];
  return first in ALLOWED ? first : null;
}

function importSources(content: string): string[] {
  const sources: string[] = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) sources.push(m[1]);
  return sources;
}

describe('module boundaries', () => {
  it('respects the scope dependency direction', () => {
    const violations: string[] = [];

    for (const file of walk(MODULES_ROOT)) {
      const fromScope = scopeOf(file);
      if (!fromScope) continue;

      for (const source of importSources(fs.readFileSync(file, 'utf8'))) {
        if (!source.startsWith('.')) continue; // external/shared-kernel — allowed
        const resolved = path.resolve(path.dirname(file), source);
        const toScope = scopeOf(resolved);
        if (!toScope || toScope === fromScope) continue; // same scope or non-module

        if (!ALLOWED[fromScope].has(toScope)) {
          violations.push(
            `${path.relative(MODULES_ROOT, file)} (${fromScope}) imports ${toScope}: ${source}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
