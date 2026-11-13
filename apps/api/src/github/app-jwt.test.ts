import { generateKeyPairSync, verify } from 'node:crypto';

import type { Clock } from '@scryguard/shared';
import { describe, expect, it } from 'vitest';

import { createAppJwt } from './app-jwt.js';

const APP_ID = 123_456;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { publicKey: otherPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const fixedClock = (nowMs: number): Clock => ({
  nowMs: () => nowMs,
  monotonicMs: () => 0,
});

const splitToken = (token: string): { header: string; payload: string; signature: string } => {
  const [header = '', payload = '', signature = '', ...rest] = token.split('.');
  expect(rest).toHaveLength(0);
  return { header, payload, signature };
};

const decodePart = (part: string): unknown =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const verifyParts = (
  header: string,
  payload: string,
  signature: string,
  key = publicKey,
): boolean =>
  verify('sha256', Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'));

describe('createAppJwt', () => {
  it('returns a three-part RS256 token whose signature verifies with the matching public key', () => {
    const token = createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_000));

    const parts = token.split('.');
    const { header, payload, signature } = splitToken(token);

    expect(parts).toHaveLength(3);
    expect(verifyParts(header, payload, signature)).toBe(true);
    expect(decodePart(header)).toStrictEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('fails verification when one character of the payload is changed', () => {
    const { header, payload, signature } = splitToken(
      createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_000)),
    );
    const replacement = payload[0] === 'A' ? 'B' : 'A';
    const tamperedPayload = `${replacement}${payload.slice(1)}`;

    expect(tamperedPayload).not.toBe(payload);
    expect(verifyParts(header, tamperedPayload, signature)).toBe(false);
  });

  it('fails verification with the public key of a different key pair', () => {
    const { header, payload, signature } = splitToken(
      createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_000)),
    );

    expect(verifyParts(header, payload, signature, otherPublicKey)).toBe(false);
  });

  it('sets iat 60 seconds before now, exp 540 seconds after now and iss to the numeric app id', () => {
    const { payload } = splitToken(createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_000)));

    expect(decodePart(payload)).toStrictEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: APP_ID,
    });
  });

  it('floors milliseconds so the last millisecond of a second gives the same claims as its first', () => {
    const start = splitToken(createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_000)));
    const end = splitToken(createAppJwt(APP_ID, privateKey, fixedClock(1_700_000_000_999)));

    expect(decodePart(end.payload)).toStrictEqual(decodePart(start.payload));
    expect(decodePart(end.payload)).toStrictEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: APP_ID,
    });
  });
});
