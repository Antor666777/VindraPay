package handlers

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "vindrapay-go/internal/db"
	"vindrapay-go/internal/services"
)

type ManageHandler struct {
	q    *db.Queries
	sopt services.ScriptOptions
}

func NewManageHandler(q *db.Queries, sopt services.ScriptOptions) *ManageHandler {
	return &ManageHandler{q: q, sopt: sopt}
}

func (h *ManageHandler) Features(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"allow_unsafe_scripts": h.sopt.AllowUnsafe,
			"script_timeout_ms":    h.sopt.TimeoutMs,
		},
	})
}

const (
	defaultListLimit = int32(20)
	maxListLimit     = int32(100)
)

func getLimit(c *gin.Context) int32 {
	raw := c.Query("limit")
	if raw == "" {
		return defaultListLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultListLimit
	}
	if n < 1 {
		return 1
	}
	if n > int(maxListLimit) {
		return maxListLimit
	}
	return int32(n)
}

func getOffset(c *gin.Context) int32 {
	n, err := strconv.Atoi(c.Query("offset"))
	if err != nil || n < 0 {
		return 0
	}
	if n > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(n)
}

func sendList(c *gin.Context, items any, total int64) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func tsPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func optionalQueryUUID(c *gin.Context, name string) (*uuid.UUID, bool) {
	raw := c.Query(name)
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid " + name})
		return nil, false
	}
	return &id, true
}

func pathUUID(c *gin.Context, name, label string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid " + label})
		return uuid.Nil, false
	}
	return id, true
}

type apiKeyView struct {
	ID         uuid.UUID  `json:"id"`
	Label      string     `json:"label"`
	KeyPrefix  string     `json:"key_prefix"`
	LastUsedAt *time.Time `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

func apiKeyViewFrom(k db.ApiKey) apiKeyView {
	return apiKeyView{
		ID:         k.ID,
		Label:      k.Label,
		KeyPrefix:  k.KeyPrefix,
		LastUsedAt: tsPtr(k.LastUsedAt),
		RevokedAt:  tsPtr(k.RevokedAt),
		CreatedAt:  k.CreatedAt,
	}
}

type createBusinessRequest struct {
	Name       string `json:"name" binding:"required,max=200"`
	OwnerEmail string `json:"owner_email" binding:"required,email"`
}

func (h *ManageHandler) ListBusinesses(c *gin.Context) {
	status := strPtr(c.Query("status"))
	search := strPtr(c.Query("search"))

	items, err := h.q.ListBusinessesPaged(c.Request.Context(), db.ListBusinessesPagedParams{
		Limit:  getLimit(c),
		Offset: getOffset(c),
		Status: status,
		Search: search,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list businesses"})
		return
	}

	total, err := h.q.CountBusinesses(c.Request.Context(), db.CountBusinessesParams{
		Status: status,
		Search: search,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not count businesses"})
		return
	}

	sendList(c, items, total)
}

func (h *ManageHandler) CreateBusiness(c *gin.Context) {
	var req createBusinessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	business, err := h.q.CreateBusiness(c.Request.Context(), db.CreateBusinessParams{
		Name:       req.Name,
		OwnerEmail: req.OwnerEmail,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create business"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": business})
}

func (h *ManageHandler) GetBusiness(c *gin.Context) {
	businessID, ok := pathUUID(c, "business_id", "business id")
	if !ok {
		return
	}

	business, err := h.q.GetBusiness(c.Request.Context(), businessID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "business not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not get business"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": business})
}

type setBusinessStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=active suspended"`
}

func (h *ManageHandler) SetBusinessStatus(c *gin.Context) {
	businessID, ok := pathUUID(c, "business_id", "business id")
	if !ok {
		return
	}

	var req setBusinessStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	business, err := h.q.SetBusinessStatus(c.Request.Context(), db.SetBusinessStatusParams{
		ID:     businessID,
		Status: req.Status,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "business not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update business status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": business})
}

func (h *ManageHandler) requireBusiness(c *gin.Context, businessID uuid.UUID) (db.Business, bool) {
	business, err := h.q.GetBusiness(c.Request.Context(), businessID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "business not found"})
		return db.Business{}, false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load business"})
		return db.Business{}, false
	}
	return business, true
}

func (h *ManageHandler) ListApiKeys(c *gin.Context) {
	businessID, ok := pathUUID(c, "business_id", "business id")
	if !ok {
		return
	}

	if _, ok := h.requireBusiness(c, businessID); !ok {
		return
	}

	keys, err := h.q.ListApiKeysByBusiness(c.Request.Context(), businessID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not list api keys"})
		return
	}

	items := make([]apiKeyView, 0, len(keys))
	for _, k := range keys {
		items = append(items, apiKeyViewFrom(k))
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

type createApiKeyRequest struct {
	Label string `json:"label" binding:"required,max=100"`
}

func (h *ManageHandler) CreateApiKey(c *gin.Context) {
	businessID, ok := pathUUID(c, "business_id", "business id")
	if !ok {
		return
	}

	if _, ok := h.requireBusiness(c, businessID); !ok {
		return
	}

	var req createApiKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	token, prefix, hash := services.GenerateToken("vpk")

	key, err := h.q.CreateApiKey(c.Request.Context(), db.CreateApiKeyParams{
		BusinessID: businessID,
		Label:      req.Label,
		KeyPrefix:  prefix,
		KeyHash:    hash,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create api key"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"api_key": apiKeyViewFrom(key),
			"token":   token,
		},
	})
}

func (h *ManageHandler) RevokeApiKey(c *gin.Context) {
	keyID, ok := pathUUID(c, "key_id", "key id")
	if !ok {
		return
	}

	existing, err := h.q.GetApiKeyByID(c.Request.Context(), keyID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "api key not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load api key"})
		return
	}

	revoked, err := h.q.RevokeApiKey(c.Request.Context(), db.RevokeApiKeyParams{
		ID:         existing.ID,
		BusinessID: existing.BusinessID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		fresh, ferr := h.q.GetApiKeyByID(c.Request.Context(), existing.ID)
		if ferr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not revoke api key"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": apiKeyViewFrom(fresh)})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not revoke api key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": apiKeyViewFrom(revoked)})
}
