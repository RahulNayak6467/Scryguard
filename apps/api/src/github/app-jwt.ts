import { sign, type KeyObject } from 'node:crypto';
import type { Clock } from '@scryguard/shared';

const IAT_BACKDATE_SECONDS = 60;
const EXP_AFTER_SECONDS = 540;

interface JwtHeader {
  alg: 'RS256';
  typ: string;
}

interface JwtPayload {
  iat: number;
  exp: number;
  iss: number;
}

export const createAppJwt = (appId: number, key: KeyObject, clock: Clock): string => {
  const jwtHeader: JwtHeader = {
    alg: 'RS256',
    typ: 'JWT',
  };

  // one read so iat and exp come from the same second
  const nowSeconds = Math.floor(clock.nowMs() / 1000);

  const jwtPayload: JwtPayload = {
    iat: nowSeconds - IAT_BACKDATE_SECONDS,
    exp: nowSeconds + EXP_AFTER_SECONDS,
    iss: appId,
  };

  const headerStr = JSON.stringify(jwtHeader);
  const payloadStr = JSON.stringify(jwtPayload);

  const encodedHeader = Buffer.from(headerStr).toString('base64url');
  const encodedPayload = Buffer.from(payloadStr).toString('base64url');

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = sign('sha256', Buffer.from(signingInput), key);
  const encodedSignature = signature.toString('base64url');

  return `${signingInput}.${encodedSignature}`;
};
