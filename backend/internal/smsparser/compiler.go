package smsparser

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/shopspring/decimal"
)

type Field string

const (
	FieldAmount  Field = "amount"
	FieldSender  Field = "sender"
	FieldTrxID   Field = "trxId"
	FieldBalance Field = "balance"
)

type Template struct {
	Raw     string
	Pattern *regexp.Regexp
	Fields  []Field
}

type Fields struct {
	Amount  decimal.Decimal
	Sender  string
	TrxID   string
	Balance *decimal.Decimal
}

var (
	ErrEmptyTemplate        = errors.New("smsparser: empty template")
	ErrUnknownField         = errors.New("smsparser: unknown field")
	ErrAdjacentPlaceholders = errors.New("smsparser: adjacent placeholders")
	ErrUnbalancedBraces     = errors.New("smsparser: unbalanced braces")
	ErrTemplateTooLong      = errors.New("smsparser: template too long")
	ErrInvalidRegex         = errors.New("smsparser: invalid regex")
	ErrUnknownGroup         = errors.New("smsparser: unknown capture group")
	ErrMissingRequiredGroup = errors.New("smsparser: missing required capture group")
)

const amountSubPattern = `(?:[0-9][0-9,]*(?:\.[0-9]+)?|[০-৯][০-৯]*(?:\.[০-৯]+)?)`

const maxTemplateLength = 1024

const bengaliDigitBase rune = 0x09E6
const bengaliDigitLast rune = 0x09EF

var subPatterns = map[Field]string{
	FieldAmount:  amountSubPattern,
	FieldBalance: amountSubPattern,
	FieldSender:  `\+?[0-9]{5,15}`,
	FieldTrxID:   `[A-Za-z0-9]{6,20}`,
}

type token struct {
	isPlaceholder bool
	literal       string
	field         Field
	pattern       string
}

func normalizeText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func Compile(raw string) (*Template, error) {
	normalized := normalizeText(raw)
	if normalized == "" {
		return nil, fmt.Errorf("%w: %q", ErrEmptyTemplate, raw)
	}
	if len(normalized) > maxTemplateLength {
		return nil, fmt.Errorf("%w: %d > %d bytes", ErrTemplateTooLong, len(normalized), maxTemplateLength)
	}
	tokens, err := tokenize(normalized)
	if err != nil {
		return nil, err
	}
	var sb strings.Builder
	sb.WriteString("(?i)")
	fields := make([]Field, 0, len(tokens))
	hasAmount, hasTrxID := false, false
	for _, tok := range tokens {
		if tok.isPlaceholder {
			switch tok.field {
			case FieldAmount:
				hasAmount = true
			case FieldTrxID:
				hasTrxID = true
			}
			fields = append(fields, tok.field)
			sb.WriteString(tok.pattern)
		} else {
			sb.WriteString(regexp.QuoteMeta(tok.literal))
		}
	}
	if !hasAmount || !hasTrxID {
		return nil, fmt.Errorf("%w: template requires both {amount} and {trxId} placeholders", ErrMissingRequiredGroup)
	}
	re, compileErr := regexp.Compile(sb.String())
	if compileErr != nil {
		return nil, fmt.Errorf("smsparser: compiled pattern invalid: %w", compileErr)
	}
	return &Template{Raw: raw, Pattern: re, Fields: fields}, nil
}

func tokenize(s string) ([]token, error) {
	tokens := make([]token, 0, 8)
	var lit strings.Builder
	flushLiteral := func() {
		if lit.Len() > 0 {
			tokens = append(tokens, token{literal: lit.String()})
			lit.Reset()
		}
	}
	for i := 0; i < len(s); {
		switch s[i] {
		case '{':
			end := strings.IndexByte(s[i+1:], '}')
			if end < 0 {
				return nil, fmt.Errorf("%w: unclosed '{' at offset %d", ErrUnbalancedBraces, i)
			}
			name := s[i+1 : i+1+end]
			if strings.IndexByte(name, '{') >= 0 {
				return nil, fmt.Errorf("%w: unclosed '{' at offset %d", ErrUnbalancedBraces, i)
			}
			flushLiteral()
			optional := strings.HasSuffix(name, "?")
			base := name
			if optional {
				base = name[:len(name)-1]
			}
			field := Field(base)
			sub, known := subPatterns[field]
			if !known {
				return nil, fmt.Errorf("%w: %q", ErrUnknownField, name)
			}
			if len(tokens) > 0 && tokens[len(tokens)-1].isPlaceholder {
				return nil, fmt.Errorf("%w: {%s} directly follows {%s}", ErrAdjacentPlaceholders, base, tokens[len(tokens)-1].field)
			}
			named := "(?P<" + string(field) + ">" + sub + ")"
			pat := named
			if optional {
				pat = "(?:" + named + ")?"
			}
			tokens = append(tokens, token{isPlaceholder: true, field: field, pattern: pat})
			i += end + 2
		case '}':
			return nil, fmt.Errorf("%w: unexpected '}' at offset %d", ErrUnbalancedBraces, i)
		default:
			lit.WriteByte(s[i])
			i++
		}
	}
	flushLiteral()
	return tokens, nil
}

func (t *Template) Match(body string) (*Fields, error) {
	if t == nil || t.Pattern == nil {
		return nil, errors.New("smsparser: template has no compiled pattern")
	}
	normalized := normalizeText(body)
	locs := t.Pattern.FindStringSubmatchIndex(normalized)
	if locs == nil {
		return nil, nil
	}
	indexByName := make(map[string]int, len(locs)/2)
	for idx, name := range t.Pattern.SubexpNames() {
		if name != "" {
			indexByName[name] = idx
		}
	}
	out := &Fields{}
	captured := make(map[Field]bool, len(t.Fields))
	for _, f := range t.Fields {
		idx, ok := indexByName[string(f)]
		if !ok {
			return nil, fmt.Errorf("smsparser: pattern has no capture group for field %q", f)
		}
		lo, hi := locs[idx*2], locs[idx*2+1]
		if lo < 0 {
			continue
		}
		value := normalized[lo:hi]
		if value == "" {
			return nil, fmt.Errorf("smsparser: required field %q captured empty value", f)
		}
		captured[f] = true
		switch f {
		case FieldAmount:
			d, parseErr := parseAmount(value)
			if parseErr != nil {
				return nil, parseErr
			}
			out.Amount = d
		case FieldBalance:
			d, parseErr := parseAmount(value)
			if parseErr != nil {
				return nil, parseErr
			}
			out.Balance = &d
		case FieldSender:
			out.Sender = value
		case FieldTrxID:
			out.TrxID = value
		default:
			return nil, fmt.Errorf("smsparser: unsupported field %q", f)
		}
	}
	if !captured[FieldAmount] || !captured[FieldTrxID] {
		return nil, fmt.Errorf("smsparser: required fields amount and trxId must both be captured")
	}
	return out, nil
}

func parseAmount(raw string) (decimal.Decimal, error) {
	cleaned := strings.ReplaceAll(raw, ",", "")
	var b strings.Builder
	b.Grow(len(cleaned))
	for _, r := range cleaned {
		if r >= bengaliDigitBase && r <= bengaliDigitLast {
			b.WriteRune('0' + r - bengaliDigitBase)
		} else {
			b.WriteRune(r)
		}
	}
	d, err := decimal.NewFromString(b.String())
	if err != nil {
		return decimal.Decimal{}, fmt.Errorf("smsparser: invalid amount %q: %w", raw, err)
	}
	return d, nil
}

func TestSample(raw, sample string) (*Fields, error) {
	tpl, err := Compile(raw)
	if err != nil {
		return nil, err
	}
	return tpl.Match(sample)
}

func CompileRegex(raw string) (*Template, error) {
	normalized := normalizeText(raw)
	if normalized == "" {
		return nil, fmt.Errorf("%w: %q", ErrEmptyTemplate, raw)
	}
	if len(normalized) > maxTemplateLength {
		return nil, fmt.Errorf("%w: %d > %d bytes", ErrTemplateTooLong, len(normalized), maxTemplateLength)
	}
	re, compileErr := regexp.Compile("(?i)" + normalized)
	if compileErr != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidRegex, compileErr)
	}

	fields := make([]Field, 0, 4)
	hasAmount, hasTrxID := false, false
	for _, name := range re.SubexpNames()[1:] {
		if name == "" {
			continue
		}
		f := Field(name)
		if _, known := subPatterns[f]; !known {
			return nil, fmt.Errorf("%w: %q (allowed: amount, sender, trxId, balance)", ErrUnknownGroup, name)
		}
		switch f {
		case FieldAmount:
			hasAmount = true
		case FieldTrxID:
			hasTrxID = true
		}
		fields = append(fields, f)
	}
	if !hasAmount || !hasTrxID {
		return nil, fmt.Errorf("%w: regex mode requires named groups for both amount and trxId", ErrMissingRequiredGroup)
	}

	return &Template{Raw: raw, Pattern: re, Fields: fields}, nil
}

func TestSampleRegex(raw, sample string) (*Fields, error) {
	tpl, err := CompileRegex(raw)
	if err != nil {
		return nil, err
	}
	return tpl.Match(sample)
}
