package smsparser

import (
	"errors"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

const sampleTemplate = "You have received Tk {amount} from {sender}. TrxID {trxId}."
const sampleBody = "You have received Tk 1,050.50 from 01712345678. TrxID 9B7ACXYZ99."

func TestMatchRealisticCommaAmount(t *testing.T) {
	got, err := TestSample(sampleTemplate, sampleBody)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected a match")
	}
	if !got.Amount.Equal(decimal.RequireFromString("1050.50")) {
		t.Fatalf("Amount = %s, want 1050.50", got.Amount)
	}
	if got.Sender != "01712345678" {
		t.Fatalf("Sender = %q, want %q", got.Sender, "01712345678")
	}
	if got.TrxID != "9B7ACXYZ99" {
		t.Fatalf("TrxID = %q, want %q", got.TrxID, "9B7ACXYZ99")
	}
	if got.Balance != nil {
		t.Fatalf("Balance = %v, want nil", got.Balance)
	}
}

func TestOptionalBalanceOmitted(t *testing.T) {
	raw := "You have received Tk {amount} from {sender}. TrxID {trxId}. Remaining:{balance?}"
	body := "You have received Tk 250 from 01811122233. TrxID AA11BB22CC. Remaining:"
	got, err := TestSample(raw, body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected a match when optional balance is omitted")
	}
	if !got.Amount.Equal(decimal.RequireFromString("250")) {
		t.Fatalf("Amount = %s, want 250", got.Amount)
	}
	if got.TrxID != "AA11BB22CC" {
		t.Fatalf("TrxID = %q", got.TrxID)
	}
	if got.Balance != nil {
		t.Fatalf("Balance = %v, want nil", got.Balance)
	}
}

func TestOptionalBalancePresent(t *testing.T) {
	raw := "You have received Tk {amount} from {sender}. TrxID {trxId}. Remaining:{balance?}"
	body := "You have received Tk 250 from 01811122233. TrxID AA11BB22CC. Remaining:9,001.25"
	got, err := TestSample(raw, body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected a match when optional balance is present")
	}
	if got.Balance == nil {
		t.Fatal("Balance = nil, want parsed value")
	}
	if !got.Balance.Equal(decimal.RequireFromString("9001.25")) {
		t.Fatalf("Balance = %s, want 9001.25", got.Balance)
	}
}

func TestBengaliDigitAmount(t *testing.T) {
	got, err := TestSample("Got {amount} Taka. ID {trxId}", "Got ৫০০.৫ Taka. ID BB11CC22DD")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected a match for Bengali digit amount")
	}
	if !got.Amount.Equal(decimal.RequireFromString("500.5")) {
		t.Fatalf("Amount = %s, want 500.5", got.Amount)
	}
}

func TestCaseInsensitiveLiterals(t *testing.T) {
	raw := "Payment OF TK {amount} Received FROM {sender}. ID {trxId}"
	lowerBody := "payment of tk 99 received from 01555666777. id ab12cd34ef"
	got, err := TestSample(raw, lowerBody)
	if err != nil || got == nil {
		t.Fatalf("lowercased body should match: got=%v err=%v", got, err)
	}
	if !got.Amount.Equal(decimal.RequireFromString("99")) {
		t.Fatalf("Amount = %s, want 99", got.Amount)
	}
	mixedRaw := "you have received tk {amount} from {sender}. trxid {trxId}."
	upperBody := "YOU HAVE RECEIVED TK 75.00 FROM 01600011122. TRXID QQ77ZZ6611."
	got2, err := TestSample(mixedRaw, upperBody)
	if err != nil || got2 == nil {
		t.Fatalf("uppercased body should match lowercase template: got=%v err=%v", got2, err)
	}
}

func TestWhitespaceCollapseInBody(t *testing.T) {
	body := "You\n\thave   received\r\nTk    1,234.5\tfrom 01911223344.\nTrxID ZZ99XX88YY."
	got, err := TestSample(sampleTemplate, body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected match after whitespace collapse")
	}
	if !got.Amount.Equal(decimal.RequireFromString("1234.5")) {
		t.Fatalf("Amount = %s, want 1234.5", got.Amount)
	}
}

func TestCompileBuildsOrderedFieldsAndCaseInsensitivePrefix(t *testing.T) {
	raw := "{sender} sent {amount}. Code {trxId}. Left {balance?}"
	tpl, err := Compile(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []Field{FieldSender, FieldAmount, FieldTrxID, FieldBalance}
	if !reflect.DeepEqual(tpl.Fields, want) {
		t.Fatalf("Fields = %v, want %v", tpl.Fields, want)
	}
	if !strings.HasPrefix(tpl.Pattern.String(), "(?i)") {
		t.Fatalf("Pattern missing (?i) prefix: %q", tpl.Pattern.String())
	}
	if tpl.Raw != raw {
		t.Fatalf("Raw = %q, want original input", tpl.Raw)
	}
}

func TestCompileErrors(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want error
	}{
		{"empty template", "", ErrEmptyTemplate},
		{"whitespace only template", " \t\r\n  ", ErrEmptyTemplate},
		{"unknown field", "Money {foo} gone", ErrUnknownField},
		{"unknown optional field", "Money {amnt?} gone", ErrUnknownField},
		{"empty braces", "Money {} gone", ErrUnknownField},
		{"wrong case field", "{AMOUNT}", ErrUnknownField},
		{"adjacent placeholders", "{amount}{sender}", ErrAdjacentPlaceholders},
		{"adjacent placeholders inside text", "Tk {amount}{sender} end", ErrAdjacentPlaceholders},
		{"unclosed brace", "Tk {amount forever", ErrUnbalancedBraces},
		{"stray closing brace", "Tk amount} forever", ErrUnbalancedBraces},
		{"nested opening brace", "{{amount}}", ErrUnbalancedBraces},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			tpl, err := Compile(tc.raw)
			if tpl != nil {
				t.Fatalf("expected nil template, got %+v", tpl)
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want sentinel %v", err, tc.want)
			}
		})
	}
	_, err := Compile("Money {foo} gone")
	if err == nil || !strings.Contains(err.Error(), "foo") {
		t.Fatalf("unknown-field error should name the offending token, got %v", err)
	}
}

func TestLiteralMetaCharactersInjectionSafe(t *testing.T) {
	raw := `Alert (.*)+[ Tk {amount} code {trxId}`
	tpl, err := Compile(raw)
	if err != nil {
		t.Fatalf("metacharacter literal should compile: %v", err)
	}
	pattern := tpl.Pattern.String()
	if !strings.Contains(pattern, `\(\.\*\)\+\[`) {
		t.Fatalf("pattern does not quote meta characters: %q", pattern)
	}
	good := "Alert (.*)+[ Tk 55 code ABC123XYZ99"
	got, err := tpl.Match(good)
	if err != nil || got == nil {
		t.Fatalf("exact literal body should match: got=%v err=%v", got, err)
	}
	if got.TrxID != "ABC123XYZ99" {
		t.Fatalf("TrxID = %q", got.TrxID)
	}
	adversarial := []string{
		"Alert xxxxxxxxxxxxxxxxxx code ABC123XYZ99",
		"Alert .*[]()+ code ABC123XYZ99",
		"Alert (.*)+[ cod ABC123XYZ99",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	for _, b := range adversarial {
		got, err := tpl.Match(b)
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", b, err)
		}
		if got != nil {
			t.Fatalf("body %q must not match regex-injected pattern", b)
		}
	}
}

func TestNoMatchReturnsNilNil(t *testing.T) {
	cases := []string{
		"totally unrelated message",
		"You have received Tk",
		"You have received Tk abc from 12. TrxID X.",
		"",
	}
	for _, body := range cases {
		got, err := TestSample(sampleTemplate, body)
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", body, err)
		}
		if got != nil {
			t.Fatalf("body %q should not match, got %+v", body, got)
		}
	}
}

func TestRequiredCapturePresentButEmpty(t *testing.T) {
	re := regexp.MustCompile(`(?i)sum:(?P<amount>[0-9]*):ok`)
	tpl := &Template{Raw: "hand-built", Pattern: re, Fields: []Field{FieldAmount}}
	got, err := tpl.Match("sum::ok")
	if got != nil {
		t.Fatalf("expected nil fields on empty required capture, got %+v", got)
	}
	if err == nil {
		t.Fatal("expected error for present-but-empty required capture")
	}
}

func TestAmountParseFailureWrapped(t *testing.T) {
	re := regexp.MustCompile(`(?i)amt:(?P<amount>[a-z]+)`)
	tpl := &Template{Raw: "hand-built", Pattern: re, Fields: []Field{FieldAmount}}
	got, err := tpl.Match("amt:oops")
	if got != nil {
		t.Fatalf("expected nil fields on parse failure, got %+v", got)
	}
	if err == nil {
		t.Fatal("expected wrapped parse error")
	}
	if !strings.Contains(err.Error(), "oops") {
		t.Fatalf("error should include raw capture text, got %v", err)
	}
}

func TestReconstructedTemplateMatchesUsingOnlyStoredState(t *testing.T) {
	raw := "You have received Tk {amount} from {sender}. TrxID {trxId}. Remaining:{balance?}"
	compiled, err := Compile(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	rebuilt := &Template{
		Raw:     compiled.Raw,
		Pattern: compiled.Pattern,
		Fields:  compiled.Fields,
	}
	body := "you have received tk 2,500 from 01799988877. trxid HH55DD11WW. remaining:3,210"
	direct, errDirect := compiled.Match(body)
	viaRebuild, errRebuilt := rebuilt.Match(body)
	if errDirect != nil || errRebuilt != nil {
		t.Fatalf("unexpected errors: %v / %v", errDirect, errRebuilt)
	}
	if viaRebuild == nil {
		t.Fatal("rebuilt template failed to match")
	}
	if !reflect.DeepEqual(direct, viaRebuild) {
		t.Fatalf("reconstructed result %+v differs from direct %+v", viaRebuild, direct)
	}
	if !viaRebuild.Amount.Equal(decimal.RequireFromString("2500")) {
		t.Fatalf("Amount = %s", viaRebuild.Amount)
	}
	if viaRebuild.Balance == nil || !viaRebuild.Balance.Equal(decimal.RequireFromString("3210")) {
		t.Fatalf("Balance = %v", viaRebuild.Balance)
	}
}

func TestTestSampleConveniencePath(t *testing.T) {
	got, err := TestSample(sampleTemplate, sampleBody)
	if err != nil || got == nil {
		t.Fatalf("expected successful convenience match: got=%v err=%v", got, err)
	}
	nilGot, nilErr := TestSample(sampleTemplate, "nothing to see here")
	if nilGot != nil || nilErr != nil {
		t.Fatalf("expected (nil, nil), got (%v, %v)", nilGot, nilErr)
	}
	errTpl, errErr := TestSample("{nope}", "anything")
	if errTpl != nil {
		t.Fatalf("expected nil template on compile failure, got %+v", errTpl)
	}
	if !errors.Is(errErr, ErrUnknownField) {
		t.Fatalf("expected ErrUnknownField, got %v", errErr)
	}
}

func TestMatchNeverPanicsOnAdversarialInput(t *testing.T) {
	tpl, err := Compile("Tk {amount} from {sender} id {trxId} bal:{balance?}")
	if err != nil {
		t.Fatalf("unexpected compile error: %v", err)
	}
	nastyBodies := []string{
		"",
		" ",
		"{}",
		"{{}}",
		"{amount}",
		"}{",
		"\x00",
		"\xff",
		"\x00\x01\x02\x03",
		string([]byte{0xc0, 0xaf}),
		"\xf0\x28\xf0\x29",
		strings.Repeat("{", 10000),
		strings.Repeat("}", 10000),
		strings.Repeat("9", 100000),
		strings.Repeat("a", 100000),
		strings.Repeat("Tk 1,000.00 ", 10000),
		"\u09e6" + strings.Repeat("\u09ef", 5000),
		"Tk \u09e6\u09e7 from +880171234567890123456789 id AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA bal:",
	}
	for _, body := range nastyBodies {
		b := body
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic on body %q: %v", truncate(b), r)
				}
			}()
			if _, err := tpl.Match(b); err != nil && strings.Contains(err.Error(), "\x00") {
				t.Fatal("error text must not embed control bytes")
			}
		}()
	}
	nastyRaws := []string{
		"{",
		"}",
		"{\xff}",
		"{amount",
		strings.Repeat("{amount?", 50),
	}
	for _, raw := range nastyRaws {
		r := raw
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					t.Fatalf("panic compiling %q: %v", truncate(r), rec)
				}
			}()
			if _, err := TestSample(r, sampleBody); err == nil && r == "{" {
				t.Fatal("expected error for unclosed brace")
			}
		}()
	}
}

func truncate(s string) string {
	if len(s) > 32 {
		return s[:32]
	}
	return s
}

func TestCompileRegexValid(t *testing.T) {
	raw := `Received (?P<amount>[0-9,]+(?:\.[0-9]+)?) BDT from (?P<sender>\+?[0-9]+) ref=(?P<trxId>[A-Za-z0-9]+)(?: bal=(?P<balance>[0-9.,]+))?`
	tpl, err := CompileRegex(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := tpl.Match("received 1,250.75 bdt from 01712345678 REF=XY99ZZ8877 bal=4321")
	if err != nil || got == nil {
		t.Fatalf("match failed: got=%v err=%v", got, err)
	}
	if !got.Amount.Equal(decimal.RequireFromString("1250.75")) {
		t.Fatalf("Amount = %s", got.Amount)
	}
	if got.Balance == nil || !got.Balance.Equal(decimal.RequireFromString("4321")) {
		t.Fatalf("Balance = %v", got.Balance)
	}
}

func TestCompileRegexOptionalBalanceAbsent(t *testing.T) {
	raw := `CashOut ok (?P<amount>[0-9]+) tk agent-fee included id:(?P<trxId>[A-Za-z0-9]+)`
	tpl, err := CompileRegex(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := tpl.Match("cashout OK 900 TK agent-fee included id:QW11ER22TT")
	if err != nil || got == nil {
		t.Fatalf("match failed: got=%v err=%v", got, err)
	}
	if got.Balance != nil {
		t.Fatalf("Balance should be absent, got %v", got.Balance)
	}
}

func TestCompileRegexErrors(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want error
	}{
		{"unknown group", `Tk (?P<amount>[0-9]+) (?P<blob>x*) id (?P<trxId>\w+)`, ErrUnknownGroup},
		{"missing amount group", `id (?P<trxId>\w+) only`, ErrMissingRequiredGroup},
		{"missing trxId group", `amount (?P<amount>[0-9]+) only`, ErrMissingRequiredGroup},
		{"lookahead unsupported by re2", `(?P<amount>(?=.*x)[0-9]+) (?P<trxId>\w+)`, ErrInvalidRegex},
		{"plain invalid", `(?P<amount>[0-9) (?P<trxId>\w+)`, ErrInvalidRegex},
		{"empty", "   ", ErrEmptyTemplate},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			_, err := CompileRegex(tc.raw)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want sentinel %v", err, tc.want)
			}
		})
	}
}

func TestCompileTemplateRequiresAmountAndTrxID(t *testing.T) {
	if _, err := Compile("Got {amount} Taka"); !errors.Is(err, ErrMissingRequiredGroup) {
		t.Fatalf("expected ErrMissingRequiredGroup, got %v", err)
	}
	if _, err := Compile("ID {trxId} only"); !errors.Is(err, ErrMissingRequiredGroup) {
		t.Fatalf("expected ErrMissingRequiredGroup, got %v", err)
	}
	if _, err := Compile("Got {amount} from {sender}. ID {trxId}"); err != nil {
		t.Fatalf("valid template rejected: %v", err)
	}
}
