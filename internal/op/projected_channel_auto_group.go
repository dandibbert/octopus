package op

import (
	"context"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/rewrite"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/dlclark/regexp2"
)

func ProjectedChannelGlobalAutoGroupMode() model.AutoGroupType {
	value, err := SettingGetString(model.SettingKeyProjectedChannelAutoGroupEnabled)
	if err != nil {
		return model.AutoGroupTypeNone
	}
	mode, ok := model.ParseAutoGroupSettingValue(value)
	if !ok {
		return model.AutoGroupTypeNone
	}
	return mode
}

func ProjectedChannelGlobalAutoGroupEnabled() bool {
	return ProjectedChannelGlobalAutoGroupMode() != model.AutoGroupTypeNone
}

func EffectiveProjectedChannelAutoGroup(channel model.Channel) model.AutoGroupType {
	if mode := ProjectedChannelGlobalAutoGroupMode(); mode != model.AutoGroupTypeNone {
		return mode
	}
	return channel.AutoGroup
}

type groupModelMatcher func(string) (bool, error)

func newGroupModelMatcher(group model.Group, autoGroup model.AutoGroupType) (groupModelMatcher, error) {
	matchRegex := strings.TrimSpace(group.MatchRegex)
	if matchRegex != "" {
		re, err := regexp2.Compile(matchRegex, regexp2.ECMAScript)
		if err != nil {
			return nil, err
		}
		re.MatchTimeout = 200 * time.Millisecond
		return re.MatchString, nil
	}

	groupName := strings.TrimSpace(group.Name)
	switch autoGroup {
	case model.AutoGroupTypeExact, model.AutoGroupTypeRegex:
		return func(modelName string) (bool, error) {
			return strings.EqualFold(modelName, groupName), nil
		}, nil
	case model.AutoGroupTypeFuzzy:
		groupNameLower := strings.ToLower(groupName)
		return func(modelName string) (bool, error) {
			return groupNameLower != "" && strings.Contains(strings.ToLower(modelName), groupNameLower), nil
		}, nil
	default:
		return func(string) (bool, error) { return false, nil }, nil
	}
}

func ChannelAutoGroupWithMode(channel *model.Channel, autoGroup model.AutoGroupType, ctx context.Context) {
	if channel == nil || autoGroup == model.AutoGroupTypeNone {
		return
	}
	groups, err := GroupList(ctx)
	if err != nil {
		log.Warnf("get group list failed: %v", err)
		return
	}

	channelModelNames := splitChannelModelNames(channel.Model, channel.CustomModel)
	if len(channelModelNames) == 0 {
		return
	}

	for _, group := range groups {
		matchedModelNames := make([]string, 0, len(channelModelNames))
		matcher, err := newGroupModelMatcher(group, autoGroup)
		if err != nil {
			log.Warnf("compile regex failed (channel=%d group=%d regex=%q): %v", channel.ID, group.ID, group.MatchRegex, err)
			continue
		}
		for _, modelName := range channelModelNames {
			matched, err := matcher(modelName)
			if err != nil {
				log.Warnf("match group rule failed (channel=%d group=%d regex=%q model=%q): %v", channel.ID, group.ID, group.MatchRegex, modelName, err)
				continue
			}
			if matched {
				matchedModelNames = append(matchedModelNames, modelName)
			}
		}

		if len(matchedModelNames) == 0 {
			continue
		}
		items := make([]model.GroupIDAndLLMName, 0, len(matchedModelNames))
		for _, modelName := range matchedModelNames {
			items = append(items, model.GroupIDAndLLMName{ChannelID: channel.ID, ModelName: modelName})
		}
		if err := GroupItemBatchAdd(group.ID, items, ctx); err != nil {
			log.Warnf("group item batch add failed (channel=%d group=%d): %v", channel.ID, group.ID, err)
		}
	}
}

func ChannelAutoGroup(channel *model.Channel, ctx context.Context) {
	if channel == nil {
		return
	}
	ChannelAutoGroupWithMode(channel, channel.AutoGroup, ctx)
}

func AutoGroupAllProjectedChannels(ctx context.Context) error {
	mode := ProjectedChannelGlobalAutoGroupMode()
	if mode == model.AutoGroupTypeNone {
		return nil
	}
	channels := channelCache.GetAll()
	if len(channels) == 0 {
		return nil
	}
	channelIDs := make([]int, 0, len(channels))
	for id := range channels {
		channelIDs = append(channelIDs, id)
	}
	bindingMap, err := SiteChannelBindingMapByChannelIDs(channelIDs, ctx)
	if err != nil {
		return err
	}
	for id, channel := range channels {
		if _, ok := bindingMap[id]; !ok {
			continue
		}
		ChannelAutoGroupWithMode(&channel, mode, ctx)
	}
	return nil
}

func splitChannelModelNames(values ...string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			name := strings.TrimSpace(part)
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			result = append(result, name)
		}
	}
	return result
}

func ValidateJSONOverrideObject(value string) error {
	raw := value
	return rewrite.ValidateRawConfigPtr(&raw, rewrite.ScopeChannel)
}
