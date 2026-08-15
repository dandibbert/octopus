package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/price"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/model/alias").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(router.NewRoute("/list", http.MethodGet).Handle(listModelAliases)).
		AddRoute(router.NewRoute("/create", http.MethodPost).Handle(createModelAlias)).
		AddRoute(router.NewRoute("/attach", http.MethodPost).Handle(attachModelAlias)).
		AddRoute(router.NewRoute("/update", http.MethodPost).Handle(updateModelAlias)).
		AddRoute(router.NewRoute("/delete/:id", http.MethodDelete).Handle(deleteModelAlias))
}

func attachModelAlias(c *gin.Context) {
	var req model.ModelAliasAttachRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	result, err := price.AttachModelAlias(c.Request.Context(), req)
	if err != nil {
		var attachErr *price.ModelAliasAttachError
		if errors.As(err, &attachErr) {
			status := http.StatusBadRequest
			if attachErr.Code == price.ModelAliasAttachCodeSourcePriceConflict || attachErr.Code == price.ModelAliasAttachCodeAliasConflict {
				status = http.StatusConflict
			}
			resp.ErrorWithCode(c, status, attachErr.Code, attachErr.Error())
			return
		}
		resp.InternalError(c)
		return
	}
	resp.Success(c, result)
}

func listModelAliases(c *gin.Context) {
	aliases, err := op.ModelAliasList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, aliases)
}

func createModelAlias(c *gin.Context) {
	var alias model.ModelAlias
	if err := c.ShouldBindJSON(&alias); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if err := op.ModelAliasCreate(&alias, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, alias)
}

func updateModelAlias(c *gin.Context) {
	var alias model.ModelAlias
	if err := c.ShouldBindJSON(&alias); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if err := op.ModelAliasUpdate(&alias, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, alias)
}

func deleteModelAlias(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		resp.InvalidParam(c)
		return
	}
	if err := op.ModelAliasDelete(id, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, nil)
}
