### Understanding the problem
Before fetching the diff or checking a run basically using the github api our app needs to prove github that is it what it claims to be so this
is done by using JWT tokens which we will understand how to implement properly

### Common problems which we need to understand
-> Many times a review needs to call github api multiple times so underload it wastes the rate limit and also increases latency
One idea to solve this problem can be to use a cache and reuse it until it expires but there are be some challenges to it

For example lets say our app requires 3 calls during a review and after the 2nd call the token is expired hence during the 3rd call the expired
token is in the cache and our app uses this expired token for the call and github returns 401, now how to tackle it will be discussed later

-> Another trap is lets say two reviews start at the same moment with empty cache and hence they both fetch a token now the problem is at scale many requests will happen at once for the same token and that leads to a cache stampede called thundering herd

### Using JWT to authenticate as a github app
We need to generate a JWT(JSON WEB TOKEN) for authenticating our github app we must include four properties or attrinutes
1> iat -> Issued At -> It is the time when we issued the JWT(creation time), github recommends to set it 60s in the past to avoid clock drift problems, and ensure our server's date and time is set accurately
2> exp -> Expires At -> It is the expiration time of the JWT after this it cant be used to authenticate as github would return 401, we need to generate a new JWT token also github recommends the token expires Duration to not be more than 10minutes RS256 = RSA signature over SHA-256.
It is a digital signature (key pair), not a MAC (shared secret).

It is recommended to use Authorization: Bearer for sending the jwt token
We can also use the Github's Octokit SDks to authenticate as an app instead of building our own JWT token, it handles the expiration and other stuff

### Using an installation access token to authenticare as an app installation
To authenticate as an app INSTALLATION, we first generate an installation access token (using the app JWT), then send it in the Authorization header of REST or GraphQL requests. It expires after 1 hour.

Steps for generating installation access token
-> Generate the JWT token
-> Get the ID of the installation, if we are responding to a webhook event then we can use the installation ID payload received from the webhook event, we can also use the REST API for finding the ID for an installation
-> Send a REST API POST request to /app/installations/INSTALLATION_ID/access_tokens. Include your JSON web token in the Authorization header of your request. Replace INSTALLATION_ID with the ID of the installation that you want to authenticate as.

#### Optional attributes to include
-> We can also include the permissions that the installation token should have, if not specified the installation tokens have all the permission which were granted to the app, also the installation token cannot be granted those permissions which were not granted to the app
-> We can also specify the repositories which we want this installation token to access using respositories or repository_ids attributes

The instllation token lasts for around an hour
To authenticate with an installation access token include it in the Authorization header of an API request

```JSON
{
  "token": "ghs_...",
  "expires_at": "2026-11-10T11:42:07Z",
  "permissions": {
    "checks": "write",
    "contents": "read",
    "issues": "read",
    "metadata": "read",
    "pull_requests": "read"
  },
  "repository_selection": "selected"
}
```
A successful installtion access token creation response
Common Failures
(Statuses and causes are what matter; the message texts below are approximate examples, not copied from GitHub's docs.)
401  {"message": "A JSON web token could not be decoded"}
     → bad JWT (wrong key, malformed)
401  {"message": "'Expiration time' claim ('exp') is too far in the future"}
     → exp more than 10 min ahead
401  {"message": "'Issued at' claim ('iat') must be an Integer representing the time that the assertion was issued"}
     → iat in the future (your clock is ahead)
404  {"message": "Not Found"}
     → wrong installation ID, or the App was uninstalled

### Intoduction to JWTS

#### What is a JSON WEB TOKEN
It is a standared that defines a compact and selfcontained way of securely tramsitting information between parties as JSON object, this information can be verified and trusted using HMAC algorithm or a public/private key pair using RSA or ECDSA,
JWT can be encrypted but we will use signed tokens here which are not encrypted rather there aim is to maintain the integrity of the message such that no one chnages the claims, Base64Url is ENCODING, not encryption: anyone can decode the header and payloa (e.g. paste it into jwt.io). The signature stops changes, not reading. Never put a secret inside the claims.

### JWT Structure
-> Header -> consisis of two parts algorithm used and token type
```JSON
{
  "alg": "HS256",
  "typ": "JWT"
}
```
Then this JSON is Base64Url encoded to form the first part of the HWT

-> Payload -> These are the claims tat are the statements shared without entities, there are three types of claims
1> Registered claims -> Claims not mandatory but recommended like iat, iss, sub, aud etc
2> Public claims
3> Private claims -> These are the claims that share information between parties
```JSON
{
  "sub": "1234567890",
  "name": "John Doe",
  "admin": true
}
```
The payload is then Base64Url encoded to form the second part of the JSON Web Token.
-> Signature -> To create the signature we need to HMAC SHA256 algorithm
```text
HMACSHA256(
  base64UrlEncode(header) + "." +
  base64UrlEncode(payload),
  secret)
```
That example is HS256 (shared secret:
both sides know the same key).
GitHub Apps use RS256 instead:

  signature = RSA-sign(
    base64Url(header) + "." +
    base64Url(payload),
    PRIVATE key)

GitHub verifies with the app's PUBLIC
key. Why it matters: with HS256 GitHub
would need our secret too. With RS256
only we hold the private key; the public
key can verify but never sign.
The signature is used to verify the message wasn't changed along the way, and, in the case of tokens signed with a private key, it can also verify that the sender of the JWT is who it says it is.

### How does JWT work
In authentication, when the user successfully logs in using their credentials, a JSON Web Token will be returned. Since tokens are credentials, great care must be taken to prevent security issues. In general, you should not keep tokens longer than required.

You also should not store sensitive session data in browser storage due to lack of security.

Whenever the user wants to access a protected route or resource, the user agent should send the JWT, typically in the Authorization header using the Bearer schema. The content of the header should look like the following:

Authorization: Bearer <token>

This can be, in certain cases, a stateless authorization mechanism. The server's protected routes will check for a valid JWT in the Authorization header, and if it's present, the user will be allowed to access protected resources. If the JWT contains the necessary data, the need to query the database for certain operations may be reduced, though this may not always be the case.
If the token is sent in the Authorization header, Cross-Origin Resource Sharing (CORS) won't be an issue as it doesn't use cookies.

- What does the App JWT prove, and what does the installation token prove? Why two steps?
- Why is iat 60 s back? What breaks if your clock is 2 minutes fast?
- What's inside a JWT, and why isn't it secret?
- One concrete failure: what happens if a token leaks into a log line, and for how long can it be abused?
- Why not just: one long-lived token, skipping the JWT?
