<script lang="ts">
</script>

<div class="page-head">
  <div>
    <h1>Guide</h1>
    <p class="sub">How templates and regex mode read your bank SMS — explained step by step</p>
  </div>
</div>

<div class="guide">

<div class="panel">
  <div class="panel__head"><span class="panel__title">1 · What is a "provider"?</span></div>
  <div class="panel__body">
    <p>
      A <strong>provider</strong> teaches Vindra how to read ONE kind of bank SMS.
      Your Android phone forwards every SMS it receives; Vindra tries each active provider's
      pattern against it. The first one that matches turns the message into a verified
      transaction record (amount, sender, TrxID, balance).
    </p>
    <p>
      You need one provider per SMS <em>format</em> — for example "bKash received" and
      "Nagad received" are two providers. If your account also sends cash-out confirmations,
      add those as separate providers too (see <strong>Direction</strong> below).
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">2 · Template mode (recommended)</span></div>
  <div class="panel__body">
    <p>
      A template is the bank SMS with the changing parts replaced by placeholders.
      Everything else must appear exactly as written (capitalisation and extra spaces don't matter).
    </p>

    <h3>The four placeholders</h3>
    <table class="guide-table">
      <thead><tr><th>Placeholder</th><th>Matches</th><th>Example capture</th></tr></thead>
      <tbody>
        <tr><td class="mono">{'{amount}'}</td><td>Money value, commas allowed</td><td class="mono">1,050.50</td></tr>
        <tr><td class="mono">{'{sender}'}</td><td>Phone number of the payer</td><td class="mono">01712345678</td></tr>
        <tr><td class="mono">{'{trxId}'}</td><td>Transaction ID (letters/digits, 6–20 chars)</td><td class="mono">9B7ACXYZ99</td></tr>
        <tr><td class="mono">{'{balance}'}</td><td>Account balance after payment</td><td class="mono">5,000</td></tr>
        <tr><td class="mono">{'{balance?}'}</td><td>Same, but <strong>optional</strong> — missing is fine</td><td class="mono">(nothing)</td></tr>
      </tbody>
    </table>
    <p class="note">
      Any field may get the <span class="mono">?</span> suffix to mark it optional.
      Only <span class="mono">{'{amount}'}</span> and <span class="mono">{'{trxId}'}</span> are mandatory
      in every template — a payment without them cannot be verified.
    </p>

    <h3>Worked example</h3>
    <p>Your customer's SMS looks like this:</p>
    <pre class="codeblock">You have received Tk 1,050.50 from 01712345678. Balance: Tk 5,000.00. TrxID 9B7ACXYZ99.</pre>
    <p>Write the template by keeping the fixed words and replacing the rest:</p>
    <pre class="codeblock">You have received Tk {'{amount}'} from {'{sender}'}. Balance: Tk {'{balance}'}. TrxID {'{trxId}'}.</pre>
    <p>Vindra extracts:</p>
    <ul>
      <li>amount = <span class="mono">1050.50</span></li>
      <li>sender = <span class="mono">01712345678</span></li>
      <li>balance = <span class="mono">5000.00</span></li>
      <li>trxId = <span class="mono">9B7ACXYZ99</span></li>
    </ul>

    <h3>Rules applied automatically (you don't need to worry)</h3>
    <ul>
      <li><strong>Case doesn't matter:</strong> "YOU HAVE RECEIVED…" matches "you have received…"</li>
      <li><strong>Spacing doesn't matter:</strong> new lines and double spaces behave like one space</li>
      <li><strong>Literals are safe:</strong> brackets, dots or symbols in your fixed text are never treated as regex code</li>
    </ul>

    <h3>Mistakes the editor will reject (with reasons)</h3>
    <table class="guide-table">
      <thead><tr><th>You wrote</th><th>Why it's rejected</th></tr></thead>
      <tbody>
        <tr><td class="mono">Got {'{ammount}'}</td><td>Unknown name — spelling must be exactly amount/sender/trxId/balance</td></tr>
        <tr><td class="mono">Tk {'{amount}{sender}'}</td><td>Two placeholders touching — Vindra couldn't tell where one ends</td></tr>
        <tr><td class="mono">Tk {'{amount'}</td><td>Closing brace missing</td></tr>
        <tr><td class="mono">Received from someone</td><td>No {'{amount}'} / {'{trxId}'} at all</td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">3 · Regex mode (advanced)</span></div>
  <div class="panel__body">
    <p>
      Some banks insert unpredictable junk — promo lines, fees that come and go, dates in odd formats.
      Template mode requires exact fixed text; when that's impossible, switch
      <strong>match mode</strong> to <span class="mono">regex</span> and write a regular expression
      using named groups instead.
    </p>

    <pre class="codeblock">You have received Tk (?P&lt;amount&gt;[0-9,.]+) from (?P&lt;sender&gt;\+?[0-9]+)\..*?Balance: Tk (?P&lt;balance&gt;[0-9,.]+)\. TrxID (?P&lt;trxId&gt;[A-Za-z0-9]&#123;6,20&#125;)</pre>

    <p>
      The magic part is <span class="mono">.*?</span> between the amount and the balance — it means
      "whatever text appears here is fine". That single template now matches messages
      <em>with</em> a Fee line, <em>without</em> one, or with any promo junk in between.
    </p>

    <h3>Rules in regex mode</h3>
    <ul>
      <li>Name your groups exactly <span class="mono">amount</span>, <span class="mono">sender</span>, <span class="mono">trxId</span>, <span class="mono">balance</span>. Anything else is rejected.</li>
      <li><span class="mono">(?P&lt;amount&gt;…)</span> and <span class="mono">(?P&lt;trxId&gt;…)</span> must exist — they're what verification needs.</li>
      <li>Max length 1024 characters. Matching is always case-insensitive.</li>
      <li>Bodies are whitespace-collapsed before matching, so don't rely on exact spacing.</li>
      <li>Captured amounts go through the same cleanup as templates (commas and Bangla digits ০-৯ are handled).</li>
      <li>Vindra uses Go's RE2 engine: linear-time, so a bad pattern can never hang the server — but exotic syntax like lookaheads <span class="mono">(?=…)</span> is not available and will be rejected with the parser's error.</li>
    </ul>

    <div class="callout callout--warn">
      Regex mode is powerful but easy to get wrong. Always try the template first,
      and always press <strong>Test</strong> against a real sample SMS before saving.
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">4 · Custom logic (JavaScript)</span></div>
  <div class="panel__body">
    <p>
      A provider can carry an optional JavaScript snippet that runs <strong>after</strong> a successful
      template or regex match, once per message, inside a locked-down sandbox with a 100ms budget —
      no network, no files, no dates, no randomness. Use it to adjust amounts, normalise senders,
      attach extra data, or reject messages that pattern matching alone can't judge.
    </p>

    <h3>What your script receives</h3>
    <table class="guide-table">
      <thead><tr><th>Field</th><th>Type</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td class="mono">amount</td><td class="mono">number | null</td><td>Amount extracted from the SMS (null when absent)</td></tr>
        <tr><td class="mono">sender</td><td class="mono">string</td><td>Payer's phone number as captured</td></tr>
        <tr><td class="mono">trxId</td><td class="mono">string</td><td>Transaction ID as captured</td></tr>
        <tr><td class="mono">balance</td><td class="mono">number | null</td><td>Stated balance after the payment (null when absent)</td></tr>
        <tr><td class="mono">body</td><td class="mono">string</td><td>The full raw SMS text</td></tr>
        <tr><td class="mono">direction</td><td class="mono">string</td><td><span class="mono">credit</span> or <span class="mono">debit</span> from the provider config</td></tr>
        <tr><td class="mono">providerName</td><td class="mono">string</td><td>Name of the provider whose rule matched</td></tr>
      </tbody>
    </table>

    <h3>Return shape</h3>
    <pre class="codeblock">{'if (amount < 10) reject("dust transaction");\n\nreturn {\n  amount: amount - 15,\n  sender: sender.replace("+88", "0"),\n  meta: { tier: amount >= 500 ? "gold" : "basic" }\n};'}</pre>

    <ul>
      <li>A returned <span class="mono">amount</span> becomes the <strong>effective amount</strong> used for order matching, while the raw bank amount still feeds balance-chain verification.</li>
      <li><span class="mono">meta</span> is free-form extras stored with the transaction — strings, numbers or booleans.</li>
      <li><span class="mono">reject(reason)</span> skips the message entirely; it shows in the Inbox as <span class="mono">skipped</span> with your reason.</li>
      <li>Returning <span class="mono">{'{}'}</span> keeps every field exactly as extracted.</li>
      <li><strong>Caps:</strong> 100ms execution budget by default, at most 4096 characters of script, and results are validated before anything is stored.</li>
    </ul>

    <h3>Built-in helpers</h3>
    <p>
      <span class="mono">round(x, dp)</span> · <span class="mono">abs</span> · <span class="mono">min</span> ·
      <span class="mono">max</span> · <span class="mono">floor</span> · <span class="mono">ceil</span> ·
      <span class="mono">lower</span> · <span class="mono">upper</span> · <span class="mono">trim</span> ·
      <span class="mono">fixed(x)</span> · <span class="mono">reject(reason)</span>
    </p>

    <div class="callout callout--warn">
      Scripts run inside a strict sandbox: 100ms execution budget, no network, files, dates or random,
      and <strong>regular expressions are not available inside scripts</strong> (a deliberate anti-ReDoS
      measure — all matching happens via your template/regex pattern above).
    </div>

    <div class="callout callout--warn">
      Two locks keep the evidence trustworthy: scripts cannot rewrite <span class="mono">trxId</span> or
      stated <span class="mono">balance</span> — those stay bank-authoritative so a forged SMS can't redefine
      its own proof, and returned overrides for them are ignored. An instance may lift this lock by starting
      VindraPay with <span class="mono">ALLOW_UNSAFE_SCRIPTS=true</span>; only then do returned
      trxId/balance overrides apply.
    </div>

    <p class="note">
      Draft safely: the editor's <strong>Insert example</strong> menu ships ready-made snippets, and
      <strong>Test</strong> runs your script against a sample body showing Extracted → Transformed side by side.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">5 · Direction: credit vs debit</span></div>
  <div class="panel__body">
    <p>
      Every provider declares which way the money moves:
    </p>
    <ul>
      <li><strong>credit</strong> — money arrives (customer payments). <em>Only credit transactions can be used to pay orders.</em></li>
      <li><strong>debit</strong> — money leaves (cash-out, send-money). Recording these keeps your balance trail complete; submitting a debit TrxID at checkout is rejected with <span class="mono">wrong_direction</span>.</li>
    </ul>
    <p>
      Why bother recording debits? Because balance verification chains consecutive messages:
      after each SMS we expect the stated balance to equal the previous balance ± the amount.
      An unrecorded cash-out between two deposits would look like a broken chain and falsely
      reject honest payments. With debit templates active, every hop adds up perfectly.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">6 · Recommended workflow</span></div>
  <div class="panel__body">
    <ol class="steps">
      <li><strong>Collect a real sample SMS</strong> for the format you want to support.</li>
      <li><strong>Draft</strong> on the Providers page: replace the changing parts with placeholders.</li>
      <li><strong>Press Test</strong> and paste the sample body — you should see all four fields extracted correctly. Fix any red error text.</li>
      <li><strong>Save.</strong> The template goes live immediately for new incoming SMS.</li>
      <li><strong>Watch the Inbox</strong> for a day: anything landing as <span class="mono">unmatched</span> is a format your templates missed.</li>
      <li><strong>Edit or deactivate</strong> old templates once replaced — if two active patterns could match the same SMS, the older one silently wins.</li>
      <li>If balances drift (missed SMS while offline), open the device's balance view and <strong>calibrate</strong> to the true account balance.</li>
    </ol>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">7 · Verification results cheat-sheet</span></div>
  <div class="panel__body">
    <table class="guide-table">
      <thead><tr><th>Result shown on Attempts</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td class="mono">success</td><td>TrxID found, amount matched, balance consistent — order paid</td></tr>
        <tr><td class="mono">not_found</td><td>No such order, or no SMS with that TrxID ever arrived</td></tr>
        <tr><td class="mono">already_used</td><td>This deposit was already spent on another order</td></tr>
        <tr><td class="mono">amount_mismatch</td><td>SMS amount differs from the order total</td></tr>
        <tr><td class="mono">balance_mismatch</td><td>Stated balance contradicts the device's ledger — likely forged, or you drifted (calibrate!)</td></tr>
        <tr><td class="mono">wrong_direction</td><td>That TrxID is a cash-out/send, not a received payment</td></tr>
        <tr><td class="mono">order_expired / order_not_pending</td><td>Order closed already — nothing was charged</td></tr>
      </tbody>
    </table>
  </div>
</div>

</div>

<style>
  .guide p { margin: 8px 0; line-height: 1.55; font-size: 13px; }
  .guide ul, .guide ol { margin: 8px 0; padding-left: 20px; line-height: 1.55; font-size: 13px; }
  .guide li { margin: 4px 0; }
  .guide h3 { margin: 18px 0 8px; font-size: 13px; letter-spacing: 0.02em; color: var(--text); }
  .guide .note { color: var(--text-muted); font-size: 12.5px; }
  .guide-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
  .guide-table th { text-align: left; padding: 7px 10px; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 600; }
  .guide-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .codeblock {
    background: #0a0d13;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 12.5px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 10px 0;
    color: #cde3da;
  }
  .callout { border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-size: 12.5px; line-height: 1.5; }
  .callout--warn { background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.35); color: #fbd38d; }
  .steps li { margin: 8px 0; }
</style>
