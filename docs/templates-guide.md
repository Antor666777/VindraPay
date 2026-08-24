# VindraPay Template & Regex Guide

How providers turn raw bank SMS into verified payments. The same content is available
in-app under **Studio → Guide**.

---

## 1. What is a "provider"?

A **provider** teaches Vindra how to read ONE kind of bank SMS. Your Android phone forwards
every SMS it receives; Vindra tries each active provider's pattern against it. The first one
that matches turns the message into a transaction record (amount, sender, TrxID, balance).

You need one provider per SMS *format*: "bKash received" and "Nagad received" are two
providers. Cash-out confirmations get their own providers too (see [Direction](#4-direction-credit-vs-debit)).

## 2. Template mode (recommended)

A template is the bank SMS with the changing parts replaced by placeholders.
Everything else must appear as written — capitalisation and extra spaces don't matter.

### The four placeholders

| Placeholder | Matches | Example capture |
| ----------- | ------- | --------------- |
| `{amount}`  | Money value, commas allowed | `1,050.50` |
| `{sender}`  | Payer's phone number | `01712345678` |
| `{trxId}`   | Transaction ID (6–20 letters/digits) | `9B7ACXYZ99` |
| `{balance}` | Account balance after payment | `5,000` |
| `{balance?}` | Same, but **optional** | *(nothing)* |

Any field can take the `?` suffix. Only `{amount}` and `{trxId}` are mandatory in every
template — a payment without them cannot be verified.

### Worked example

Customer's SMS:

```
You have received Tk 1,050.50 from 01712345678. Balance: Tk 5,000.00. TrxID 9B7ACXYZ99.
```

Template (fixed words kept, changing parts replaced):

```
You have received Tk {amount} from {sender}. Balance: Tk {balance}. TrxID {trxId}.
```

Extracted: `amount=1050.50`, `sender=01712345678`, `balance=5000.00`, `trxId=9B7ACXYZ99`.

### Automatic behaviour

- **Case-insensitive** — `YOU HAVE RECEIVED` matches `you have received`
- **Whitespace-insensitive** — newlines/double spaces behave like one space
- **Literals are safe** — symbols in fixed text are never treated as regex code

### Rejection reasons

| You wrote | Why rejected |
| --------- | ------------ |
| `Got {ammount}` | Unknown name — must be exactly amount/sender/trxId/balance |
| `Tk {amount}{sender}` | Adjacent placeholders — boundary is ambiguous |
| `Tk {amount` | Unbalanced braces |
| `Received from someone` | Missing `{amount}` / `{trxId}` |

## 3. Regex mode (advanced)

When banks insert unpredictable junk (fee lines that come and go, promo text), switch the
provider's **match mode** to `regex` and write an RE2 regular expression with named groups:

```
You have received Tk (?P<amount>[0-9,.]+) from (?P<sender>\+?[0-9]+)\..*?Balance: Tk (?P<balance>[0-9,.]+)\. TrxID (?P<trxId>[A-Za-z0-9]{6,20})
```

The lazy `.*?` between amount and balance means *"any text may appear here"*, so this single
pattern covers messages with or without fee lines.

Rules:

- Named groups limited to `amount`, `sender`, `trxId`, `balance`; **`amount` + `trxId` required**
- Must compile under Go's RE2 engine (no lookaheads/backreferences; rejected with parser error)
- Max 1024 chars; case-insensitive (`(?i)` auto-prepended)
- Bodies are whitespace-collapsed before matching
- Captured amounts pass comma/Bangla-digit normalisation identical to template mode
- Scripts run in a locked-down sandbox: 100ms execution budget, no network/files/dates/random, and **regular expressions are not available inside scripts** (a deliberate anti-ReDoS measure — do all matching via the template/regex pattern above)

RE2 guarantees linear-time matching — a bad pattern can never hang the server.

## 4. Direction: credit vs debit

Every provider declares which way money moves:

- **credit** — money arrives (customer payments). *Only credit transactions pay orders.*
- **debit** — money leaves (cash-out, send-money). Recorded to keep the balance trail
  complete; submitting a debit TrxID at checkout fails with `wrong_direction`.

Balance verification chains consecutive messages per device+provider: each stated balance
must equal the previous balance ± the transaction amount. Unrecorded cash-outs would look
like broken chains — debit templates keep every hop adding up.

## 5. Recommended workflow

1. Collect a real sample SMS
2. Draft on the Providers page (placeholders replace changing parts)
3. Press **Test** against the sample until all fields extract correctly
4. Save — live immediately for new incoming SMS
5. Watch the **Inbox**: `unmatched` messages are formats you still miss
6. Edit/deactivate superseded templates (oldest active match wins silently)
7. If balances drift after missed SMS, **calibrate** the device balance

## 6. Verification results cheat-sheet

| Result | Meaning |
| ------ | ------- |
| `success` | TrxID found, exact amount matched, balance consistent — order paid |
| `not_found` | Unknown order, or no SMS with that TrxID ever arrived |
| `already_used` | Deposit already consumed by another order |
| `amount_mismatch` | SMS amount differs from order total |
| `balance_mismatch` | Stated balance contradicts device ledger — forged, or drift (calibrate) |
| `wrong_direction` | That TrxID is a cash-out/send, not a received payment |
| `order_expired` / `order_not_pending` | Order already closed |

## 7. Custom logic (JavaScript)

A provider can carry an optional **JavaScript script** that runs *after* a successful template
or regex match, once per message, inside a locked-down sandbox with a **100ms budget** — no
network, no files, no dates, no randomness. Use it to adjust amounts, normalise senders,
attach extras, or reject messages that pattern matching alone can't judge.

### Input fields

| Field         | Type            | Meaning                                        |
| ------------- | --------------- | ---------------------------------------------- |
| `amount`      | `number \| null` | Amount extracted from the SMS (null if absent) |
| `sender`      | `string`        | Payer's phone number as captured               |
| `trxId`       | `string`        | Transaction ID as captured                     |
| `balance`     | `number \| null` | Stated balance after payment (null if absent)  |
| `body`        | `string`        | The full raw SMS text                          |
| `direction`   | `string`        | `credit` or `debit` from the provider config   |
| `providerName`| `string`        | Name of the provider whose rule matched        |

### Return shape

```js
if (amount < 10) reject("dust transaction");

return {
  amount: amount - 15,
  sender: sender.replace("+88", "0"),
  meta: { tier: amount >= 500 ? "gold" : "basic" }
};
```

- A returned `amount` becomes the **effective amount** used for order matching, while the raw
  bank amount still feeds balance-chain verification.
- `meta` is free-form extras stored with the transaction (strings, numbers, booleans).
- `reject(reason)` skips the message entirely — it shows in the Inbox as `skipped` with your reason.
- Returning `{}` keeps every field exactly as extracted.

Built-in helpers: `round(x, dp)`, `abs`, `min`, `max`, `floor`, `ceil`, `lower`, `upper`,
`trim`, `fixed(x)`, `reject(reason)`.

**The two locks:** scripts cannot rewrite `trxId` or stated `balance` — those stay
bank-authoritative so a forged SMS can't redefine its own proof; returned overrides for them
are ignored. An instance may lift this lock by setting `ALLOW_UNSAFE_SCRIPTS=true`, after which
returned trxId/balance overrides apply.

Caps: 100ms execution budget by default, at most 4096 characters of script, and returned
results are validated before anything is stored.

## 8. Balance calibration

If the phone misses SMS while offline, the recorded trail drifts and honest payments start
failing `balance_mismatch`. Recovery:

1. `GET /api/v1/devices/:device_id/balance?provider_id=…` — see what Vindra currently believes
2. Check the real balance in your MFS app
3. `POST /api/v1/devices/:device_id/calibrate-balance` with `{"balance": "4300", "note": "…"}`

Future payments chain from the calibration anchor, and a stuck payment (rejected by drift,
nothing newer recorded) succeeds on retry when its stated balance equals the calibration.
