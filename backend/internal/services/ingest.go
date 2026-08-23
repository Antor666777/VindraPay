package services

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/smsparser"
)

type IngestService struct{ q *db.Queries }

func NewIngestService(q *db.Queries) *IngestService {
	return &IngestService{q: q}
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

		var senderMsisdn *string
		if m.Sender != "" {
			senderMsisdn = &m.Sender
		}
		tx, ierr := s.q.InsertTransaction(ctx, db.InsertTransactionParams{
			ProviderID:   provider.ID,
			TrxID:        m.TrxID,
			BusinessID:   device.BusinessID,
			DeviceID:     device.ID,
			RawMessageID: raw.ID,
			Amount:       m.Amount,
			SenderMsisdn: senderMsisdn,
			BalanceAfter: m.Balance,
			Direction:    provider.Direction,
		})
		if errors.Is(ierr, pgx.ErrNoRows) {
			tx, ierr = s.q.GetTransactionByProviderAndTrxID(ctx, db.GetTransactionByProviderAndTrxIDParams{
				ProviderID: provider.ID,
				TrxID:      m.TrxID,
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

func senderGate(provider db.Provider, messageSender string) bool {
	if provider.SenderID == nil || *provider.SenderID == "" {
		return true
	}
	if messageSender == "" {
		return false
	}
	return strings.EqualFold(messageSender, *provider.SenderID)
}
