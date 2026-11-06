import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No Paystack payload, card data, authorization_url, access_code or QR token
 * in any log line. A source check, like no-query-logging.test.ts: every
 * logger and console call in the source is read, and none may mention one of
 * those values. The runtime half is the last test in
 * paystack/webhook.lifecycle.test.ts, which captures real log output.
 */

const FORBIDDEN = [
  /authorizationUrl/i,
  /authorization_url/i,
  /accessCode/i,
  /access_code/i,
  /\bpayload\b/i,
  /paystackEvent/i,
  /\.data\b/,
  /\bdata\s*[),}]/,
  /\btoken\b/,
  /last4|\bbin\b|card/i,
  /rawBody/,
  /JSON\.stringify/,
  /\bbody\b/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test-support' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Each logger/console call's argument text, comments removed. */
function logCalls(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const calls: string[] = [];
  const start = /(?:this\.logger|logger|Logger|console)\.(?:log|warn|error|debug|verbose|info)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(code))) {
    let depth = 1;
    let i = start.lastIndex;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
      i++;
    }
    calls.push(code.slice(start.lastIndex, i - 1));
  }
  return calls;
}

test('no logger or console call mentions a payload, card data, checkout link, access code or token', () => {
  const srcDir = join(__dirname, '..', 'src');
  const files = sourceFiles(srcDir).filter((f) => !/seed-(site|test-data)\.ts$/.test(f));
  assert.ok(files.length > 20, `scanned only ${files.length} files under ${srcDir}`);

  const offences: string[] = [];
  let scanned = 0;
  for (const file of files) {
    for (const call of logCalls(readFileSync(file, 'utf8'))) {
      scanned++;
      for (const pattern of FORBIDDEN) {
        if (pattern.test(call)) offences.push(`${file.slice(srcDir.length + 1)}: ${pattern} in (${call.trim().slice(0, 120)})`);
      }
    }
  }
  assert.ok(scanned > 10, `found only ${scanned} log calls; the scanner is broken`);
  assert.deepEqual(offences, []);
});

test('the scanner itself catches an offending call (control)', () => {
  const sample = "this.logger.error(`settled ${reference} with ${JSON.stringify(payload)}`);\nthis.logger.log('ok');";
  const calls = logCalls(sample);
  assert.equal(calls.length, 2);
  assert.ok(FORBIDDEN.some((p) => p.test(calls[0])));
  assert.ok(!FORBIDDEN.some((p) => p.test(calls[1])));
});
