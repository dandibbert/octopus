package helper

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/bestruirui/octopus/internal/client"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/utils/log"
)

// MergeCustomHeaders merges header rules left-to-right, case-insensitively.
// Later scopes replace earlier rules while preserving the later key spelling.
func MergeCustomHeaders(scopes ...[]model.CustomHeader) []model.CustomHeader {
	merged := make([]model.CustomHeader, 0)
	indexByKey := make(map[string]int)
	for _, scope := range scopes {
		for _, header := range scope {
			key := strings.TrimSpace(header.HeaderKey)
			if key == "" {
				continue
			}
			header.HeaderKey = key
			normalized := strings.ToLower(key)
			if index, ok := indexByKey[normalized]; ok {
				merged[index] = header
				continue
			}
			indexByKey[normalized] = len(merged)
			merged = append(merged, header)
		}
	}
	return merged
}

// ApplyCustomHeaders applies set/delete header rules after protocol authentication
// has been configured. Empty string is a valid set value; Delete=true removes the
// header entirely, which is intentionally distinct from setting it to an empty value.
func ApplyCustomHeaders(headers http.Header, customHeaders []model.CustomHeader) {
	if headers == nil {
		return
	}
	for _, header := range customHeaders {
		key := strings.TrimSpace(header.HeaderKey)
		if key == "" {
			continue
		}
		if header.Delete {
			headers.Del(key)
			continue
		}
		headers.Set(key, header.HeaderValue)
	}
}

func ChannelHttpClient(channel *model.Channel) (*http.Client, error) {
	return ChannelHTTPClientWithContext(context.Background(), channel)
}

func ChannelHTTPClientWithContext(ctx context.Context, channel *model.Channel) (*http.Client, error) {
	if channel == nil {
		return nil, errors.New("channel is nil")
	}
	switch channel.ProxyMode {
	case "", model.ProxyUsageModeDirect:
		return client.GetHTTPClientSystemProxy(false)
	case model.ProxyUsageModeSystem:
		return client.GetHTTPClientSystemProxy(true)
	case model.ProxyUsageModePool:
		if channel.ProxyConfigID == nil || *channel.ProxyConfigID <= 0 {
			return nil, fmt.Errorf("proxy config id is required when proxy mode is pool")
		}
		proxyURL, err := op.ProxyURLForConfig(*channel.ProxyConfigID, ctx)
		if err != nil {
			return nil, err
		}
		return client.GetHTTPClientCustomProxy(proxyURL)
	default:
		return nil, fmt.Errorf("unsupported proxy mode: %s", channel.ProxyMode)
	}
}

func ChannelBaseUrlDelayUpdate(channel *model.Channel, ctx context.Context) {
	if channel == nil {
		return
	}
	newBaseUrls := make([]model.BaseUrl, 0, len(channel.BaseUrls))
	for _, baseUrl := range channel.BaseUrls {
		if baseUrl.URL == "" {
			continue
		}
		httpClient, err := ChannelHTTPClientWithContext(ctx, channel)
		if err != nil {
			log.Warnf("failed to get http client (channel=%d): %v", channel.ID, err)
			continue
		}
		delay, err := GetUrlDelay(httpClient, baseUrl.URL, ctx)
		if err != nil {
			log.Warnf("failed to get url delay (channel=%d): %v", channel.ID, err)
			continue
		}
		newBaseUrls = append(newBaseUrls, model.BaseUrl{
			URL:   baseUrl.URL,
			Delay: delay,
		})
	}
	if len(newBaseUrls) > 0 {
		op.ChannelBaseUrlUpdate(channel.ID, newBaseUrls)
	}
}

func ChannelAutoGroup(channel *model.Channel, ctx context.Context) {
	op.ChannelAutoGroup(channel, ctx)
}
