# Token client: design

## Problem
How to handle cache stampede, suppose there are 10k reviews going on nearly at the same time and during this time the cache is empty hence every review will request to the route for the installation token this leads to a thundering herd problem which can affect the github rate limit
Handling expired token in the middle of a review, suppose at 12:00 the review starts it does one call to github and the token is working and lets consider the tokens get expired at 12:20 but at 12:19:48 a call is sent and model takes 30s to respond so during this time the token gets expired and github returns 401 error

## Must hold
-> no caller gets a token within last 5min of the expires_at
-> one exchange per installation at a time (per process)
-> Every information obtained from github must be validated using zod
-> a failed exchange is never cached; the next call starts a fresh one
-> a token or JWT never appears in an error or a log

## Failure cases
1. Bad expires_at (missing, invalid,
   near expiry) → error, nothing cached
2. 200 reply with wrong shape (no token)
   → error, nothing cached
3. 500 or timeout → retryable error,
   nothing cached
4. 401 → not retryable
5. 429 → retryable after the stated wait
6. 404 → not_found, not retryable
7. Two callers waiting on one exchange,
   it fails → both get the error; the next
   call starts a fresh exchange
8. No token or JWT in any error message

## Flow 
-> cache has a token, now < expiry − 5 min
  → return it
cache has a promise in flight
  → await it
else
→ start exchange: JWT → POST
  (Bearer, 10 s) → Zod
→ store its promise NOW, then await
→ success: store token, return it
→ failure: remove entry, throw

## Options
In-memory Map per process, not Redis:
single-flight needs a shared promise,
tokens stay out of shared storage, one
less dependency that can fail.

## Known limitations
- A token cached before an uninstall
  gets 401s until it ages out (phase 2)
- Entries never evicted; one per
  installation, small
