# P1.1 GitHub config at startup: design

## Problem
We should do the check during startup and not when the
first job is delivered, so a config error must be handled
or shown at startup.

Three config:
1. APP_ID -> not a secret, identifies the GitHub App, a number
2. WEBHOOK_SECRET -> authenticates the webhook: whether it is
   from GitHub
3. KEY_PATH -> where the .pem file is

The private key can't go in .env because it is 27 lines
long, so it lives in its own protected .pem file. The webhook
secret goes directly in .env; it is 1 line.

A leaked webhook secret lets someone send fake webhooks. A
leaked private key lets someone act as the App on every
installation, which is much worse. Store a secret according
to how much damage it does.

## Must hold
1. The API never starts with a missing or invalid GitHub setting.
2. The key is read and loaded once at startup; config hands
   the loaded key, not the path.
3. The key's asymmetricKeyType is 'rsa', else reject.
4. The webhook secret is at least 32 characters (128 bits if hex).
5. Errors show the setting's name and a reason, never the
   value, the path or raw error messages.

## Failure cases
| Case | Expected |
|---|---|
| A setting is not set | startup fails, names it |
| APP_ID not a number (`abc`) | startup fails, names APP_ID |
| Key file missing or unreadable | read fails, names KEY_PATH |
| Key file empty or garbage | createPrivateKey fails, names KEY_PATH |
| Key loads but is not RSA | `GITHUB_PRIVATE_KEY_PATH: not an RSA private key
| Secret under 32 characters | startup fails, names WEBHOOK_SECRET |

## Flow
read .env → APP_ID is a number → read key file →
createPrivateKey → type is 'rsa' → secret length ok →
hand loaded key to the app → start server

Any step fails → setting name + reason → stop.

## Known limitations
- No regex: there is no universal pattern for the secret.
  Length does not guarantee randomness.
- Config can't tell whether the secret is correct; only a
  real webhook can.
- Rotating the key needs a restart.
