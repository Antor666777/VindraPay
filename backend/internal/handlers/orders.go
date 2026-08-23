package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/middleware"
	"vindrapay-go/internal/services"
)

type OrderHandler struct {
	q      *db.Queries
	verify *services.VerifyService
}

func NewOrderHandler(q *db.Queries, v *services.VerifyService) *OrderHandler {
	return &OrderHandler{q: q, verify: v}
}

type createOrderRequest struct {
	ExternalOrderID string          `json:"external_order_id" binding:"required,max=200"`
	ExpectedAmount  string          `json:"expected_amount" binding:"required"`
	ExpiresAt       *time.Time      `json:"expires_at,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
}

type verifyOrderRequest struct {
	TrxID string `json:"trx_id" binding:"required,max=64"`
}

var verifyErrorMessages = map[string]string{
	services.ResultNotFound:        "order or transaction not found",
	services.ResultAlreadyUsed:     "transaction already used",
	services.ResultAmountMismatch:  "transaction amount does not match the order",
	services.ResultOrderExpired:    "order has expired",
	services.ResultOrderNotPending: "order is not pending",
	services.ResultBalanceMismatch: "device balance chain is inconsistent",
	services.ResultWrongDirection:  "transaction is not a received payment (it is a debit)",
}

var maxOrderAmount = decimal.RequireFromString("9999999999.99")

func parseExpectedAmount(raw string) (decimal.Decimal, bool) {
	cleaned := strings.ReplaceAll(raw, ",", "")
	if cleaned == "" || strings.ContainsAny(cleaned, "eE") {
		return decimal.Decimal{}, false
	}
	amount, err := decimal.NewFromString(cleaned)
	if err != nil || amount.Sign() <= 0 {
		return decimal.Decimal{}, false
	}
	if -amount.Exponent() > 2 || amount.GreaterThan(maxOrderAmount) {
		return decimal.Decimal{}, false
	}
	return amount, true
}

func (h *OrderHandler) Create(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	var req createOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	amount, ok := parseExpectedAmount(req.ExpectedAmount)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid expected_amount"})
		return
	}

	expiresAt := pgtype.Timestamptz{}
	if req.ExpiresAt != nil {
		expiresAt = pgtype.Timestamptz{Time: *req.ExpiresAt, Valid: true}
	}

	order, err := h.q.InsertOrder(c.Request.Context(), db.InsertOrderParams{
		BusinessID:      businessID,
		ExternalOrderID: req.ExternalOrderID,
		ExpectedAmount:  amount,
		ExpiresAt:       expiresAt,
		Metadata:        req.Metadata,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, ferr := h.q.GetOrderByExternalID(c.Request.Context(), db.GetOrderByExternalIDParams{
				BusinessID:      businessID,
				ExternalOrderID: req.ExternalOrderID,
			})
			if ferr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "failed to create order"})
				return
			}
			order = existing
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "failed to create order"})
			return
		}
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": order})
}

func (h *OrderHandler) Get(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	order, err := h.q.GetOrderByExternalID(c.Request.Context(), db.GetOrderByExternalIDParams{
		BusinessID:      businessID,
		ExternalOrderID: c.Param("external_order_id"),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "failed to fetch order"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": order})
}

func (h *OrderHandler) Verify(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	var req verifyOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	var sourceIP *netip.Addr
	if ip := c.ClientIP(); ip != "" {
		if addr, perr := netip.ParseAddr(ip); perr == nil {
			sourceIP = &addr
		}
	}

	outcome, err := h.verify.Verify(c.Request.Context(), businessID, c.Param("external_order_id"), req.TrxID, sourceIP)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "verification failed"})
		return
	}

	if outcome.Result == services.ResultSuccess {
		c.JSON(outcome.HTTPStatus, gin.H{
			"success": true,
			"data": gin.H{
				"result":             outcome.Result,
				"order":              outcome.Order,
				"transaction":        outcome.Transaction,
				"balance_consistent": outcome.BalanceConsistent,
			},
		})
		return
	}

	message, ok := verifyErrorMessages[outcome.Result]
	if !ok {
		message = "verification failed"
	}
	c.JSON(outcome.HTTPStatus, gin.H{
		"success": false,
		"result":  outcome.Result,
		"error":   message,
	})
}
