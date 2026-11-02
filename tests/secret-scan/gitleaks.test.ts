import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../..');
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const randomFrom = (alphabet: string, length: number) =>
  Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');

const privateKeyPem = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;

const findingsSchema = z.array(z.object({ RuleID: z.string(), File: z.string() }));

const SECRETS = [
  {
    file: 'classic-pat.txt',
    ruleId: 'github-pat',
    content: () => `ghp_${randomFrom(ALPHANUMERIC, 36)}`,
  },
  {
    file: 'app-token.txt',
    ruleId: 'github-app-token',
    content: () => `ghs_${randomFrom(ALPHANUMERIC, 36)}`,
  },
  {
    file: 'fine-grained-pat.txt',
    ruleId: 'github-fine-grained-pat',
    content: () => `github_pat_${randomFrom(`${ALPHANUMERIC}_`, 82)}`,
  },
  { file: 'app-private-key.pem', ruleId: 'private-key', content: privateKeyPem },
  {
    file: 'scryguard-key.txt',
    ruleId: 'scryguard-api-key',
    content: () => `scg_${randomBytes(32).toString('base64url')}`,
  },
] as const;

const CLEAN_FILE = 'clean.txt';

describe('gitleaks config', () => {
  let scanDir: string;
  let findings: z.infer<typeof findingsSchema>;

  beforeAll(async () => {
    scanDir = await mkdtemp(join(tmpdir(), 'scryguard-gitleaks-'));
    await Promise.all([
      ...SECRETS.map(({ file, content }) =>
        writeFile(join(scanDir, file), `token = "${content()}"\n`),
      ),
      writeFile(join(scanDir, CLEAN_FILE), 'const greeting = "hello";\n'),
    ]);

    const { stdout } = await run('docker', [
      'compose',
      '-f',
      join(repoRoot, 'docker-compose.test.yml'),
      'run',
      '--rm',
      '-v',
      `${scanDir}:/scan:ro`,
      '-v',
      `${join(repoRoot, '.gitleaks.toml')}:/config/gitleaks.toml:ro`,
      'gitleaks',
      'dir',
      '/scan',
      '--config',
      '/config/gitleaks.toml',
      '--no-banner',
      '--redact',
      '--exit-code',
      '0',
      '--report-format',
      'json',
      '--report-path',
      '-',
    ]);
    findings = findingsSchema.parse(JSON.parse(stdout));
  }, 120_000);

  afterAll(async () => {
    await rm(scanDir, { recursive: true, force: true });
  });

  it.each(SECRETS)('catches $file with rule $ruleId', ({ file, ruleId }) => {
    expect(findings.filter((finding) => finding.File === `/scan/${file}`)).toEqual([
      { RuleID: ruleId, File: `/scan/${file}` },
    ]);
  });

  it('reports nothing for a file without secrets', () => {
    expect(findings.filter((finding) => finding.File === `/scan/${CLEAN_FILE}`)).toEqual([]);
  });
});
