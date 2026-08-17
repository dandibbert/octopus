package handlers

import (
	"net/http"

	"github.com/bestruirui/octopus/internal/relay/balancer"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/circuit").
		Use(middleware.Auth()).
		AddRoute(router.NewRoute("/status", http.MethodGet).Handle(circuitStatus)).
		AddRoute(router.NewRoute("/reset", http.MethodPost).Handle(circuitReset))
}

func circuitStatus(c *gin.Context) {
	resp.Success(c, balancer.ListTripped())
}

func circuitReset(c *gin.Context) {
	balancer.ResetAll()
	resp.Success(c, nil)
}
