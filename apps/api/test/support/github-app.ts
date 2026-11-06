import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_WEBHOOK_SECRET = 'test-only-webhook-secret-0123456789abcdef';

export interface GithubAppFixture {
  readonly dir: string;
  readonly privateKey: KeyObject;
  readonly env: {
    readonly GITHUB_APP_ID: string;
    readonly GITHUB_APP_WEBHOOK_SECRET: string;
    readonly GITHUB_APP_PRIVATE_KEY_PATH: string;
  };
  writeFile(name: string, content: string): string;
  cleanup(): void;
}

export const createGithubAppFixture = (): GithubAppFixture => {
  const dir = mkdtempSync(join(tmpdir(), 'scryguard-github-app-'));
  const writeFile = (name: string, content: string): string => {
    const path = join(dir, name);
    writeFileSync(path, content, { mode: 0o600 });
    return path;
  };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPath = writeFile(
    'app.private-key.pem',
    privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  );

  return {
    dir,
    privateKey,
    env: {
      GITHUB_APP_ID: '123456',
      GITHUB_APP_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      GITHUB_APP_PRIVATE_KEY_PATH: keyPath,
    },
    writeFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};
