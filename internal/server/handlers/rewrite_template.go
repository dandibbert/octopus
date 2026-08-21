package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/rewrite/template").
		Use(middleware.Auth()).
		AddRoute(router.NewRoute("/list", http.MethodGet).Handle(listRewriteTemplates)).
		AddRoute(router.NewRoute("/create", http.MethodPost).Handle(createRewriteTemplate)).
		AddRoute(router.NewRoute("/update", http.MethodPost).Handle(updateRewriteTemplate)).
		AddRoute(router.NewRoute("/delete/:id", http.MethodDelete).Handle(deleteRewriteTemplate))
}

func listRewriteTemplates(c *gin.Context) {
	templates, err := op.RewriteTemplateList(c.Query("scope"), c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, templates)
}

func createRewriteTemplate(c *gin.Context) {
	var tpl model.RewriteTemplate
	if err := c.ShouldBindJSON(&tpl); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if err := op.RewriteTemplateCreate(&tpl, c.Request.Context()); err != nil {
		writeRewriteTemplateMutationError(c, err)
		return
	}
	resp.Success(c, tpl)
}

func updateRewriteTemplate(c *gin.Context) {
	var tpl model.RewriteTemplate
	if err := c.ShouldBindJSON(&tpl); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if err := op.RewriteTemplateUpdate(&tpl, c.Request.Context()); err != nil {
		writeRewriteTemplateMutationError(c, err)
		return
	}
	resp.Success(c, tpl)
}

func deleteRewriteTemplate(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		resp.InvalidParam(c)
		return
	}
	if err := op.RewriteTemplateDelete(id, c.Request.Context()); err != nil {
		writeRewriteTemplateMutationError(c, err)
		return
	}
	resp.Success(c, nil)
}

func writeRewriteTemplateMutationError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, op.ErrRewriteTemplateNotFound):
		status = http.StatusNotFound
	case errors.Is(err, op.ErrRewriteTemplateConflict):
		status = http.StatusConflict
	case strings.Contains(strings.ToLower(err.Error()), "database"):
		status = http.StatusInternalServerError
	}
	resp.Error(c, status, err.Error())
}
