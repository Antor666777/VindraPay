package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"vindrapay-go/internal/middleware"
	"vindrapay-go/internal/smsparser"

	db "vindrapay-go/internal/db"
)

type ProviderHandler struct {
	q *db.Queries
}

func NewProviderHandler(q *db.Queries) *ProviderHandler {
	return &ProviderHandler{q: q}
}

const (
	maxTemplateLength = 1024
	defaultPriority   = int32(100)
)

type createProviderRequest struct {
	Name        string `json:"name" binding:"required,max=100"`
	SenderID    string `json:"sender_id" binding:"max=32"`
	SMSTemplate string `json:"sms_template" binding:"required,max=1024"`
	Priority    *int32 `json:"priority,omitempty"`
	Direction   string `json:"direction" binding:"omitempty,oneof=credit debit"`
	MatchMode   string `json:"match_mode" binding:"omitempty,oneof=template regex"`
}

type updateTemplateRequest struct {
	SMSTemplate string `json:"sms_template" binding:"required,max=1024"`
	Direction   string `json:"direction" binding:"omitempty,oneof=credit debit"`
	MatchMode   string `json:"match_mode" binding:"omitempty,oneof=template regex"`
}

type testTemplateRequest struct {
	SMSTemplate string `json:"sms_template" binding:"required,max=1024"`
	SampleBody  string `json:"sample_body" binding:"required,max=4096"`
	MatchMode   string `json:"match_mode" binding:"omitempty,oneof=template regex"`
}

func compileByMode(mode, template string) (*smsparser.Template, error) {
	if mode == "regex" {
		return smsparser.CompileRegex(template)
	}
	return smsparser.Compile(template)
}

func invalidTemplate(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{
		"success": false,
		"error":   "invalid sms_template: " + err.Error(),
	})
}

func (h *ProviderHandler) Create(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	var req createProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
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

	provider, err := h.q.CreateProvider(c.Request.Context(), db.CreateProviderParams{
		BusinessID:      &businessID,
		Name:            req.Name,
		SenderID:        senderID,
		SmsTemplate:     req.SMSTemplate,
		CompiledPattern: tpl.Pattern.String(),
		Priority:        priority,
		Direction:       direction,
		MatchMode:       matchMode,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create provider"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": provider})
}

func (h *ProviderHandler) List(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	providers, err := h.q.ListProvidersForBusiness(c.Request.Context(), &businessID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list providers"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": providers})
}

func (h *ProviderHandler) Get(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	providerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid provider id"})
		return
	}

	provider, err := h.q.GetProvider(c.Request.Context(), providerID)
	if errors.Is(err, pgx.ErrNoRows) || (provider.BusinessID != nil && *provider.BusinessID != businessID) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not get provider"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

func (h *ProviderHandler) UpdateTemplate(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	providerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid provider id"})
		return
	}

	var req updateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
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

	provider, err := h.q.UpdateProviderTemplate(c.Request.Context(), db.UpdateProviderTemplateParams{
		ID:              providerID,
		BusinessID:      &businessID,
		SmsTemplate:     req.SMSTemplate,
		CompiledPattern: tpl.Pattern.String(),
		Direction:       direction,
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

func (h *ProviderHandler) Deactivate(c *gin.Context) {
	businessID, ok := middleware.BusinessIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}

	providerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid provider id"})
		return
	}

	provider, err := h.q.DeactivateProvider(c.Request.Context(), db.DeactivateProviderParams{
		ID:         providerID,
		BusinessID: &businessID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not deactivate provider"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

func fieldsToMap(f *smsparser.Fields) gin.H {
	if f == nil {
		return gin.H{}
	}
	out := gin.H{
		"amount": f.Amount.String(),
		"sender": f.Sender,
		"trx_id": f.TrxID,
	}
	if f.Balance != nil {
		out["balance"] = f.Balance.String()
	} else {
		out["balance"] = nil
	}
	return out
}

func (h *ProviderHandler) Test(c *gin.Context) {
	var req testTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	var fields *smsparser.Fields
	var err error
	if req.MatchMode == "regex" {
		fields, err = smsparser.TestSampleRegex(req.SMSTemplate, req.SampleBody)
	} else {
		fields, err = smsparser.TestSample(req.SMSTemplate, req.SampleBody)
	}
	if err != nil {
		invalidTemplate(c, err)
		return
	}

	if fields == nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"match": false}})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"match":  true,
			"fields": fieldsToMap(fields),
		},
	})
}
