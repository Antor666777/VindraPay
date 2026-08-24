package scripting

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
	"github.com/shopspring/decimal"
)

const (
	maxScriptLength       = 4096
	maxSenderLength       = 256
	trxIDMinLength        = 6
	trxIDMaxLength        = 64
	maxMetaBytes          = 4096
	maxMoneyAmount        = 9999999999.99
	maxRejectReasonLength = 256
	maxErrorMessageBytes  = 512
	maxSandboxChars       = 1 << 20
)

var maxMoneyDecimal = decimal.NewFromFloat(maxMoneyAmount)

type Input struct {
	Amount       *float64
	Sender       string
	TrxID        string
	Balance      *float64
	Body         string
	Direction    string
	ProviderName string
}

type Output struct {
	EffectiveAmount      *decimal.Decimal
	Sender               *string
	TrxIDOverride        *string
	BalanceAfterOverride *decimal.Decimal
	Meta                 map[string]any
	Rejected             bool
	RejectReason         string
	IgnoredUnsafe        []string
}

var ErrTimeout = errors.New("scripting: execution timed out")

type rejectSignal struct{}

func (rejectSignal) Error() string { return "scripting: rejected" }

var errRejected rejectSignal

const inputPrelude = "var amount=input.amount, sender=input.sender, trxId=input.trxId, balance=input.balance, body=input.body, direction=input.direction, providerName=input.providerName;"

const sandboxSetupJS = `(function(){var FP=Function.prototype;FP.constructor=undefined;Object.getPrototypeOf(function*(){}).constructor=undefined;Object.getPrototypeOf(async function(){}).constructor=undefined})();(function(){var sp=String.prototype,rp=sp.repeat,ps=sp.padStart,pe=sp.padEnd,jn=Array.prototype.join,fl=Array.prototype.fill;function lim(n){n=Number(n);if(n!==n){return}if(!isFinite(n)||n>1048576){throw new RangeError("size exceeds sandbox limit")}}sp.repeat=function(n){lim(n);return rp.call(String(this),n)};sp.padStart=function(n){lim(n);return ps.apply(this,arguments)};sp.padEnd=function(n){lim(n);return pe.apply(this,arguments)};Array.prototype.join=function(){if(this.length>1048576){throw new RangeError("array exceeds sandbox limit")}return jn.apply(this,arguments)};Array.prototype.fill=function(){if(this.length>1048576){throw new RangeError("array exceeds sandbox limit")}return fl.apply(this,arguments)}})();(function(){var RXP=RegExp.prototype;["exec","test","compile",Symbol.match,Symbol.replace,Symbol.search,Symbol.split,Symbol.matchAll].forEach(function(k){try{delete RXP[k]}catch(e){RXP[k]=undefined}});["match","matchAll","search","split","replace","replaceAll"].forEach(function(m){var o=String.prototype[m];String.prototype[m]=function(s){if(s&&typeof s==="object"&&Object.getPrototypeOf(s)===RXP){throw new TypeError("regexp support is disabled")}return o.apply(this,arguments)}});RegExp=undefined})()`

func wrapSource(script string) string {
	return "(function(){ " + inputPrelude + "\n" + script + "\n})()"
}

func Validate(script string) error {
	if strings.TrimSpace(script) == "" {
		return nil
	}
	if len(script) > maxScriptLength {
		return fmt.Errorf("scripting: script exceeds %d bytes", maxScriptLength)
	}
	_, err := goja.Compile("custom_logic", wrapSource(script), false)
	if err != nil {
		return wrapCompileError(err)
	}
	return nil
}

func clampMessage(msg string) string {
	if len(msg) <= maxErrorMessageBytes {
		return msg
	}
	runes := []rune(msg)
	if len(runes) <= maxErrorMessageBytes {
		return string(runes)
	}
	return string(runes[:maxErrorMessageBytes])
}

func wrapCompileError(err error) error {
	var perr *parser.Error
	if errors.As(err, &perr) {
		return fmt.Errorf("scripting: compile error at line %d column %d: %s", perr.Position.Line, perr.Position.Column, clampMessage(perr.Message))
	}
	var plist parser.ErrorList
	if errors.As(err, &plist) && len(plist) > 0 {
		first := plist[0]
		return fmt.Errorf("scripting: compile error at line %d column %d: %s", first.Position.Line, first.Position.Column, clampMessage(first.Message))
	}
	var cse *goja.CompilerSyntaxError
	if errors.As(err, &cse) {
		if cse.File != nil {
			pos := cse.File.Position(cse.Offset)
			return fmt.Errorf("scripting: compile error at line %d column %d: %s", pos.Line, pos.Column, clampMessage(cse.Message))
		}
		if l, col, ok := embeddedPosition(cse.Message); ok {
			return fmt.Errorf("scripting: compile error at line %d column %d: %s", l, col, clampMessage(stripEmbeddedPosition(cse.Message)))
		}
		return fmt.Errorf("scripting: compile error: %s", clampMessage(cse.Message))
	}
	return fmt.Errorf("scripting: invalid script: %s", clampMessage(err.Error()))
}

var embeddedPosRe = regexp.MustCompile(`Line (\d+):(\d+)`)

func embeddedPosition(msg string) (int, int, bool) {
	m := embeddedPosRe.FindStringSubmatch(msg)
	if m == nil {
		return 0, 0, false
	}
	l, lerr := strconv.Atoi(m[1])
	c, cerr := strconv.Atoi(m[2])
	if lerr != nil || cerr != nil {
		return 0, 0, false
	}
	return l, c, true
}

func stripEmbeddedPosition(msg string) string {
	idx := strings.Index(msg, ": Line ")
	if idx < 0 {
		return msg
	}
	rest := msg[idx:]
	m := embeddedPosRe.FindStringSubmatchIndex(rest)
	if m == nil {
		return msg
	}
	return strings.TrimSpace(strings.ReplaceAll(rest[:m[0]]+" "+rest[m[1]:], "  ", " "))
}

func Run(script string, in Input, timeout time.Duration, allowUnsafe bool) (*Output, error) {
	out := &Output{}
	if strings.TrimSpace(script) == "" {
		return out, nil
	}
	prog, err := goja.Compile("custom_logic", wrapSource(script), false)
	if err != nil {
		return nil, wrapCompileError(err)
	}

	vm := goja.New()
	if _, serr := vm.RunString(sandboxSetupJS); serr != nil {
		return nil, fmt.Errorf("scripting: sandbox setup failed: %v", serr)
	}
	for _, name := range []string{
		"Function", "Date", "eval",
		"ArrayBuffer", "SharedArrayBuffer", "DataView", "BigInt",
		"Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
		"Int32Array", "Uint32Array", "Float32Array", "Float64Array",
		"BigInt64Array", "BigUint64Array",
	} {
		vm.Set(name, goja.Undefined())
	}
	if m, ok := vm.Get("Math").(*goja.Object); ok {
		m.Set("random", goja.Undefined())
	}

	setHelpers(vm, out)
	setInput(vm, in)

	timer := time.AfterFunc(timeout, func() { vm.Interrupt("timeout") })
	defer timer.Stop()

	val, rerr := runProgram(vm, prog)
	if rerr != nil {
		var iv *goja.InterruptedError
		if errors.As(rerr, &iv) {
			return nil, ErrTimeout
		}
		if !out.Rejected {
			return nil, fmt.Errorf("scripting: %s", clampMessage(rerr.Error()))
		}
	}
	if out.Rejected {
		return out, nil
	}
	if val == nil || goja.IsUndefined(val) {
		return out, nil
	}
	if goja.IsNull(val) {
		return nil, fmt.Errorf("scripting: script must return an object or nothing, got null")
	}
	obj, ok := val.(*goja.Object)
	if !ok {
		return nil, fmt.Errorf("scripting: script must return an object or nothing, got %T", val)
	}
	if _, callable := goja.AssertFunction(val); callable {
		return nil, fmt.Errorf("scripting: script must return an object or nothing, got function")
	}
	switch obj.ExportType().Kind() {
	case reflect.Slice:
		return nil, fmt.Errorf("scripting: script must return an object, got array")
	case reflect.Map:
	default:
		return nil, fmt.Errorf("scripting: script must return an object or nothing")
	}

	for _, key := range obj.Keys() {
		v := obj.Get(key)
		switch key {
		case "amount":
			f, ferr := fieldNumber(key, v)
			if ferr != nil {
				return nil, ferr
			}
			if f <= 0 {
				return nil, fmt.Errorf("scripting: amount must be greater than 0")
			}
			d := decimal.NewFromFloat(f).Round(2)
			if d.GreaterThan(maxMoneyDecimal) {
				return nil, fmt.Errorf("scripting: amount exceeds %s", maxMoneyDecimal.String())
			}
			out.EffectiveAmount = &d
		case "sender":
			s := v.String()
			if utf8.RuneCountInString(s) > maxSenderLength {
				return nil, fmt.Errorf("scripting: sender exceeds %d characters", maxSenderLength)
			}
			out.Sender = &s
		case "trxId":
			if !allowUnsafe {
				out.IgnoredUnsafe = append(out.IgnoredUnsafe, key)
				continue
			}
			s := v.String()
			l := utf8.RuneCountInString(s)
			if l < trxIDMinLength || l > trxIDMaxLength {
				return nil, fmt.Errorf("scripting: trxId length must be between %d and %d", trxIDMinLength, trxIDMaxLength)
			}
			if strings.IndexFunc(s, unicode.IsSpace) >= 0 {
				return nil, fmt.Errorf("scripting: trxId must not contain whitespace")
			}
			out.TrxIDOverride = &s
		case "balance":
			if !allowUnsafe {
				out.IgnoredUnsafe = append(out.IgnoredUnsafe, key)
				continue
			}
			f, ferr := fieldNumber(key, v)
			if ferr != nil {
				return nil, ferr
			}
			if f <= 0 {
				return nil, fmt.Errorf("scripting: balance must be greater than 0")
			}
			d := decimal.NewFromFloat(f).Round(2)
			if d.GreaterThan(maxMoneyDecimal) {
				return nil, fmt.Errorf("scripting: balance exceeds %s", maxMoneyDecimal.String())
			}
			out.BalanceAfterOverride = &d
		case "meta":
			merr := applyMeta(out, v)
			if merr != nil {
				return nil, merr
			}
		}
	}
	return out, nil
}

func runProgram(vm *goja.Runtime, prog *goja.Program) (v goja.Value, err error) {
	defer func() {
		if r := recover(); r != nil {
			if _, ok := r.(rejectSignal); ok {
				return
			}
			err = fmt.Errorf("scripting: internal failure: %s", clampMessage(fmt.Sprint(r)))
		}
	}()
	return vm.RunProgram(prog)
}

func fieldNumber(key string, v goja.Value) (float64, error) {
	f := v.ToFloat()
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, fmt.Errorf("scripting: returned non-finite number for %s", key)
	}
	return f, nil
}

func applyMeta(out *Output, v goja.Value) error {
	raw, ok := v.Export().(map[string]interface{})
	if !ok {
		return fmt.Errorf("scripting: meta must be an object")
	}
	mm := make(map[string]any, len(raw))
	for mk, mv := range raw {
		if mk == "__proto__" || mk == "constructor" {
			return fmt.Errorf("scripting: meta.%s is not allowed", mk)
		}
		switch t := mv.(type) {
		case string:
			mm[mk] = t
		case bool:
			mm[mk] = t
		case int64:
			mm[mk] = float64(t)
		case float64:
			if math.IsNaN(t) || math.IsInf(t, 0) {
				return fmt.Errorf("scripting: meta.%s is not a finite number", mk)
			}
			if t == 0 && math.Signbit(t) {
				t = 0
			}
			mm[mk] = t
		default:
			return fmt.Errorf("scripting: meta.%s must be a string, number or bool", mk)
		}
	}
	b, jerr := json.Marshal(mm)
	if jerr != nil {
		return fmt.Errorf("scripting: meta is not serialisable")
	}
	if len(b) > maxMetaBytes {
		return fmt.Errorf("scripting: meta exceeds %d bytes", maxMetaBytes)
	}
	out.Meta = mm
	return nil
}

func setInput(vm *goja.Runtime, in Input) {
	obj := vm.NewObject()
	if in.Amount != nil {
		obj.Set("amount", *in.Amount)
	} else {
		obj.Set("amount", goja.Null())
	}
	if in.Balance != nil {
		obj.Set("balance", *in.Balance)
	} else {
		obj.Set("balance", goja.Null())
	}
	obj.Set("sender", in.Sender)
	obj.Set("trxId", in.TrxID)
	obj.Set("body", in.Body)
	obj.Set("direction", in.Direction)
	obj.Set("providerName", in.ProviderName)
	vm.Set("input", obj)
}

func setHelpers(vm *goja.Runtime, out *Output) {
	vm.Set("round", func(call goja.FunctionCall) goja.Value {
		x := numArg(call, 0)
		dp := intArg(call, 1)
		if dp < 0 {
			dp = 0
		}
		if dp > 8 {
			dp = 8
		}
		p := math.Pow10(dp)
		return vm.ToValue(math.Round(x*p) / p)
	})
	vm.Set("abs", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(math.Abs(numArg(call, 0)))
	})
	vm.Set("min", func(call goja.FunctionCall) goja.Value {
		args := call.Arguments
		if len(args) == 0 {
			return vm.ToValue(math.NaN())
		}
		m := args[0].ToFloat()
		for _, a := range args[1:] {
			if f := a.ToFloat(); f < m {
				m = f
			}
		}
		return vm.ToValue(m)
	})
	vm.Set("max", func(call goja.FunctionCall) goja.Value {
		args := call.Arguments
		if len(args) == 0 {
			return vm.ToValue(math.NaN())
		}
		m := args[0].ToFloat()
		for _, a := range args[1:] {
			if f := a.ToFloat(); f > m {
				m = f
			}
		}
		return vm.ToValue(m)
	})
	vm.Set("floor", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(math.Floor(numArg(call, 0)))
	})
	vm.Set("ceil", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(math.Ceil(numArg(call, 0)))
	})
	vm.Set("lower", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(strings.ToLower(strArg(call, 0)))
	})
	vm.Set("upper", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(strings.ToUpper(strArg(call, 0)))
	})
	vm.Set("trim", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(strings.TrimSpace(strArg(call, 0)))
	})
	vm.Set("fixed", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(fmt.Sprintf("%.2f", numArg(call, 0)))
	})
	vm.Set("reject", func(call goja.FunctionCall) goja.Value {
		reason := ""
		if len(call.Arguments) > 0 && !goja.IsUndefined(call.Arguments[0]) && !goja.IsNull(call.Arguments[0]) {
			reason = call.Arguments[0].String()
			if runes := []rune(reason); len(runes) > maxRejectReasonLength {
				reason = string(runes[:maxRejectReasonLength])
			}
		}
		out.Rejected = true
		out.RejectReason = reason
		panic(errRejected)
	})
}

func numArg(call goja.FunctionCall, i int) float64 {
	if i >= len(call.Arguments) {
		return math.NaN()
	}
	return call.Arguments[i].ToFloat()
}

func intArg(call goja.FunctionCall, i int) int {
	f := numArg(call, i)
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return int(f)
}

func strArg(call goja.FunctionCall, i int) string {
	if i >= len(call.Arguments) {
		return ""
	}
	v := call.Arguments[i]
	if goja.IsUndefined(v) || goja.IsNull(v) {
		return ""
	}
	return v.String()
}
