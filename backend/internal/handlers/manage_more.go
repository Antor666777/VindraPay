package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/services"
)

type deviceView struct {
	ID            uuid.UUID  `json:"id"`
	BusinessID    uuid.UUID  `json:"business_id"`
	BusinessName  string     `json:"business_name"`
	Name          string     `json:"name"`
	TokenPrefix   string     `json:"token_prefix"`
	AppVersion    *string    `json:"app_version"`
	OsVersion     *string    `json:"os_version"`
	LastPingAt    *time.Time `json:"last_ping_at"`
	DeactivatedAt *time.Time `json:"deactivated_at"`
	Online        bool       `json:"online"`
	CreatedAt     time.Time  `json:"created_at"`
}

func deviceOnline(d db.Device) bool {
	return !d.DeactivatedAt.Valid && d.LastPingAt.Valid && time.Since(d.LastPingAt.Time) < 5*time.Minute
}

func deviceViewFromDevice(d db.Device, businessName string) deviceView {
	return deviceView{
		ID:            d.ID,
		BusinessID:    d.BusinessID,
		BusinessName:  businessName,
		Name:          d.Name,
		TokenPrefix:   d.TokenPrefix,
		AppVersion:    d.AppVersion,
		OsVersion:     d.OsVersion,
		LastPingAt:    tsPtr(d.LastPingAt),
		DeactivatedAt: tsPtr(d.DeactivatedAt),
		Online:        deviceOnline(d),
		CreatedAt:     d.CreatedAt,
	}
}

func deviceViewFromRow(row db.ListDevicesPagedRow) deviceView {
	return deviceView{
		ID:            row.ID,
		BusinessID:    row.BusinessID,
		BusinessName:  row.BusinessName,
		Name:          row.Name,
		TokenPrefix:   row.TokenPrefix,
		AppVersion:    row.AppVersion,
		OsVersion:     row.OsVersion,
		LastPingAt:    tsPtr(row.LastPingAt),
		DeactivatedAt: tsPtr(row.DeactivatedAt),
		Online:        row.Online,
		CreatedAt:     row.CreatedAt,
	}
}

func (h *ManageHandler) ListDevices(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}

	rows, err := h.q.ListDevicesPaged(c.Request.Context(), db.ListDevicesPagedParams{
		Limit:      getLimit(c),
		Offset:     getOffset(c),
		BusinessID: businessID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list devices"})
		return
	}

	total, err := h.q.CountDevices(c.Request.Context(), businessID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count devices"})
		return
	}

	items := make([]deviceView, 0, len(rows))
	for _, row := range rows {
		items = append(items, deviceViewFromRow(row))
	}

	sendList(c, items, total)
}

type createDeviceRequest struct {
	Name       string `json:"name" binding:"required,max=100"`
	AppVersion string `json:"app_version" binding:"max=128"`
	OsVersion  string `json:"os_version" binding:"max=128"`
}

func (h *ManageHandler) CreateDevice(c *gin.Context) {
	businessID, ok := pathUUID(c, "business_id", "business id")
	if !ok {
		return
	}

	business, ok := h.requireBusiness(c, businessID)
	if !ok {
		return
	}

	var req createDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	token, prefix, hash := services.GenerateToken("vdt")

	var appVersion, osVersion *string
	if req.AppVersion != "" {
		appVersion = &req.AppVersion
	}
	if req.OsVersion != "" {
		osVersion = &req.OsVersion
	}

	device, err := h.q.CreateDevice(c.Request.Context(), db.CreateDeviceParams{
		BusinessID:  businessID,
		Name:        req.Name,
		TokenHash:   hash,
		TokenPrefix: prefix,
		AppVersion:  appVersion,
		OsVersion:   osVersion,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create device"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"device": deviceViewFromDevice(device, business.Name),
			"token":  token,
		},
	})
}

func (h *ManageHandler) DeactivateDevice(c *gin.Context) {
	deviceID, ok := pathUUID(c, "device_id", "device id")
	if !ok {
		return
	}

	device, err := h.q.GetDeviceByID(c.Request.Context(), deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "device not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load device"})
		return
	}

	business, err := h.q.GetBusiness(c.Request.Context(), device.BusinessID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load device"})
		return
	}

	updated, err := h.q.DeactivateDevice(c.Request.Context(), db.DeactivateDeviceParams{
		ID:         device.ID,
		BusinessID: device.BusinessID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": deviceViewFromDevice(device, business.Name)})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not deactivate device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": deviceViewFromDevice(updated, business.Name)})
}

func (h *ManageHandler) ListOrders(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}
	status := strPtr(c.Query("status"))

	items, err := h.q.ListOrdersPaged(c.Request.Context(), db.ListOrdersPagedParams{
		Limit:      getLimit(c),
		Offset:     getOffset(c),
		Status:     status,
		BusinessID: businessID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list orders"})
		return
	}

	total, err := h.q.CountOrders(c.Request.Context(), db.CountOrdersParams{
		Status:     status,
		BusinessID: businessID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count orders"})
		return
	}

	sendList(c, items, total)
}

func (h *ManageHandler) ListTransactions(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}
	providerID, ok := optionalQueryUUID(c, "provider_id")
	if !ok {
		return
	}
	direction := strPtr(c.Query("direction"))

	items, err := h.q.ListTransactionsPaged(c.Request.Context(), db.ListTransactionsPagedParams{
		Limit:      getLimit(c),
		Offset:     getOffset(c),
		BusinessID: businessID,
		ProviderID: providerID,
		Direction:  direction,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list transactions"})
		return
	}

	total, err := h.q.CountTransactions(c.Request.Context(), db.CountTransactionsParams{
		BusinessID: businessID,
		ProviderID: providerID,
		Direction:  direction,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count transactions"})
		return
	}

	sendList(c, items, total)
}

func (h *ManageHandler) ListAttempts(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}
	result := strPtr(c.Query("result"))
	trxID := strPtr(c.Query("trx_id"))

	items, err := h.q.ListAttemptsPaged(c.Request.Context(), db.ListAttemptsPagedParams{
		Limit:      getLimit(c),
		Offset:     getOffset(c),
		BusinessID: businessID,
		Result:     result,
		TrxID:      trxID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list attempts"})
		return
	}

	total, err := h.q.CountAttempts(c.Request.Context(), db.CountAttemptsParams{
		BusinessID: businessID,
		Result:     result,
		TrxID:      trxID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count attempts"})
		return
	}

	sendList(c, items, total)
}

func (h *ManageHandler) ListMessages(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}
	parseStatus := strPtr(c.Query("parse_status"))

	items, err := h.q.ListMessagesPaged(c.Request.Context(), db.ListMessagesPagedParams{
		Limit:       getLimit(c),
		Offset:      getOffset(c),
		BusinessID:  businessID,
		ParseStatus: parseStatus,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list messages"})
		return
	}

	total, err := h.q.CountMessages(c.Request.Context(), db.CountMessagesParams{
		BusinessID:  businessID,
		ParseStatus: parseStatus,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count messages"})
		return
	}

	sendList(c, items, total)
}

func (h *ManageHandler) Stats(c *gin.Context) {
	stats, err := h.q.GetStudioStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load stats"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}

type manageProviderView struct {
	ID              uuid.UUID  `json:"id"`
	BusinessID      *uuid.UUID `json:"business_id"`
	BusinessName    *string    `json:"business_name"`
	Name            string     `json:"name"`
	SenderID        *string    `json:"sender_id"`
	SmsTemplate     string     `json:"sms_template"`
	CompiledPattern string     `json:"compiled_pattern"`
	Priority        int32      `json:"priority"`
	IsActive        bool       `json:"is_active"`
	Direction       string     `json:"direction"`
	MatchMode       string     `json:"match_mode"`
	Script          *string    `json:"script"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func manageProviderViewFromRow(row db.ListProvidersPagedRow) manageProviderView {
	return manageProviderView{
		ID:              row.ID,
		BusinessID:      row.BusinessID,
		BusinessName:    row.BusinessName,
		Name:            row.Name,
		SenderID:        row.SenderID,
		SmsTemplate:     row.SmsTemplate,
		CompiledPattern: row.CompiledPattern,
		Priority:        row.Priority,
		IsActive:        row.IsActive,
		Direction:       row.Direction,
		MatchMode:       row.MatchMode,
		Script:          row.Script,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func (h *ManageHandler) ListProviders(c *gin.Context) {
	businessID, ok := optionalQueryUUID(c, "business_id")
	if !ok {
		return
	}
	direction := strPtr(c.Query("direction"))
	matchMode := strPtr(c.Query("match_mode"))

	rows, err := h.q.ListProvidersPaged(c.Request.Context(), db.ListProvidersPagedParams{
		Limit:      getLimit(c),
		Offset:     getOffset(c),
		BusinessID: businessID,
		Direction:  direction,
		MatchMode:  matchMode,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list providers"})
		return
	}

	total, err := h.q.CountProviders(c.Request.Context(), db.CountProvidersParams{
		BusinessID: businessID,
		Direction:  direction,
		MatchMode:  matchMode,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count providers"})
		return
	}

	items := make([]manageProviderView, 0, len(rows))
	for _, row := range rows {
		items = append(items, manageProviderViewFromRow(row))
	}

	sendList(c, items, total)
}

type manageCreateProviderRequest struct {
	BusinessID  *uuid.UUID `json:"business_id"`
	Name        string     `json:"name" binding:"required,max=100"`
	SenderID    string     `json:"sender_id" binding:"max=32"`
	SMSTemplate string     `json:"sms_template" binding:"required,max=1024"`
	Priority    *int32     `json:"priority,omitempty"`
	Direction   string     `json:"direction" binding:"omitempty,oneof=credit debit"`
	MatchMode   string     `json:"match_mode" binding:"omitempty,oneof=template regex"`
	Script      string     `json:"script" binding:"max=4096"`
}

func (h *ManageHandler) CreateProvider(c *gin.Context) {
	var req manageCreateProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	if !validateScriptRequest(c, req.Script) {
		return
	}

	if req.BusinessID != nil {
		if _, ok := h.requireBusiness(c, *req.BusinessID); !ok {
			return
		}
	}

	matchMode := req.MatchMode
	if matchMode == "" {
		matchMode = "template"
	}

	tpl, err := compileByMode(matchMode, req.SMSTemplate)
	if err != nil {
		invalidTemplate(c, err)
		return
	}

	priority := defaultPriority
	if req.Priority != nil && *req.Priority >= 0 && *req.Priority <= 10000 {
		priority = *req.Priority
	}

	var senderID *string
	if req.SenderID != "" {
		senderID = &req.SenderID
	}

	direction := req.Direction
	if direction == "" {
		direction = "credit"
	}

	var scriptPtr *string
	if req.Script != "" {
		scriptPtr = &req.Script
	}

	provider, err := h.q.CreateProvider(c.Request.Context(), db.CreateProviderParams{
		BusinessID:      req.BusinessID,
		Name:            req.Name,
		SenderID:        senderID,
		SmsTemplate:     req.SMSTemplate,
		CompiledPattern: tpl.Pattern.String(),
		Priority:        priority,
		Direction:       direction,
		MatchMode:       matchMode,
		Script:          scriptPtr,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create provider"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": provider})
}

type manageUpdateTemplateRequest struct {
	SMSTemplate string `json:"sms_template" binding:"required,max=1024"`
	Direction   string `json:"direction" binding:"omitempty,oneof=credit debit"`
	MatchMode   string `json:"match_mode" binding:"omitempty,oneof=template regex"`
	Script      string `json:"script" binding:"max=4096"`
}

func (h *ManageHandler) UpdateProviderTemplate(c *gin.Context) {
	providerID, ok := pathUUID(c, "id", "provider id")
	if !ok {
		return
	}

	var req manageUpdateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	if !validateScriptRequest(c, req.Script) {
		return
	}

	matchMode := req.MatchMode
	if matchMode == "" {
		matchMode = "template"
	}

	tpl, err := compileByMode(matchMode, req.SMSTemplate)
	if err != nil {
		invalidTemplate(c, err)
		return
	}

	direction := req.Direction
	if direction == "" {
		direction = "credit"
	}

	var scriptPtr *string
	if req.Script != "" {
		scriptPtr = &req.Script
	}

	provider, err := h.q.UpdateProviderTemplateGlobal(c.Request.Context(), db.UpdateProviderTemplateGlobalParams{
		ID:              providerID,
		SmsTemplate:     req.SMSTemplate,
		CompiledPattern: tpl.Pattern.String(),
		Direction:       direction,
		Script:          scriptPtr,
		MatchMode:       matchMode,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update provider"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

func (h *ManageHandler) DeactivateProvider(c *gin.Context) {
	providerID, ok := pathUUID(c, "id", "provider id")
	if !ok {
		return
	}

	provider, err := h.q.DeactivateProviderGlobal(c.Request.Context(), providerID)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, ferr := h.q.GetProvider(c.Request.Context(), providerID)
		if errors.Is(ferr, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
			return
		}
		if ferr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not deactivate provider"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": existing})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not deactivate provider"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

type manageCalibrateBalanceRequest struct {
	ProviderID uuid.UUID `json:"provider_id" binding:"required"`
	Balance    string    `json:"balance" binding:"required"`
	Note       string    `json:"note" binding:"max=255"`
}

func (h *ManageHandler) CalibrateBalance(c *gin.Context) {
	deviceID, ok := pathUUID(c, "device_id", "device id")
	if !ok {
		return
	}

	device, err := h.q.GetDeviceByID(c.Request.Context(), deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "device not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load device"})
		return
	}

	var req manageCalibrateBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	provider, err := h.q.GetProvider(c.Request.Context(), req.ProviderID)
	if errors.Is(err, pgx.ErrNoRows) || (provider.BusinessID != nil && *provider.BusinessID != device.BusinessID) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider"})
		return
	}

	balance, ok := parseBalance(req.Balance)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid balance"})
		return
	}

	var note *string
	if req.Note != "" {
		note = &req.Note
	}

	calibration, err := h.q.CreateBalanceCalibration(c.Request.Context(), db.CreateBalanceCalibrationParams{
		BusinessID: device.BusinessID,
		DeviceID:   device.ID,
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

func (h *ManageHandler) DeviceBalance(c *gin.Context) {
	deviceID, ok := pathUUID(c, "device_id", "device id")
	if !ok {
		return
	}

	device, err := h.q.GetDeviceByID(c.Request.Context(), deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "device not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load device"})
		return
	}

	rawProviderID := c.Query("provider_id")
	if rawProviderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "provider_id query parameter is required"})
		return
	}
	providerID, err := uuid.Parse(rawProviderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "provider_id query parameter is required"})
		return
	}

	point, err := h.q.GetLatestBalancePoint(c.Request.Context(), db.GetLatestBalancePointParams{
		DeviceID:   device.ID,
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
			"device_id":   device.ID,
			"provider_id": providerID,
			"balance":     point.Balance.String(),
			"source":      point.Source,
			"point_at":    point.PointAt,
		},
	})
}
