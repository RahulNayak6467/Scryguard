### Step 3: predict before running. Write down your answers to these three questions:

1. Someone with no secret sends a made-up pull_request payload for repo evil/repo, PR #999. What status do they get back?
they get back 202 response status because there is no checking happening on the server side whether the webhook is received by github or not

2. What does your log line say Scryguard is about to do?
The log line tells that the action is opened for the PR number 999 , with the full name of the repo

3. Fast forward to phase 3, when this handler queues a review and a Check Run gets posted. What could that attacker do with this endpoint?
If the attacker uses curl 10k times concurrently then it would lead to queue flooding and a real PR would not be noticed, it would increase the infra cost if we use frontier models, also wrong allocation of resources and github rate limit would be used on the fake ones so the real pr have to wait
The attacker sends a forged payload naming your real repo and some installation.id,Scryguard trusts it, swaps that installation ID for a real token (P1.5), fetches the diff and posts a Check Run.

### What suprised me
There are two types of attack
1> Forging -> Where the attacker sends a fake request to our end point they dont know our webhook secret, so they cant make a valid signature hence we would HMAC to check it
2> Replaying -> Suppose Github sends a real PR event + body + valid signature -> Scryguard reviews it, attacker copies the exact request from a leaked log and then sends the same request which scryguard approves and it again reviews it, to fix this we would use the time when the same request was delivered and then add a timestamp and then reject it if the same request was sent after the timelimit
