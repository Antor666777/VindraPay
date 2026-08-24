package scripting

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func testInput() Input {
	amount := 100.0
	balance := 4300.0
	return Input{
		Amount:       &amount,
		Sender:       "+8801712345678",
		TrxID:        "8N7A6B5C4D",
		Balance:      &balance,
		Body:         "You have received Tk 100",
		Direction:    "credit",
		ProviderName: "bKash Personal",
	}
}

func TestRun(t *testing.T) {
	tests := []struct {
		name        string
		script      string
		in          Input
		timeout     time.Duration
		allowUnsafe bool
		check       func(t *testing.T, out *Output, err error)
	}{
		{
			name:   "empty script is a no-op",
			script: "",
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.EffectiveAmount != nil || out.Sender != nil || out.TrxIDOverride != nil ||
					out.BalanceAfterOverride != nil || out.Meta != nil || out.Rejected ||
					out.RejectReason != "" || len(out.IgnoredUnsafe) != 0 {
					t.Fatalf("expected empty output, got %+v", out)
				}
			},
		},
		{
			name:   "whitespace script is a no-op",
			script: "  \n\t ",
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.EffectiveAmount != nil || out.Rejected {
					t.Fatalf("expected empty output, got %+v", out)
				}
			},
		},
		{
			name:   "fee subtraction rounds to two decimals",
			script: `const fee = 2.5; return { amount: round(input.amount - fee, 2) };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				want := decimal.RequireFromString("97.50")
				if out.EffectiveAmount == nil || !out.EffectiveAmount.Equal(want) {
					t.Fatalf("expected effective amount %s, got %v", want, out.EffectiveAmount)
				}
			},
		},
		{
			name:   "percent expression uses raw amount",
			script: `return { amount: input.amount * 0.98 };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				want := decimal.RequireFromString("98.00")
				if out.EffectiveAmount == nil || !out.EffectiveAmount.Equal(want) {
					t.Fatalf("expected effective amount %s, got %v", want, out.EffectiveAmount)
				}
			},
		},
		{
			name:   "sender normalisation via replace and lower",
			script: `return { sender: lower(input.sender.replace("+88", "")) };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.Sender == nil || *out.Sender != "01712345678" {
					t.Fatalf("expected sender 01712345678, got %v", out.Sender)
				}
			},
		},
		{
			name:   "meta passthrough keeps primitive types",
			script: `return { meta: { channel: "bkash", fee: 2.5, instant: true } };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.Meta == nil {
					t.Fatal("expected meta")
				}
				if out.Meta["channel"] != "bkash" {
					t.Fatalf("meta.channel = %#v", out.Meta["channel"])
				}
				if fee, ok := out.Meta["fee"].(float64); !ok || fee != 2.5 {
					t.Fatalf("meta.fee = %#v", out.Meta["fee"])
				}
				if instant, ok := out.Meta["instant"].(bool); !ok || !instant {
					t.Fatalf("meta.instant = %#v", out.Meta["instant"])
				}
			},
		},
		{
			name:   "reject fires above threshold",
			script: `if (input.amount > 100) { reject("over_limit"); } return { amount: input.amount };`,
			in: func() Input {
				in := testInput()
				a := 150.0
				in.Amount = &a
				return in
			}(),
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if !out.Rejected {
					t.Fatal("expected rejection")
				}
				if out.RejectReason != "over_limit" {
					t.Fatalf("reason = %q", out.RejectReason)
				}
			},
		},
		{
			name:   "below threshold is not rejected",
			script: `if (input.amount > 100) { reject("over_limit"); } return { amount: input.amount };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.Rejected {
					t.Fatalf("unexpected rejection: %q", out.RejectReason)
				}
				if out.EffectiveAmount == nil {
					t.Fatal("expected effective amount")
				}
			},
		},
		{
			name:   "unsafe keys dropped and reported when gated",
			script: `return { trxId: "NEWTRXID123", balance: 5000 };`,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.TrxIDOverride != nil || out.BalanceAfterOverride != nil {
					t.Fatalf("unsafe overrides should be dropped, got %+v", out)
				}
				if len(out.IgnoredUnsafe) != 2 {
					t.Fatalf("expected two ignored keys, got %v", out.IgnoredUnsafe)
				}
				has := map[string]bool{}
				for _, k := range out.IgnoredUnsafe {
					has[k] = true
				}
				if !has["trxId"] || !has["balance"] {
					t.Fatalf("ignored keys = %v", out.IgnoredUnsafe)
				}
			},
		},
		{
			name:        "unsafe keys applied when allowed",
			script:      `return { trxId: "NEWTRXID123", balance: 5000 };`,
			allowUnsafe: true,
			check: func(t *testing.T, out *Output, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if out.TrxIDOverride == nil || *out.TrxIDOverride != "NEWTRXID123" {
					t.Fatalf("trx override = %v", out.TrxIDOverride)
				}
				if out.BalanceAfterOverride == nil ||
					!out.BalanceAfterOverride.Equal(decimal.RequireFromString("5000.00")) {
					t.Fatalf("balance override = %v", out.BalanceAfterOverride)
				}
				if len(out.IgnoredUnsafe) != 0 {
					t.Fatalf("unexpected ignored keys: %v", out.IgnoredUnsafe)
				}
			},
		},
		{
			name:   "NaN amount is an error",
			script: `return { amount: NaN };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil {
					t.Fatal("expected error")
				}
				if !strings.Contains(err.Error(), "non-finite number for amount") {
					t.Fatalf("error = %v", err)
				}
			},
		},
		{
			name:   "infinite amount is an error",
			script: `return { amount: Infinity };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil {
					t.Fatal("expected error")
				}
				if !strings.Contains(err.Error(), "non-finite number for amount") {
					t.Fatalf("error = %v", err)
				}
			},
		},
		{
			name:   "zero amount is an error",
			script: `return { amount: 0 };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "greater than 0") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "negative amount is an error",
			script: `return { amount: -50 };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "greater than 0") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "oversized sender is rejected",
			script: `return { sender: "x".repeat(300) };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "sender exceeds") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "oversized meta is rejected",
			script: `return { meta: { blob: "x".repeat(5000) } };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "meta exceeds") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "nested meta object is rejected",
			script: `return { meta: { deep: { x: 1 } } };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "meta.deep") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "array meta is rejected",
			script: `return { meta: ["a"] };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "meta must be an object") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:        "short trx id is an error when unsafe allowed",
			script:      `return { trxId: "ab" };`,
			allowUnsafe: true,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "trxId length") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:        "trx id with whitespace is an error when unsafe allowed",
			script:      `return { trxId: "ABCD 1234" };`,
			allowUnsafe: true,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "whitespace") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "primitive return is an error",
			script: `return 42;`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "must return an object") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "null return is an error",
			script: `return null;`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || !strings.Contains(err.Error(), "must return") {
					t.Fatalf("err = %v", err)
				}
			},
		},
		{
			name:   "runtime error surfaces as execution error",
			script: `return { amount: input.missing.deep };`,
			check: func(t *testing.T, out *Output, err error) {
				if err == nil || errors.Is(err, ErrTimeout) {
					t.Fatalf("err = %v", err)
				}
			},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			in := tt.in
			if in.Amount == nil {
				in = testInput()
			}
			timeout := tt.timeout
			if timeout == 0 {
				timeout = 100 * time.Millisecond
			}
			out, err := Run(tt.script, in, timeout, tt.allowUnsafe)
			tt.check(t, out, err)
		})
	}
}

func TestRunTimeout(t *testing.T) {
	start := time.Now()
	out, err := Run(`while(true){}`, testInput(), 50*time.Millisecond, false)
	elapsed := time.Since(start)
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("want ErrTimeout, got %v", err)
	}
	if out != nil {
		t.Fatalf("want nil output, got %+v", out)
	}
	if elapsed >= time.Second {
		t.Fatalf("timeout took too long: %v", elapsed)
	}
}

func TestFunctionConstructorBlocked(t *testing.T) {
	out, err := Run(`return { amount: Function("return input.amount")() };`, testInput(), 100*time.Millisecond, false)
	if err == nil {
		t.Fatal("expected error when Function constructor is used")
	}
	if errors.Is(err, ErrTimeout) {
		t.Fatalf("unexpected timeout: %v", err)
	}
	if out != nil {
		t.Fatalf("want nil output, got %+v", out)
	}
}

func TestEscapeSurfacesRemoved(t *testing.T) {
	out, err := Run(
		`return { meta: { fn: typeof Function, date: typeof Date, rand: typeof Math.random, ev: typeof eval, reg: typeof RegExp, bi: typeof BigInt, u8: typeof Uint8Array } };`,
		testInput(), 100*time.Millisecond, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, k := range []string{"fn", "date", "rand", "ev", "reg", "bi", "u8"} {
		if out.Meta[k] != "undefined" {
			t.Fatalf("meta.%s = %#v, want undefined", k, out.Meta[k])
		}
	}
}

func TestFunctionConstructorResurrectionBlocked(t *testing.T) {
	scripts := []string{
		`return { amount: (function(){}).constructor("return input.amount")() };`,
		`return { amount: (function*(){}).constructor("return input.amount")().amount };`,
		`return { amount: (async function(){}).constructor("return 1")().amount };`,
	}
	for _, s := range scripts {
		out, err := Run(s, testInput(), 100*time.Millisecond, false)
		if err == nil || errors.Is(err, ErrTimeout) {
			t.Fatalf("script %q: want error, got err=%v out=%+v", s, err, out)
		}
		if out != nil {
			t.Fatalf("script %q: want nil output", s)
		}
	}
}

func TestRegexExecutionDisabled(t *testing.T) {
	scripts := []string{
		`return { m: /a/.test("abc") };`,
		`return { m: /a/.exec("abc") !== null };`,
		`return { m: "abc".replace(/b/g, "x") };`,
		`return { m: "abc".match(/b/) !== null };`,
		`return { m: "abc".split(/b/).length };`,
		`var re = /(a+)+$/g; re.lastIndex = 1; return { m: re.exec("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab") === null };`,
		`return { m: new RegExp("(a+)+$").test("aaaa") };`,
	}
	for _, s := range scripts {
		done := make(chan struct{})
		var err error
		go func(script string) {
			defer close(done)
			_, err = Run(script, testInput(), 100*time.Millisecond, false)
		}(s)
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatalf("script %q did not terminate within 5s", s)
		}
		if err == nil || errors.Is(err, ErrTimeout) {
			t.Fatalf("script %q: want error, got err=%v", s, err)
		}
	}
}

func TestStringMethodsStillWorkWithoutRegex(t *testing.T) {
	out, err := Run(
		`return { meta: { r: "a-b-c".replace("-", "+"), p: "abcde".slice(1, 3), i: "abc".indexOf("c"), j: ["x", "y"].join("-"), s: "abc".split("b").join(",") } };`,
		testInput(), 100*time.Millisecond, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Meta["r"] != "a+b-c" || out.Meta["p"] != "bc" || out.Meta["i"] != float64(2) ||
		out.Meta["j"] != "x-y" || out.Meta["s"] != "a,c" {
		t.Fatalf("meta = %#v", out.Meta)
	}
}

func TestStringAmplificationCapped(t *testing.T) {
	scripts := []string{
		`return { meta: { b: "x".repeat(2000000) } };`,
		`return { meta: { b: "y".padStart(2000000, "z") } };`,
		`return { meta: { b: "y".padEnd(2000000, "z") } };`,
		`return { meta: { b: Array(2000000).fill("q").join("") } };`,
	}
	for _, s := range scripts {
		out, err := Run(s, testInput(), 100*time.Millisecond, false)
		if err == nil || !strings.Contains(err.Error(), "sandbox limit") {
			t.Fatalf("script %q: want sandbox limit error, got err=%v out=%+v", s, err, out)
		}
	}
	out, err := Run(`return { meta: { a: "ab".repeat(3), b: "5".padStart(3, "0") } };`, testInput(), 100*time.Millisecond, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Meta["a"] != "ababab" || out.Meta["b"] != "005" {
		t.Fatalf("meta = %#v", out.Meta)
	}
}

func TestMathHelpersAvailable(t *testing.T) {
	out, err := Run(
		`return { meta: {
			r: round(2.567, 2),
			a: abs(-7),
			mn: min(3, 1, 2),
			mx: max(3, 1, 2),
			fl: floor(1.9),
			ce: ceil(1.1),
			fx: fixed(2),
			lo: lower("AB"),
			up: upper("ab"),
			tr: trim("  x  ")
		} };`,
		testInput(), 100*time.Millisecond, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expect := map[string]any{
		"r":  2.57,
		"a":  float64(7),
		"mn": float64(1),
		"mx": float64(3),
		"fl": float64(1),
		"ce": float64(2),
		"fx": "2.00",
		"lo": "ab",
		"up": "AB",
		"tr": "x",
	}
	for k, v := range expect {
		got := out.Meta[k]
		switch v.(type) {
		case string:
			if got != v {
				t.Fatalf("meta.%s = %#v, want %#v", k, got, v)
			}
		default:
			f, ok := got.(float64)
			if !ok || f != v {
				t.Fatalf("meta.%s = %#v, want %#v", k, got, v)
			}
		}
	}
}

func TestPrototypePollutionNotPersisted(t *testing.T) {
	_, err := Run(`({}).__proto__.polluted = 1; return { amount: input.amount };`, testInput(), 100*time.Millisecond, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out, err := Run(`return { meta: { polluted: ({}).polluted !== undefined } };`, testInput(), 100*time.Millisecond, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Meta["polluted"] != false {
		t.Fatalf("prototype pollution leaked across runs: %#v", out.Meta["polluted"])
	}
}

func TestMetaDangerousKeysRejected(t *testing.T) {
	scripts := []string{
		`return { meta: JSON.parse('{"__proto__":"x"}') };`,
		`var m = {}; Object.defineProperty(m, "__proto__", { value: "x", enumerable: true }); return { meta: m };`,
		`return { meta: JSON.parse('{"constructor":1}') };`,
	}
	for _, s := range scripts {
		out, err := Run(s, testInput(), 100*time.Millisecond, false)
		if err == nil || !strings.Contains(err.Error(), "not allowed") {
			t.Fatalf("script %q: want not allowed error, got err=%v out=%+v", s, err, out)
		}
	}
}

func TestAmountAndBalanceUpperBounds(t *testing.T) {
	out, err := Run(`return { amount: 9999999999.99 };`, testInput(), 100*time.Millisecond, false)
	if err != nil || out.EffectiveAmount == nil || !out.EffectiveAmount.Equal(decimal.RequireFromString("9999999999.99")) {
		t.Fatalf("boundary amount rejected: err=%v out=%+v", err, out)
	}
	_, err = Run(`return { amount: 10000000000 };`, testInput(), 100*time.Millisecond, false)
	if err == nil || !strings.Contains(err.Error(), "amount exceeds") {
		t.Fatalf("err = %v", err)
	}
	_, err = Run(`return { trxId: "ABC123XYZ", balance: 20000000000 };`, testInput(), 100*time.Millisecond, true)
	if err == nil || !strings.Contains(err.Error(), "balance exceeds") {
		t.Fatalf("err = %v", err)
	}
}

func TestRejectReasonTruncated(t *testing.T) {
	out, err := Run(`reject("r".repeat(5000)); return {};`, testInput(), 100*time.Millisecond, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len([]rune(out.RejectReason)) != maxRejectReasonLength {
		t.Fatalf("reject reason length = %d, want %d", len([]rune(out.RejectReason)), maxRejectReasonLength)
	}
}

func TestErrorMessageClamped(t *testing.T) {
	_, err := Run(`throw "E".repeat(4000);`, testInput(), 100*time.Millisecond, false)
	if err == nil {
		t.Fatal("expected error")
	}
	if len(err.Error()) > 1024 {
		t.Fatalf("error message too long: %d bytes", len(err.Error()))
	}
	if strings.Contains(err.Error(), strings.Repeat("E", 600)) {
		t.Fatal("error message was not truncated")
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		script  string
		wantErr string
	}{
		{name: "empty ok", script: ""},
		{name: "whitespace ok", script: " \n\t"},
		{name: "valid ok", script: `return { amount: input.amount * 2 };`},
		{name: "too long", script: strings.Repeat("x", 4097), wantErr: "exceeds 4096 bytes"},
		{
			name:    "syntax error reports line",
			script:  "\nreturn { amount: ;",
			wantErr: "line 3",
		},
		{
			name:    "unbalanced braces",
			script:  "return { amount: input.amount;",
			wantErr: "compile error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.script)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("err = %v, want it to contain %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidateAcceptsEverythingRunCompiles(t *testing.T) {
	scripts := []string{
		`const x = 1; while (false) {} return { meta: { x: x } };`,
		`try { reject("nope") } catch (e) {} return {};`,
	}
	for _, s := range scripts {
		if err := Validate(s); err != nil {
			t.Fatalf("Validate(%q) = %v", s, err)
		}
		if _, err := Run(s, testInput(), 100*time.Millisecond, false); err != nil {
			t.Fatalf("Run(%q) = %v", s, err)
		}
	}
}
