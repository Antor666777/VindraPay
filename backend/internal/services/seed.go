package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/smsparser"
)

type builtinProvider struct {
	Name     string
	SenderID string
	Template string
}

var builtinProviders = []builtinProvider{
	{
		Name:     "bKash",
		SenderID: "bKash",
		Template: "You have received Tk {amount} from {sender}. Balance: Tk {balance}. TrxID {trxId}",
	},
	{
		Name:     "Nagad",
		SenderID: "NAGAD",
		Template: "Money received successfully. Amount Tk {amount} from {sender}. TrxID {trxId}. New balance Tk {balance}.",
	},
	{
		Name:     "Rocket",
		SenderID: "Rocket",
		Template: "You have received Tk{amount} from {sender}. TxnId: {trxId}. Balance: Tk{balance}",
	},
	{
		Name:     "Upay",
		SenderID: "Upay",
		Template: "You have received BDT {amount} from {sender}. Transaction ID: {trxId}. New balance is Tk {balance}.",
	},
}

type Seeder struct{ q *db.Queries }

func NewSeeder(q *db.Queries) *Seeder {
	return &Seeder{q: q}
}

func (s *Seeder) SeedBuiltins(ctx context.Context) error {
	for _, p := range builtinProviders {
		tpl, err := smsparser.Compile(p.Template)
		if err != nil {
			return fmt.Errorf("seed provider %s: %w", p.Name, err)
		}

		existing, err := s.q.GetGlobalProviderByName(ctx, p.Name)
		if errors.Is(err, pgx.ErrNoRows) {
			var senderID *string
			if p.SenderID != "" {
				senderID = ptr(p.SenderID)
			}
			if _, err := s.q.CreateProvider(ctx, db.CreateProviderParams{
				BusinessID:      nil,
				Name:            p.Name,
				SenderID:        senderID,
				SmsTemplate:     p.Template,
				CompiledPattern: tpl.Pattern.String(),
				Priority:        100,
				Direction:       "credit",
				MatchMode:       "template",
			}); err != nil {
				return fmt.Errorf("seed provider %s: %w", p.Name, err)
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("seed provider %s: %w", p.Name, err)
		}
		if existing.CompiledPattern != tpl.Pattern.String() {
			continue
		}
	}
	return nil
}
