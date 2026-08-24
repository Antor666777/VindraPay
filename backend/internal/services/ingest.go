package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/scripting"
	"vindrapay-go/internal/smsparser"
)

type ScriptOptions struct {
	TimeoutMs   int
	AllowUnsafe bool
}

type IngestService struct {
	q    *db.Queries
	opts ScriptOptions
}

func NewIngestService(q *db.Queries, opts ScriptOptions) *IngestService {
	return &IngestService{q: q, opts: opts}
}

type IngestMessage struct {
	ClientMsgID      uuid.UUID
	SenderID         string
	Body             string
	DeviceReceivedAt pgtype.Timestamptz
}

func (s *IngestService) IngestBatch(ctx context.Context, device db.Device, msgs []IngestMessage) []MessageResult {
	providers, provErr := s.q.ListActiveProvidersForMatching(ctx, &device.BusinessID)
	results := make([]MessageResult, 0, len(msgs))
	for _, msg := range msgs {
		results = append(results, s.ingestOne(ctx, device, msg, providers, provErr))
	}
	return results
}

func (s *IngestService) ingestOne(ctx context.Context, device db.Device, msg IngestMessage, providers []db.Provider, provErr error) MessageResult {
	var senderID *string
	if msg.SenderID != "" {
		senderID = ptr(msg.SenderID)
	}

	raw, err := s.q.InsertRawMessage(ctx, db.InsertRawMessageParams{
		ClientMsgID:      msg.ClientMsgID,
		DeviceID:         device.ID,
		BusinessID:       device.BusinessID,
		SenderID:         senderID,
		Body:             msg.Body,
		DeviceReceivedAt: msg.DeviceReceivedAt,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgDuplicate}
	}
	if err != nil {
		return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgError, Error: err.Error()}
	}

	if provErr != nil {
		return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgError, Error: provErr.Error()}
	}

	for _, provider := range providers {
		if !senderGate(provider, msg.SenderID) {
			continue
		}

		var tpl *smsparser.Template
		var cerr error
		if provider.MatchMode == "regex" {
			tpl, cerr = smsparser.CompileRegex(provider.SmsTemplate)
		} else {
			tpl, cerr = smsparser.Compile(provider.SmsTemplate)
		}
		if cerr != nil || tpl.Pattern.String() != provider.CompiledPattern {
			continue
		}

		m, err := tpl.Match(msg.Body)
		if err != nil {
			_ = s.q.MarkRawMessageError(ctx, db.MarkRawMessageErrorParams{
				ID:          raw.ID,
				ErrorCode:   ptr("PARSE_ERROR"),
				ErrorDetail: ptr(err.Error()),
			})
			return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgError, Error: err.Error()}
		}
		if m == nil {
			continue
		}

		scriptOut, skip, serr := s.runProviderScript(provider, msg, m)
		if serr != nil {
			_ = s.q.MarkRawMessageError(ctx, db.MarkRawMessageErrorParams{
				ID:          raw.ID,
				ErrorCode:   ptr("SCRIPT_ERROR"),
				ErrorDetail: ptr(serr.Error()),
			})
			return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgError, Error: serr.Error()}
		}
		if skip {
			var detail *string
			if scriptOut.RejectReason != "" {
				detail = ptr(scriptOut.RejectReason)
			}
			_ = s.q.MarkRawMessageSkipped(ctx, db.MarkRawMessageSkippedParams{
				ID:          raw.ID,
				ErrorDetail: detail,
			})
			return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgSkipped}
		}

		trxID := m.TrxID
		senderMsisdn := m.Sender
		balanceAfter := m.Balance
		if scriptOut != nil {
			if scriptOut.TrxIDOverride != nil {
				trxID = *scriptOut.TrxIDOverride
			}
			if scriptOut.Sender != nil && *scriptOut.Sender != "" {
				senderMsisdn = *scriptOut.Sender
			}
			if scriptOut.BalanceAfterOverride != nil {
				balanceAfter = scriptOut.BalanceAfterOverride
			}
		}

		var senderPtr *string
		if senderMsisdn != "" {
			senderPtr = &senderMsisdn
		}
		tx, ierr := s.q.InsertTransaction(ctx, db.InsertTransactionParams{
			ProviderID:      provider.ID,
			TrxID:           trxID,
			BusinessID:      device.BusinessID,
			DeviceID:        device.ID,
			RawMessageID:    raw.ID,
			Amount:          m.Amount,
			SenderMsisdn:    senderPtr,
			BalanceAfter:    balanceAfter,
			Direction:       provider.Direction,
			EffectiveAmount: effectiveOf(scriptOut),
			Meta:            metaJSON(scriptOut),
		})
		if errors.Is(ierr, pgx.ErrNoRows) {
			tx, ierr = s.q.GetTransactionByProviderAndTrxID(ctx, db.GetTransactionByProviderAndTrxIDParams{
				ProviderID: provider.ID,
				TrxID:      trxID,
			})
		}
		if ierr != nil {
			return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgError, Error: ierr.Error()}
		}

		_ = s.q.MarkRawMessageParsed(ctx, db.MarkRawMessageParsedParams{
			ID:             raw.ID,
			ProviderID:     &provider.ID,
			MatchedPattern: &provider.CompiledPattern,
			TransactionID:  &tx.ID,
		})
		return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgParsed}
	}

	_ = s.q.MarkRawMessageUnmatched(ctx, raw.ID)
	return MessageResult{ClientMsgID: msg.ClientMsgID, Status: MsgUnmatched}
}

func (s *IngestService) runProviderScript(provider db.Provider, msg IngestMessage, m *smsparser.Fields) (*scripting.Output, bool, error) {
	if provider.Script == nil || strings.TrimSpace(*provider.Script) == "" {
		return nil, false, nil
	}

	var balance *float64
	if m.Balance != nil {
		f := m.Balance.InexactFloat64()
		balance = &f
	}
	amount := m.Amount.InexactFloat64()

	out, err := scripting.Run(
		*provider.Script,
		scripting.Input{
			Amount:       &amount,
			Sender:       m.Sender,
			TrxID:        m.TrxID,
			Balance:      balance,
			Body:         msg.Body,
			Direction:    provider.Direction,
			ProviderName: provider.Name,
		},
		time.Duration(s.opts.TimeoutMs)*time.Millisecond,
		s.opts.AllowUnsafe,
	)
	if err != nil {
		return nil, false, err
	}
	if out.Rejected {
		return out, true, nil
	}
	return out, false, nil
}

func effectiveOf(out *scripting.Output) *decimal.Decimal {
	if out == nil {
		return nil
	}
	return out.EffectiveAmount
}

func metaJSON(out *scripting.Output) []byte {
	if out == nil || out.Meta == nil {
		return nil
	}
	b, err := json.Marshal(out.Meta)
	if err != nil {
		return nil
	}
	return b
}

func senderGate(provider db.Provider, messageSender string) bool {
	if provider.SenderID == nil || *provider.SenderID == "" {
		return true
	}
	if messageSender == "" {
		return false
	}
	return strings.EqualFold(messageSender, *provider.SenderID)
}
