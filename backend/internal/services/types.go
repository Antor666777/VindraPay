package services

import (
	"github.com/google/uuid"

	db "vindrapay-go/internal/db"
)

type MessageStatus string

const (
	MsgParsed    MessageStatus = "parsed"
	MsgDuplicate MessageStatus = "duplicate"
	MsgUnmatched MessageStatus = "unmatched"
	MsgError     MessageStatus = "error"
	MsgSkipped   MessageStatus = "skipped"
)

type MessageResult struct {
	ClientMsgID uuid.UUID     `json:"client_msg_id"`
	Status      MessageStatus `json:"status"`
	Error       string        `json:"error,omitempty"`
}

type VerifyOutcome struct {
	Result            string
	HTTPStatus        int
	Order             *db.Order
	Transaction       *db.Transaction
	BalanceConsistent *bool
}

func ptr[T any](v T) *T {
	return &v
}
