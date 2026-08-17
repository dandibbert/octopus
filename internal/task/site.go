package task

import (
	"context"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/site"
	"github.com/bestruirui/octopus/internal/utils/log"
)

// siteFeatureEnabled 读取站点功能总开关。任务始终注册，运行时读取，
// 因此开关切换无需重启即可生效。
func siteFeatureEnabled() bool {
	enabled, err := op.SettingGetBool(model.SettingKeySiteEnabled)
	return err == nil && enabled
}

func SiteSyncTask() {
	if !siteFeatureEnabled() {
		return
	}
	log.Debugf("site sync task started")
	startTime := time.Now()
	defer func() {
		log.Debugf("site sync task finished, update time: %s", time.Since(startTime))
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()
	site.SyncAll(ctx)
}

func SiteCheckinTask() {
	if !siteFeatureEnabled() {
		return
	}
	log.Debugf("site checkin task started")
	startTime := time.Now()
	defer func() {
		log.Debugf("site checkin task finished, update time: %s", time.Since(startTime))
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()
	site.CheckinAll(ctx)
}
