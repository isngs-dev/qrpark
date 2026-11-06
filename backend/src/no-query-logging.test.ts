import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';

/**
 * Prisma must never log queries: query logs print parameters, and from
 * Sprint 2 the parameters include QR tokens.
 *
 * Two checks. The configured log levels of the real PrismaService, and a scan
 * of every source file for a 'query' log level or a query-event listener, so
 * a second client cannot be created with query logging either.
 */

test('PrismaService is configured not to log queries', () => {
  const prisma = new PrismaService();
  // Prisma 5 records the parsed `log` option here: logQueries is true exactly
  // when 'query' is among the levels (checked by hand for both cases).
  const config = (prisma as unknown as { _engineConfig: { logQueries?: boolean } })._engineConfig;
  assert.equal(config.logQueries, false, 'Prisma is configured to log queries');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

test('no source file enables Prisma query logging', () => {
  // dist-test/<file>.js runs from dist-test; the sources are two levels up.
  const srcDir = join(__dirname, '..', 'src');
  const files = sourceFiles(srcDir);
  assert.ok(files.length > 10, `scanned only ${files.length} files under ${srcDir}`);

  const offenders = files.filter((file) => {
    const text = readFileSync(file, 'utf8')
      // Comments may mention the rule; only code counts.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return (
      /log\s*:\s*\[[^\]]*['"]query['"]/.test(text) ||
      /level\s*:\s*['"]query['"]/.test(text) ||
      /\$on\(\s*['"]query['"]/.test(text)
    );
  });
  assert.deepEqual(offenders, []);
});
