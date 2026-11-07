# Validating webhook deliveries
This section discusses about why we need to validate the webhooks sent by github to our server endpoint and how can we make sure that the webhook is not tampered
Once our server is confugured to recevie the webhooks it listens for any delivery that is sent to the configured server endpoint

Steps to validate
1> Create a secret token for webhook
2> Store it securely in the server
3> Validate it with the incoming webhook payloads against the token to verify that they are coming from github and were not tampered

### Choosing a secret token
-> While creating a secret token we need to choose random string with high entropy
-> We can call the REST API provided by Github to create the secret token

### Securely Storing it in the server


### Validating webhook deliveries
-> Github will use our secret token to create a hash signature which is sent on every payload with the valye as X-Hub-Signature-256
-> In our server we will caculate the hash value using our secret token and ensure that it matches with the value github sent

1> Github uses HMAC hex digest to compute the hash
2> The hash signature always starts with sha256
3> The hash signauture is created using our secreter token and the payload contents
4> Never use a plain == operator instead use some method like secure_compare or crypto.timingSafeEqual which performs a constant time string comparison to mitigate some attacks against regular equality operators


#### Defination of HMAC
-> HMAC(Hash-based Message Authentication Code) is used to verify whether the message is send from someone who knows the correct secret token and also if it is not modifed
H -> hash function such as SHA-256 that produces a fixed length hash
K -> secrety key known to both sender and receiver
B -> Hash function block size (64 bytes for SHA-256)
L -> Hash output length (32 bytes for SHA-256)
ipad -> 0x36 repeated B times
opad -> 0x5C repeated B times

##### How HMAC is calculated
```text
Secret key = "mysecret"
Message    = "Hello"
Hash       = SHA-256
```
Steps:
1> SHA-256 operatoes on 64bytes our key is 8 bytes long so append 56 zeros to make it 64 bytes
2> Take the modifed secret_key and XOR every byte with 0 X 36 (ipad)
inner_key = padded_key XOR ipad
3> Take the inner key with the message and hash them
inner_hash = SHA256(inner_key + hash)
4> Calculate the outer_key
outer_key = padded_key XOR opad
5> Calculate HMAC by combining the outer_key with inner_hash and hash again
HMAC = SHA256(outer_key + inner_hash)

The output is a 32 byte long authentication code
The inner and outer hash is done to protect against hash-length extension attacks

- why GitHub uses HMAC and not a plain hash
A plain hash does not use the secret for computing the hash
SHA256(body) -> The attacker changes the body hashes the body themselves and sends the new hash and it matches
SHA256(secret + body) -> there is a secret but the length extension attacks can lead the attacker to find a valid hash without knowing the secret
HMAC fixes both

- why you check the raw bytes and not the parsed JSON
Because HMAC verifies the exact raw bytes of the message and not the JSON parsed object
```JSON
// JSON object sent by Github
{"action":"opened","number":42}
//  Github calculates HMAC(secret, original_raw_bytes)
// Our server parses the JSON to
// {"action": "opened", "number": 42} -> Notice the extraspace these would result in a different hash value because there raw bytes are different
```
- why the comparison must take the same time whatever the input
Since the hashes are long bytes of data it would take time to verify them on the basis of characters match, an attacker can use that timing information to guess the correct HMAC signautre, this is called timing attack

```text
Attacker's guess	Matching prefix	Comparison time (illustrative)
x12345	0 characters	1 ns
a12345	1 character	2 ns
a7xxxx	2 characters	3 ns
a7fxxx	3 characters	4 ns
a7f9b2	6 characters	7 ns
```
An attacker could potentially discover the signature one character at a time by measuring response times repeatedly
So instead of stopping at the first mismatch it processes the entire signature
In Node JS we use timingSafeEqual function to compare

- what the sha256= prefix is.
It is used for our server to know which hashing algorithm is used

### createHmac()
Creates a message authentication code using a secret key and the hash algorithm
```Typescript
import { createHmac } from "node:crypto";

const signature = createHmac("sha256", "my-secret")
  .update("Hello World")
  .digest("hex");
```
createHmac("sha256", "my-secret") -> Creates HMAC instance using the SHA256 algorithm and secret_token
.update(data) -> suplies the data to authenticate
.digest("hex") -> returns the hexadecimal representation of HMAC
.digest() -> returns a  Buffer containing HMAX raw bytes

### timingSafeEqual()
```Typescript
import { timingSafeEqual } from "node:crypto";

const a = Buffer.from("abc");
const b = Buffer.from("abd");

const match = timingSafeEqual(a, b);

console.log(match); // false
```
-> Accepts two buffers or other byte oriented inputs
-> returns true if the bytes match
-> requires the inputs to have same byte length otherwise throws error
-> uses constant time comparison with respect to byte values, reducing time-attack risks

### crypto.CreatePrivateKey()
```Typescript
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

const pem = readFileSync("./github-app.pem");

const privateKey = createPrivateKey(pem);
```
-> It parses the PEM contents
-> Validates its structure
-> Converts it into a key object that can be used for signing

### Express.json()
Express.json() -> middleware used to parse the JSON request bodies and which can be used via req.body
| Option | Default | Purpose |
|---|---|---|
| `limit` | `"100kb"` | Maximum allowed request body size |
| `strict` | `true` | Accept only JSON objects and arrays at the top level |
| `type` | `"application/json"` | Specifies which Content-Type headers should be parsed |
| `inflate` | `true` | Allows compressed request bodies |
| `reviver` | `null` | Transforms values while parsing JSON |
| `verify` | `undefined` | Inspects raw request bytes before JSON parsing |

#### Verify
-> This attribute lets us validate the raw bytes before the parsing of the req body is done
| Parameter | Meaning |
|---|---|
| `req` | Incoming HTTP request |
| `res` | HTTP response |
| `buf` | Raw request body as a Buffer |
| `encoding` | Character encoding |

```Typescript
app.use(express.json({
  verify: (req, res, buf) => {
    verifyGitHubSignature(req, buf);
  }
}));
````

-> Express receives the raw request
-> Calls verify function with raw bytes
-> Passes that to our validation logic
-> If the signature is wrong, verify throws;
   the error goes to the error middleware
   and the body is never parsed


### Express.raw()
| Option | Default | Purpose |
|---|---|---|
| `type` | `"application/octet-stream"` | Content types to parse |
| `limit` | `"100kb"` | Maximum request body size |
| `inflate` | `true` | Allows compressed request bodies |
| `verify` | `undefined` | Inspects or validates raw bytes before storing them |

Unlike Express.json(), Express.raw() does not parse the object rather it stores them as raw bytes
For webhooks and binary data it is better to use Express.raw() as the validation is done on the basis for raw bytes instead of parsing them to Javascript Object

Default type is application/octet-stream.
GitHub sends application/json, so we must
pass type: 'application/json' or the
parser skips the request.

Size limits: express default 100kb,
our global limit 1 MB, GitHub can send
up to 25 MB.


### Best Practices for github webhooks
1> Subscribing to minimum number of required events
2> Validating the webhook delivery in the server side without leaking sensitive information in the payload URL
3> Using a randome high entropy string for webhook secret
4> Using HTTPS and SSL verification
5> Github expects the server to responds the webhook response via the server within 10 seconds with a 2xx code, if time exceeds 10s
then github consider it as a failed delivery, we can use asynchronous queues for handling many webhook delivery asynchronously
7> Check the action and event type in the webhook before processing the payload
action -> action attribute
event type -> X-Github-Event
8> Once the server goes down midway you should redeliver missed webhooks once the server is up
9> Use X-Github-Delivery to avoid replay attacks
### Note
If we request for redelivery then we will receive ehte same X-GitHub-Delivery so not all redeliveries are related to replay attack

### Handling failed webhook deliveries
Different Failures
-> Webhooks did not get delivered -> Use redeliver API -> Recovery for 3days
-> Server crash -> return 5xx and github does not redeliver the failed webhooks so our server needs to request for a redelivery
-> Failure by worker -> retry with exponential backoff
-> Same request coming twice -> Deduplicate with delivery ID


### Verifying the webhooks manually
1> Extract the signature from X-Hub-Signature-256
2> Remove sha256= prefix
3> use the createHMAC function to create the HMAC secret and timingSafeEqual function to compare the HMAC signature with the signature shared by github

### Handling failed deliveries
1> Store the X-GitHub-Delivery ID in postgres
   using the unique constraint
2> We can then use these ids for handling
   failed deliveries and duplicate deliveries
3> Redelivery vs replay: no need to tell
   them apart. Both carry an ID we already
   handled, so we skip it. What matters is
   WHEN we record the ID as handled: record
   it before the work succeeds and a failed
   delivery can never be retried.

Return 2xx response within 10s
Phase 1:
Raw body → Extract signature → HMAC →
Constant-time compare → Event filter →
Return 2xx → Work in the same process

Later: + Deduplicate (phase 2),
        + Enqueue (phase 3)


### Stripe vs GitHub

1> What is signed
Stripe: HMAC over timestamp.body
GitHub: HMAC over the body only

2> Replay
Stripe: reject if timestamp is older than
  5 min (tolerance 0 = check turned off)
GitHub: no signed timestamp, so a copied
  request stays valid forever
  → we dedupe by X-GitHub-Delivery (phase 2)

3> Fast 2xx
Both: reply 2xx first, then do the work
GitHub: 10 s limit

4> Async handling
Both: hand the work to a queue
  (phase 1: same process; phase 3: SQS)

5> Duplicates
Stripe: same event can arrive twice;
  store handled event IDs
GitHub: same idea with X-GitHub-Delivery

1. You check the signature against JSON.stringify(req.body) instead of the raw bytes. A real GitHub delivery arrives. What happens, and why?
raw bytes are more accurate for checking the signautres because there can be small formatting, spacing issues whehn converting them using JSON.stringify(req.body)

2. An attacker sends X-Hub-Signature-256: sha256=abc, much shorter than a real signature. Your code calls timingSafeEqual on it directly. What happens, and what status does the attacker see?
Since there is difference in length the function timingSafeEqual throws an error so we wont process the content of the webhook  and we should send a 401 status
bad/missing signature → 401
body too big          → 413
signed, bad shape     → 400
ignored event         → 204
PR we review          → 202
our code crashed      → 500

3. "Doesn't that early exit leak timing?"
No. A real signature's length is public: it's always sha256= plus 64 hex characters. An attacker learns nothing new from it. The constant-time compare protects the content, not the length.

4. Someone pushes to main, and GitHub sends a push event to your PR endpoint. What do you reply, and why does that choice matter?
we wont process that webhook since we only subscribed for the pull request event so we dont process that webhook we can find it from the required attributes present in the data from the webhook about the event type
We will return 204(No content) status code for those events which we are not subscribed to
We will return 202(Accepted) for pull request

5. Your handler takes 12 seconds before replying. What does GitHub do, and what does it not do?
Github considers the delivery as a failed delivery and it does not redeliver the webhook
