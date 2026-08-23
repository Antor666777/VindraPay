package services

import (
	"context"
	"errors"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/shopspring/decimal"

	db "vindrapay-go/internal/db"
)

const (
	ResultSuccess         = "success"
	ResultNotFound        = "not_found"
	ResultAlreadyUsed     = "already_used"
	ResultAmountMismatch  = "amount_mismatch"
	ResultOrderExpired    = "order_expired"
	ResultOrderNotPending = "order_not_pending"
	ResultBalanceMismatch = "balance_mismatch"
	ResultWrongDirection  = "wrong_direction"
)

type VerifyService struct{ q *db.Queries }

func NewVerifyService(q *db.Queries) *VerifyService {
	return &VerifyService{q: q}
}

func (s *VerifyService) Verify(ctx context.Context, businessID uuid.UUID, externalOrderID, submittedTrxID string, sourceIP *netip.Addr) (VerifyOutcome, error) {
	order, err := s.q.GetOrderByExternalID(ctx, db.GetOrderByExternalIDParams{
		BusinessID:      businessID,
		ExternalOrderID: externalOrderID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		outcome := VerifyOutcome{Result: ResultNotFound, HTTPStatus: 404}
		s.logAttempt(ctx, businessID, nil, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}
	if err != nil {
		return VerifyOutcome{}, err
	}

	if order.Status == "pending" && order.ExpiresAt.Valid && order.ExpiresAt.Time.Before(time.Now()) {
		outcome := VerifyOutcome{Result: ResultOrderExpired, HTTPStatus: 409, Order: &order}
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}

	if order.Status != "pending" {
		outcome := VerifyOutcome{Result: ResultOrderNotPending, HTTPStatus: 409, Order: &order}
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}

	tx, err := s.q.FindTransactionByTrxIDForBusiness(ctx, db.FindTransactionByTrxIDForBusinessParams{
		TrxID:      submittedTrxID,
		BusinessID: businessID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		outcome := VerifyOutcome{Result: ResultNotFound, HTTPStatus: 404, Order: &order}
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}
	if err != nil {
		return VerifyOutcome{}, err
	}

	if tx.Direction == "debit" {
		outcome := VerifyOutcome{
			Result:            ResultWrongDirection,
			HTTPStatus:        422,
			Order:             &order,
			Transaction:       &tx,
			BalanceConsistent: nil,
		}
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, &tx.ID, nil, nil, sourceIP)
		return outcome, nil
	}

	if !tx.Amount.Equal(order.ExpectedAmount) {
		outcome := VerifyOutcome{
			Result:            ResultAmountMismatch,
			HTTPStatus:        422,
			Order:             &order,
			Transaction:       &tx,
			BalanceConsistent: nil,
		}
		submittedAmount := tx.Amount
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, &tx.ID, &submittedAmount, nil, sourceIP)
		return outcome, nil
	}

	var balanceConsistent *bool
	if tx.BalanceAfter != nil {
		laterCalib, err := s.q.GetLatestCalibrationAfter(ctx, db.GetLatestCalibrationAfterParams{
			DeviceID:     tx.DeviceID,
			CalibratedAt: tx.ReceivedAt,
			ProviderID:   tx.ProviderID,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return VerifyOutcome{}, err
		}
		hasLaterCalib := !errors.Is(err, pgx.ErrNoRows)
		laterCount, err := s.q.CountTransactionsAfter(ctx, db.CountTransactionsAfterParams{
			DeviceID:   tx.DeviceID,
			ID:         tx.ID,
			ReceivedAt: tx.ReceivedAt,
			ProviderID: tx.ProviderID,
		})
		if err != nil {
			return VerifyOutcome{}, err
		}

		var consistent *bool
		switch {
		case hasLaterCalib && laterCount == 0:
			c := laterCalib.Equal(*tx.BalanceAfter)
			consistent = &c
		default:
			prev, perr := s.q.GetPreviousBalance(ctx, db.GetPreviousBalanceParams{
				DeviceID:   tx.DeviceID,
				ID:         tx.ID,
				ReceivedAt: tx.ReceivedAt,
				ProviderID: tx.ProviderID,
			})
			if perr != nil && !errors.Is(perr, pgx.ErrNoRows) {
				return VerifyOutcome{}, perr
			}
			if prev != nil {
				var expected decimal.Decimal
				if tx.Direction == "debit" {
					expected = prev.Sub(tx.Amount)
				} else {
					expected = prev.Add(tx.Amount)
				}
				c := expected.Equal(*tx.BalanceAfter)
				consistent = &c
			}
		}
		balanceConsistent = consistent
		if consistent != nil && !*consistent {
			outcome := VerifyOutcome{
				Result:            ResultBalanceMismatch,
				HTTPStatus:        422,
				Order:             &order,
				Transaction:       &tx,
				BalanceConsistent: balanceConsistent,
			}
			s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, &tx.ID, nil, balanceConsistent, sourceIP)
			return outcome, nil
		}
	}

	claimed, err := s.q.ClaimTransactionForOrder(ctx, db.ClaimTransactionForOrderParams{
		ID:                   order.ID,
		MatchedTransactionID: &tx.ID,
		BusinessID:           businessID,
	})
	if err == nil {
		outcome := VerifyOutcome{
			Result:            ResultSuccess,
			HTTPStatus:        200,
			Order:             &claimed,
			Transaction:       &tx,
			BalanceConsistent: balanceConsistent,
		}
		s.logAttempt(ctx, businessID, &claimed.ID, submittedTrxID, outcome, &tx.ID, nil, balanceConsistent, sourceIP)
		return outcome, nil
	}

	if errors.Is(err, pgx.ErrNoRows) {
		fresh, ferr := s.q.GetOrderByExternalID(ctx, db.GetOrderByExternalIDParams{
			BusinessID:      businessID,
			ExternalOrderID: externalOrderID,
		})
		if ferr != nil {
			return VerifyOutcome{}, ferr
		}
		result := ResultOrderNotPending
		if fresh.Status == "paid" {
			result = ResultAlreadyUsed
		}
		outcome := VerifyOutcome{Result: result, HTTPStatus: 409, Order: &fresh}
		s.logAttempt(ctx, businessID, &fresh.ID, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		outcome := VerifyOutcome{Result: ResultAlreadyUsed, HTTPStatus: 409, Order: &order}
		s.logAttempt(ctx, businessID, &order.ID, submittedTrxID, outcome, nil, nil, nil, sourceIP)
		return outcome, nil
	}

	return VerifyOutcome{}, err
}

func (s *VerifyService) logAttempt(ctx context.Context, businessID uuid.UUID, orderID *uuid.UUID, submittedTrxID string, outcome VerifyOutcome, matchedTransactionID *uuid.UUID, submittedAmount *decimal.Decimal, balanceConsistent *bool, sourceIP *netip.Addr) {
	_ = s.q.InsertVerificationAttempt(ctx, db.InsertVerificationAttemptParams{
		BusinessID:           businessID,
		OrderID:              orderID,
		SubmittedTrxID:       submittedTrxID,
		Result:               outcome.Result,
		MatchedTransactionID: matchedTransactionID,
		SubmittedAmount:      submittedAmount,
		BalanceConsistent:    balanceConsistent,
		SourceIp:             sourceIP,
	})
}
