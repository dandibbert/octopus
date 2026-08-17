package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/bestruirui/octopus/internal/apperror"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/dlclark/regexp2"
	"github.com/gin-gonic/gin"
)

func validateGroupParamOverride(raw *string) error {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(*raw), &value); err != nil {
		return fmt.Errorf("param_override must be a valid JSON object")
	}
	return nil
}

func init() {
	router.NewGroupRouter("/api/v1/group").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(getGroupList),
		).
		AddRoute(
			router.NewRoute("/create", http.MethodPost).
				Handle(createGroup),
		).
		AddRoute(
			router.NewRoute("/update", http.MethodPost).
				Handle(updateGroup),
		).
		AddRoute(
			router.NewRoute("/delete/:id", http.MethodDelete).
				Handle(deleteGroup),
		)
}

func getGroupList(c *gin.Context) {
	groups, err := op.GroupList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, groups)
}

func createGroup(c *gin.Context) {
	var group model.Group
	if err := c.ShouldBindJSON(&group); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if group.MatchRegex != "" {
		_, err := regexp2.Compile(group.MatchRegex, regexp2.ECMAScript)
		if err != nil {
			resp.ErrorWithAppError(c, http.StatusBadRequest, apperror.New(apperror.CodeCommonValidationFailed, err.Error()).WithStatus(http.StatusBadRequest))
			return
		}
	}
	if err := validateGroupParamOverride(group.ParamOverride); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.GroupCreate(&group, c.Request.Context()); err != nil {
		if errors.Is(err, op.ErrInvalidGroupBilling) {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		resp.ErrorWithAppError(c, http.StatusInternalServerError, groupError(codeGroupCreateFailed, "group create failed", err))
		return
	}
	resp.Success(c, group)
}

func updateGroup(c *gin.Context) {
	var req model.GroupUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if req.MatchRegex != nil {
		_, err := regexp2.Compile(*req.MatchRegex, regexp2.ECMAScript)
		if err != nil {
			resp.ErrorWithAppError(c, http.StatusBadRequest, apperror.New(apperror.CodeCommonValidationFailed, err.Error()).WithStatus(http.StatusBadRequest))
			return
		}
	}
	if err := validateGroupParamOverride(req.ParamOverride); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	group, err := op.GroupUpdate(&req, c.Request.Context())
	if err != nil {
		if errors.Is(err, op.ErrInvalidGroupBilling) {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		resp.ErrorWithAppError(c, http.StatusInternalServerError, groupError(codeGroupUpdateFailed, "group update failed", err))
		return
	}
	resp.Success(c, group)
}

func deleteGroup(c *gin.Context) {
	id := c.Param("id")
	idNum, err := strconv.Atoi(id)
	if err != nil {
		resp.InvalidParam(c)
		return
	}
	if err := op.GroupDel(idNum, c.Request.Context()); err != nil {
		resp.ErrorWithAppError(c, http.StatusInternalServerError, groupError(codeGroupDeleteFailed, "group delete failed", err))
		return
	}
	resp.Success(c, "group deleted successfully")
}
