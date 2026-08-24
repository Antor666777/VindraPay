package handlers

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/middleware"
	"vindrapay-go/internal/services"
)

type DeviceHandler struct {
	q      *db.Queries
	ingest *services.IngestService
}

func NewDeviceHandler(q *db.Queries, ing *services.IngestService) *DeviceHandler {
	return &DeviceHandler{q: q, ingest: ing}
}

type heartbeatRequest struct {
	AppVersion string `json:"app_version" binding:"max=128"`
	OsVersion  string `json:"os_version" binding:"max=128"`
}

type deviceProvider struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	SenderID  *string   `json:"sender_id"`
	Direction string    `json:"direction"`
}

type inboundMessageRequest struct {
	ClientMsgID      uuid.UUID  `json:"client_msg_id" binding:"required"`
	SenderID         string     `json:"sender_id" binding:"max=64"`
	Body             string     `json:"body" binding:"required,max=4096"`
	DeviceReceivedAt *time.Time `json:"device_received_at"`
}

type messagesRequest struct {
	Messages []inboundMessageRequest `json:"messages" binding:"dive"`
}

func (h *DeviceHandler) Heartbeat(c *gin.Context) {
	device, ok := middleware.DeviceFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	var req heartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	if err := h.q.DeviceHeartbeat(c.Request.Context(), device.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "heartbeat failed"})
		return
	}

	if req.AppVersion != "" || req.OsVersion != "" {
		var appVersion, osVersion *string
		if req.AppVersion != "" {
			appVersion = &req.AppVersion
		}
		if req.OsVersion != "" {
			osVersion = &req.OsVersion
		}
		if err := h.q.UpdateDeviceMeta(c.Request.Context(), db.UpdateDeviceMetaParams{
			ID:         device.ID,
			AppVersion: appVersion,
			OsVersion:  osVersion,
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "failed to update device meta"})
			return
		}
	}

	rows, err := h.q.ListActiveProvidersForMatching(c.Request.Context(), &device.BusinessID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load providers"})
		return
	}

	providers := make([]deviceProvider, 0, len(rows))
	for _, p := range rows {
		providers = append(providers, deviceProvider{
			ID:        p.ID,
			Name:      p.Name,
			SenderID:  p.SenderID,
			Direction: p.Direction,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"providers": providers}})
}

func (h *DeviceHandler) Messages(c *gin.Context) {
	device, ok := middleware.DeviceFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	var req messagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	if len(req.Messages) < 1 || len(req.Messages) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "messages must contain 1-50 items"})
		return
	}

	msgs := make([]services.IngestMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		receivedAt := pgtype.Timestamptz{}
		if m.DeviceReceivedAt != nil {
			receivedAt = pgtype.Timestamptz{Time: *m.DeviceReceivedAt, Valid: true}
		}
		msgs = append(msgs, services.IngestMessage{
			ClientMsgID:      m.ClientMsgID,
			SenderID:         m.SenderID,
			Body:             m.Body,
			DeviceReceivedAt: receivedAt,
		})
	}

	results := h.ingest.IngestBatch(c.Request.Context(), device, msgs)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"results": results}})
}

type calibrateBalanceRequest struct {
	ProviderID uuid.UUID `json:"provider_id" binding:"required"`
	Balance    string    `json:"balance" binding:"required"`
	Note       string    `json:"note" binding:"max=255"`
}

var maxBalance = decimal.RequireFromString("9999999999.99")

func parseBalance(raw string) (decimal.Decimal, bool) {
	cleaned := strings.ReplaceAll(raw, ",", "")
	if cleaned == "" || strings.ContainsAny(cleaned, "eE") {
		return decimal.Decimal{}, false
	}
	bal, err := decimal.NewFromString(cleaned)
	if err != nil || bal.Sign() < 0 {
		return decimal.Decimal{}, false
	}
	if -bal.Exponent() > 2 || bal.GreaterThan(maxBalance) {
		return decimal.Decimal{}, false
	}
	return bal, true
}

func (h *DeviceHandler) resolveOwnedDevice(c *gin.Context, businessID uuid.UUID) (uuid.UUID, bool) {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid device id"})
		return uuid.Nil, false
	}
	if _, err := h.q.GetDeviceForBusiness(c.Request.Context(), db.GetDeviceForBusinessParams{
		ID:         deviceID,
		BusinessID: businessID,
	}); errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "device not found"})
		return uuid.Nil, false
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load device"})
		return uuid.Nil, false
	}
	return deviceID, true
}

func (h *DeviceHandler) CalibrateBalance(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	deviceID, ok := h.resolveOwnedDevice(c, businessID)
	if !ok {
		return
	}

	var req calibrateBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	balance, ok := parseBalance(req.Balance)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid balance"})
		return
	}

	provider, err := h.q.GetProvider(c.Request.Context(), req.ProviderID)
	if errors.Is(err, pgx.ErrNoRows) || (provider.BusinessID != nil && *provider.BusinessID != businessID) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider"})
		return
	}

	var note *string
	if req.Note != "" {
		note = &req.Note
	}

	calibration, err := h.q.CreateBalanceCalibration(c.Request.Context(), db.CreateBalanceCalibrationParams{
		BusinessID: businessID,
		DeviceID:   deviceID,
		ProviderID: provider.ID,
		Balance:    balance,
		Note:       note,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not calibrate balance"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": calibration})
}

func (h *DeviceHandler) DeviceBalance(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	deviceID, ok := h.resolveOwnedDevice(c, businessID)
	if !ok {
		return
	}

	providerID, err := uuid.Parse(c.Query("provider_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "provider_id query parameter is required"})
		return
	}

	point, err := h.q.GetLatestBalancePoint(c.Request.Context(), db.GetLatestBalancePointParams{
		DeviceID:   deviceID,
		ProviderID: providerID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no balance history for this device and provider yet"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load balance"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"device_id":   deviceID,
			"provider_id": providerID,
			"balance":     point.Balance.String(),
			"source":      point.Source,
			"point_at":    point.PointAt,
		},
	})
}
