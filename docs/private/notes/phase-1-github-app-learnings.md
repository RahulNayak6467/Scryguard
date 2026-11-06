# Introduction

### What is a Github App
It is a program which connects to github and it runs whenever it receives a notification via a webhook

Three Components
1> Permissions -> What the code is allowed to do on repository like reading the PR, writing in PR, running scripts stc
2> Webhook -> Github uses webhook to communicate or notify the app about the required event
3> Authentication -> Our App uses secure tokens to communicate with the github API

Four types of permissions
1> Repository Permission -> allows your app to access resources related to repositories that are owned where the app is installed
2> Organization Permission -> access resources related to the organization, if installed on organization account
3> Enterprise Permission -> access resources of an enterprise, if installed on enterprise account
4> Account Permission -> access resources related to the user, if user has also authroized your app

### Check Run
A Check Run in GitHub represents the result of an automated check performed on your code, such as testing, linting, or AI code review.

### Why so much restriction in writing
Because if any one steals the scryguard tokens then at max they can write a fake check run nothing else related to the repo or organization, also the product is more aligned for reading rather than writing

- What is the difference between repository permissions and organization permissions?
Repositoru permissons means allowing the resources related to a repo like reading files, writing files, checking PRs etc
Organization permissions means allowing to use resources related to an organization like managing teams, members and projects

- Which permission lets Scryguard read a PR's diff, and is read access enough?
Mostly Scryguard has access to read like reading the contents, PRs, issues it can only have write access to Check runs, yeah the reading access are enough because the product is
mostly related to check whether everything written by the agent is working properly or not instead of giving suggestions

- Which permission lets it create and update a Check Run, and why does that one need write?'
```JSON
{
  "permissions": {
    "checks": "write"
  }
}
```
This one needs write because we need a way to tell whether the test passed or not and since we dont have write access for others as our product is not related to writing the code
so it just uses a check run to show the result of our check

- Which webhook events must it subscribe to, and which permission does each event require?
pull_request: read, issues: read, checkRuns: write and read

- Why not just…? Why not ask for "Contents: write" in case we need it later? What could a thief do with it?
If a thief steals our token they can affect the security as they have access to write anything in the code base which is a threat to security also i am not sure how those apps
handle security when they need to have contents: write as a permission


# Stolen Token Incident

Github got to know that an attacker had stolen the Oauth user tokens issued by Heroku and Travis-CI to download data related to many repos, organizations including npm, it was done without attacking github directly because the tokens in this attack where not stored by github in their original usable format, the attackers got access to AWS API key from the private repos and then they began to attack the npm infrastructure to download details to many users registered on npm, github fixed it by revoking the tokens which were associated with npm, github did not find any evidence that the attackers modifed published npm packages,
The attackers did not need to hack Github's authentication system instead they abused the valid authorization tokens stolen frim Heroku and Travis-CI

- What exactly was stolen, and from whom? (Hint: not from GitHub itself.)
Private repositories data were stolen from those users, organizations etc which had used the github app related ot heroku, and travis CI

- What did the attacker do with the tokens, step by step?
They got access to the Oauth tokens of Heorku and Travis-CI github app, they used the stolen tokens to read the repositories both public and private and got access to a compromised AWS API Key and used it to attack npm's infrastructure to get info of repo associated with npm

- Why did those tokens still work? How long did they last?
The token had no fixed lifetime, github traditional OAuth tokenns could remaind valid indefinetely as long as they contnued to be used,
once github got to know about these incident they revoked those tokens

The token can stop working if
1> The user revokes it
2> Github themselves revoke it
3> The token is being unused for one year

Github OAuth tokens were bearer tokens which means it only checked whether the token is valid or not they did not check who is the sender of the token

- What did GitHub do to stop it?
Github informed the third party integrations Heroku and Travis-CI to revoked there tokens

- Map it to Scryguard: if our installation token leaked from a log line, what could someone do, and for how long?
Someone can read the contents related to the code, PRs and issues etc but they cannot write to any of these at max they can write the checkRun which is less vulnerable to write than the main code files

- Why not just…? Why not store one long-lived token and skip the JWT exchange?'
The problem with a long-lived token is that once someone steals it they can abuse it for the time until github gets to know about whether the token is compromised or not which means if github never gets to know about this then the attacker can abuse it for lifetime, so we need a way of having to provide a TTL for the tokens so even if the attacker steals the token they cannot abuse it for lifetime, so we should use some short-lived tokens to minimize the attack radius and can use techniques like token rotation to strenghten even more, the think is that the attacks like this can happen even now also but we can try to reduce the time for which the token is active and be used for authentication

# Where the secrets live

| What | Where | Secret? |
|---|---|---|
| App ID | `.env` (`GITHUB_APP_ID`) | No |
| Private key | `~/.config/scryguard/`, `chmod 600` | Yes |
| Webhook secret | job 3, will go in `.env` | Yes |

App owner: personal account, "Only on this account".
Installed on: `scryguard-playground` only.
Client secrets: none (no user login).

- Why the key lives outside the repo:
Because there can be chances of exposing them by wrong commit, or if someone got access to the repo then they can abuse it 

- Why `chmod 600`:
6-> Owner can read and write
0-> Group cannot access
0-> Other cannot access
This is done so other process or user cannot access and abuse the secrets

- Why the App ID is not secret:
It is just an indentifier which tells github which github app is asking for the request

- Why install on one test repo only:
the main reason is least privilege. If the key leaks, the damage stops at a throwaway repo, and the real project stays clean. "Easier to find bugs" is a side benefit,also to have fair review and easily evaluation over testing on existing repo as it would be easier to find bugs,
