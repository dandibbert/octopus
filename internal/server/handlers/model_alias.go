package handlers

import (
	"net/http"
	"strconv"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
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
		AddRoute(router.NewRoute("/update", http.MethodPost).Handle(updateModelAlias)).
		AddRoute(router.NewRoute("/delete/:id", http.MethodDelete).Handle(deleteModelAlias))
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
