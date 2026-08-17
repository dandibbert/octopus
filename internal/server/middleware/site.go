package middleware

import (
	"net/http"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/gin-gonic/gin"
)

// RequireSiteEnabled 在站点功能总开关关闭时拦截整组站点路由。
//
// 关闭只切断站点的同步与管理面：已由站点投影出来的渠道仍留在 channels 表里
// 照常参与中继，不会被停用或删除。这样开关是可逆的，不会影响线上流量。
func RequireSiteEnabled() gin.HandlerFunc {
	return func(c *gin.Context) {
		enabled, err := op.SettingGetBool(model.SettingKeySiteEnabled)
		if err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			c.Abort()
			return
		}
		if !enabled {
			resp.Error(c, http.StatusForbidden, "site features are disabled")
			c.Abort()
			return
		}
		c.Next()
	}
}
