# Phase 1, P1.1: learnings (2026-11-06 / 07)

Each part: the situation first, then the lesson.

---

# Part 1: The GitHub App

## What a GitHub App is made of

Scryguard is a GitHub App. When I created it, I got three things:

- **App ID**: a number. It says *which* app is talking. Not secret.
- **Private key** (`.pem` file): proves *I am* that app. The most
  powerful secret.
- **Installation**: the App added to one repo. Without it, the App
  can't see anything.

Later (P1.5) the API signs a short JWT with the private key, and GitHub
gives back an **installation token** that works for 1 hour.

Remember: the App ID names the app; the private key proves it.

## Ask for the smallest permissions

Scryguard asks for:

- Checks: read and write (to post the verdict)
- Contents, Pull requests, Issues, Metadata: read only

The story: someone steals Scryguard's token. With these permissions
they can post fake Check Runs. They can't push code or merge anything.

But read is not harmless. `contents: read` on a private repo lets them
clone private code. That is exactly what happened in April 2022:
tokens stolen from Heroku and Travis CI were used to clone private
repos, and the attackers found AWS keys inside.

Remember: an app's power is its permission list; ask for read wherever
read is enough, and remember read can still leak code.

## Event vs permission

- An **event** is "GitHub tells me something happened" (`pull_request`).
- A **permission** is "I'm allowed to read or write this"
  (`pull_requests: read`).

To receive the `pull_request` event, the App needs `pull_requests: read`.
GitHub hides the event list while the webhook is turned off.

## Who owns the App, and where it's installed

The page URL showed the owner: `github.com/settings/apps/new` is my
personal account, `github.com/organizations/<org>/...` is an org.
With "Only on this account", the App can only be installed on the
owner's repos. My test repo is personal, so the App is personal.

The real protection is **"Only select repositories"**: the App can only
reach the repos I picked. A stolen key can't go further than that.

Remember: install an app on the fewest repos it needs.

## Why a separate test repo

`scryguard-playground` is a crash-test dummy. I will open many fake,
broken PRs there (deleted tests, `@ts-ignore`, fake packages). They
shouldn't clutter the real `Scryguard` repo, which goes public. If the
App has a bug, it happens somewhere harmless.

## What a Check Run is

One result row in the "Checks" box of a PR, like CI's "✓ tests passed".
It has a status (queued → in progress → completed), a conclusion
(success, failure, neutral, action required) and a Markdown report.
The ✓ or ✗ is the headline; the report is the reason. Scryguard's
trust report lives in that report. GitHub, not Scryguard, blocks the
merge button, and only if the repo owner makes the check required.

---

# Part 2: Where secrets live

| Secret | Size | Where | Who makes it |
|---|---|---|---|
| App ID | a number | `.env` | GitHub |
| Private key | ~27 lines | own file, `chmod 600`, outside the repo; `.env` has the path | GitHub (Credentials → Key pairs → New key) |
| Webhook secret | 1 line | `.env` | me (`openssl rand -hex 32`) |

- The key is long, so it lives in a file. `.env` only says where.
- `chmod 600` = only my user can read it. Other users and programs on
  the machine can't.
- Use the full path in `.env`, not `~/...`: Node doesn't expand `~`.
- Store a secret by how much damage it does: a leaked webhook secret
  allows fake webhooks; a leaked private key lets someone act as the
  App everywhere it's installed.
- On AWS (phase 10) both come from SSM, not from files.

Remember: GitHub makes the key; I make the webhook secret; neither goes
in the repo.

---

# Part 3: Check config at startup (fail fast)

## The story

A typo in `.env` points the key path at the wrong folder. Without a
check, the API starts and the health check is green. Hours later the
first PR arrives, the API tries to read the key, that request fails,
and the PR never gets a review.

With a startup check, the API stops at once:
`GITHUB_APP_PRIVATE_KEY_PATH could not be read`. Fixed in 10 seconds.

Remember: a config mistake should stop the process at boot, not break a
request hours later.

## "The file exists" is not enough

An empty file, a text file or my SSH key all *exist*. So at startup:

read the file → `createPrivateKey` → check the key type is `'rsa'`

- `createPrivateKey` never sees a file, only its contents. The file
  name and extension don't matter.
- It expects PEM text by default (`-----BEGIN ... PRIVATE KEY-----`).
  GitHub gives PKCS#1 (`BEGIN RSA PRIVATE KEY`); PKCS#8
  (`BEGIN PRIVATE KEY`) works too.
- Modern SSH keys (`BEGIN OPENSSH PRIVATE KEY`) make it throw.
- Check that the type **is** `'rsa'`, not that it "is not Ed25519".
  Allow the one you want; reject everything else.

## Hand over the loaded key, not the path

The API loads the key at 10:00. I delete the file at 11:00. A PR comes
at 11:30. If the app kept the path, it fails at 11:30. If it kept the
loaded key, it works. Trade-off: a new key needs a restart.

## Errors must stay ZodErrors

`loadConfigOrExit` prints a clean `config_invalid` line only for a
ZodError. Any other error is re-thrown, so the terminal shows a stack
trace like `ENOENT: no such file or directory, open '/Users/...'`, with
the path and Node's own text in it.

So the file is read *inside* Zod, in a `.transform` on the field. On a
failure it calls `ctx.addIssue` with my own message and returns
`z.NEVER`. A field transform (not `.superRefine`) because it can
**return something else**: the loaded key instead of the path.

## What an error message may show

- Yes: the setting's name and a reason I wrote myself.
- No: the value, the path, or the raw error text from a library.

I don't control a library's error text. A future version could include
part of the input, and the input here is my private key.

Remember: only print text you wrote yourself.

## A required ID must have no default

`integerEnv` always set a default. If `GITHUB_APP_ID` defaulted to `1`
and I forgot it in `.env`, the API would start and sign tokens as App 1,
someone else's app, and every GitHub call would fail later. So
`fallback` became optional: without it, a missing value says
"GITHUB_APP_ID is required".

## The webhook secret

- One rule: at least 32 characters (32 hex characters = 128 bits).
- No regex: "hex only" would reject a good base64 secret and still
  accept `aaaa...`.
- Length doesn't prove randomness. The real protection is how it's
  made (`openssl rand -hex 32`).
- Config can check how a secret *looks*, not that it's *correct*. Only
  a real webhook proves it matches GitHub.

Picture it: you can look at a key and see it's the right shape; you
only know it opens the door when you try the lock.

## `.env.example` placeholders should fail the rules

The example secret is `change-me` (9 characters). If someone copies
`.env.example` and forgets to change it, the API refuses to start. A
long placeholder sentence would have passed the 32-character rule.

---

# Part 4: The tunnel

## Why a tunnel at all

GitHub lives on the internet; my API runs on my laptop. GitHub can't
POST to `localhost:8000`: for GitHub, "localhost" means GitHub's own
server. My laptop also has no public address.

A **tunnel** gives my laptop a temporary public URL and forwards each
request to `localhost:8000`.

Picture it: a house with no postal address. The tunnel gives it one
for as long as it's running.

In production (phase 10) the API runs on a real server with a real
address, so no tunnel is needed.

## smee vs cloudflared

**smee is a relay, like a post box.** GitHub posts to smee, and smee
answers GitHub "200 OK" straight away, then passes a copy to my laptop.
My API's real answer never reaches GitHub.

**cloudflared is a real tunnel, like a phone line.** GitHub's request
goes all the way to my API, and my API's answer comes back to GitHub.

```
smee:        GitHub → smee ✓200     (my 401 is lost)
cloudflared: GitHub ⇄ Cloudflare ⇄ laptop ⇄ API   (my 401 comes back)
```

Phase 1 tests exactly what GitHub sees: a bad signature must give
GitHub a 401, I measure the acknowledgement time, and Recent Deliveries
must show my API's real status codes. With smee, everything would look
OK while proving nothing. So: cloudflared.

Its cost: a quick tunnel gets a new random URL each time it starts, so
I paste the new URL into the App's webhook settings each session.

Remember: a relay answers for you; a tunnel lets your server answer.

## When cloudflared can't connect

The log said UDP and TCP connectivity "fail" but the Cloudflare API
"pass": normal HTTPS (port 443) worked, but the tunnel's port (7844)
was blocked by the network. Fix: try another network (phone hotspot).
If a network blocks it everywhere, ngrok works over port 443.

Picture it: if a road is closed, try another road to learn whether the
problem is the road or the car.

## Webhook URL and the first delivery

- Webhook URL = the cloudflared URL + `/webhooks/github`. The first
  part changes every session; the path never does.
- Never leave an example URL in a live webhook: GitHub would post repo
  data to a host I don't control. Untick Active until the URL is real.
- Changing the URL doesn't send a new ping. Use Recent Deliveries →
  Redeliver.
- The 404 I got came from **my** API (no route until P1.3): proof of
  the full round trip.
- A redelivery keeps the **same delivery ID**. That's how duplicates
  get detected later (P2.3).
- GitHub showed "Completed in 0.83 seconds". In P1.3 the ack must stay
  well under GitHub's 10-second limit.

---

# Part 5: Webhook signatures (for P1.3)

- **HMAC** = a hash with a secret key built in. `sha256(body)` has no
  secret, so anyone can make one for a fake body.
- `sha256(secret + body)` can be extended without knowing the secret
  (**length extension attack**: SHA-256's output is its internal state,
  so it can be resumed). HMAC puts the key into a second, outer hash,
  so a captured signature can't be extended.
- Verify the **raw bytes** GitHub signed, never `JSON.stringify(req.body)`:
  spaces, Unicode escapes and number formats change the bytes, so the
  HMAC changes.
- Compare signatures in constant time (`timingSafeEqual`), and check the
  lengths first: it throws when they differ.

Remember: verify the bytes that were signed, never a rebuilt copy.

---

# Part 6: Working habits

- When a question is abstract, make my own example. That's a skill,
  not a weakness.
- Read theory just before the task that uses it.
- Answer the design questions before writing code: they become the
  rules, and each failure case becomes a test.
- When I know the design but not an API's syntax, a "syntax handover"
  is allowed after the design is approved. I still explain every line.
- Zed opened `.md` files in read-only preview; that's now off. In vim
  mode, press `i` before typing.
