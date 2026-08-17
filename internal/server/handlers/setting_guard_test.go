package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/gin-gonic/gin"
)

func TestSetSettingRejectsTwoFactorAndJWTSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []model.Setting{
		{Key: model.SettingKeyTwoFactorEnabled, Value: "false"},
		{Key: model.SettingKeyJWTSecret, Value: "hijacked"},
	}
	for _, setting := range cases {
		body, _ := json.Marshal(setting)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/setting/set", strings.NewReader(string(body)))
		c.Request.Header.Set("Content-Type", "application/json")
		setSetting(c)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s: status=%d body=%s", setting.Key, recorder.Code, recorder.Body.String())
		}
	}
}

func TestPublicSecurityStatusDoesNotRequireAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/user/login/security", nil)
	publicSecurityStatus(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data model.UserSecurityStatus `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v body=%s", err, recorder.Body.String())
	}
}
