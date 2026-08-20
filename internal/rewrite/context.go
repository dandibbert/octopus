package rewrite

import (
	"fmt"
	"strconv"
	"strings"
)

type Context struct {
	RequestOriginalModel   string
	RequestNormalizedModel string
	RequestPath            string
	RequestMethod          string
	RequestSource          string
	RequestStream          bool
	RequestReasoningEffort string
	RequestMetadata        map[string]string

	RouteRoutedModel                 string
	RouteTransportModelBeforeRewrite string
	RouteInboundFormat               string
	RouteOutboundFormat              string
	RouteChannelID                   int
	RouteChannelName                 string
	RouteChannelType                 string
	RouteGroupID                     int
	RouteGroupName                   string

	RetryIndex           int
	RetryIsRetry         bool
	RetryLastErrorStatus int
	RetryLastErrorCode   string
	RetryLastErrorType   string

	AuthUserID    int
	AuthUserGroup string
	AuthAPIKeyID  int

	FlagsIsChannelTest bool
	FlagsIsHealthCheck bool
	FlagsIsPlayground  bool
}

func (c Context) Lookup(path string) (OptionalRawValue, bool, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return OptionalRawValue{}, false, fmt.Errorf("empty context path")
	}
	if strings.HasPrefix(path, "request.metadata.") {
		key := strings.TrimPrefix(path, "request.metadata.")
		if c.RequestMetadata == nil {
			return OptionalRawValue{}, false, nil
		}
		val, ok := c.RequestMetadata[key]
		if !ok {
			return OptionalRawValue{}, false, nil
		}
		return stringValue(val), true, nil
	}
	switch path {
	case "request.original_model":
		return stringValue(c.RequestOriginalModel), c.RequestOriginalModel != "", nil
	case "request.normalized_model":
		return stringValue(c.RequestNormalizedModel), c.RequestNormalizedModel != "", nil
	case "request.path":
		return stringValue(c.RequestPath), c.RequestPath != "", nil
	case "request.method":
		return stringValue(c.RequestMethod), c.RequestMethod != "", nil
	case "request.source":
		return stringValue(c.RequestSource), c.RequestSource != "", nil
	case "request.stream":
		v, err := rawFromLiteral(c.RequestStream)
		return v, true, err
	case "request.reasoning_effort":
		return stringValue(c.RequestReasoningEffort), c.RequestReasoningEffort != "", nil
	case "route.routed_model":
		return stringValue(c.RouteRoutedModel), c.RouteRoutedModel != "", nil
	case "route.transport_model_before_rewrite":
		return stringValue(c.RouteTransportModelBeforeRewrite), c.RouteTransportModelBeforeRewrite != "", nil
	case "route.inbound_format":
		return stringValue(c.RouteInboundFormat), c.RouteInboundFormat != "", nil
	case "route.outbound_format":
		return stringValue(c.RouteOutboundFormat), c.RouteOutboundFormat != "", nil
	case "route.channel_id":
		v, err := rawFromLiteral(c.RouteChannelID)
		return v, c.RouteChannelID != 0, err
	case "route.channel_name":
		return stringValue(c.RouteChannelName), c.RouteChannelName != "", nil
	case "route.channel_type":
		return stringValue(c.RouteChannelType), c.RouteChannelType != "", nil
	case "route.group_id":
		v, err := rawFromLiteral(c.RouteGroupID)
		return v, c.RouteGroupID != 0, err
	case "route.group_name":
		return stringValue(c.RouteGroupName), c.RouteGroupName != "", nil
	case "retry.index":
		v, err := rawFromLiteral(c.RetryIndex)
		return v, true, err
	case "retry.is_retry":
		v, err := rawFromLiteral(c.RetryIsRetry)
		return v, true, err
	case "retry.last_error.status":
		v, err := rawFromLiteral(c.RetryLastErrorStatus)
		return v, c.RetryLastErrorStatus != 0, err
	case "retry.last_error.code":
		return stringValue(c.RetryLastErrorCode), c.RetryLastErrorCode != "", nil
	case "retry.last_error.type":
		return stringValue(c.RetryLastErrorType), c.RetryLastErrorType != "", nil
	case "auth.user_id":
		v, err := rawFromLiteral(c.AuthUserID)
		return v, c.AuthUserID != 0, err
	case "auth.user_group":
		return stringValue(c.AuthUserGroup), c.AuthUserGroup != "", nil
	case "auth.api_key_id":
		v, err := rawFromLiteral(c.AuthAPIKeyID)
		return v, c.AuthAPIKeyID != 0, err
	case "flags.is_channel_test":
		v, err := rawFromLiteral(c.FlagsIsChannelTest)
		return v, true, err
	case "flags.is_health_check":
		v, err := rawFromLiteral(c.FlagsIsHealthCheck)
		return v, true, err
	case "flags.is_playground":
		v, err := rawFromLiteral(c.FlagsIsPlayground)
		return v, true, err
	default:
		return OptionalRawValue{}, false, fmt.Errorf("unsupported context path %q", path)
	}
}

func stringValue(s string) OptionalRawValue {
	v, _ := rawFromLiteral(s)
	return v
}

func outboundFormatName(channelType int) string {
	switch channelType {
	case 0:
		return "openai_chat"
	case 1:
		return "openai_responses"
	case 2:
		return "anthropic_messages"
	case 3:
		return "gemini"
	case 4:
		return "volcengine"
	case 5:
		return "openai_embedding"
	default:
		return strconv.Itoa(channelType)
	}
}
