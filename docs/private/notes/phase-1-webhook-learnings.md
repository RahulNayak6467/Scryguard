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
A plain hash is very prectible for example using a simple SHA256(message) can be easily be decoded also HMAC has a inner and outer hash to avoid hash-length extension attacks

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
