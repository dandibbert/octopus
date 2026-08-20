package rewrite

const (
	MaxConfigBytes    = 256 * 1024
	MaxOperations     = 128
	MaxConditionNodes = 128
	MaxConditionDepth = 8
	MaxPathBytes      = 1024
	MaxTemplateBytes  = 8 * 1024
	MaxRegexBytes     = 2 * 1024
	MaxGeneratedValue = 1 * 1024 * 1024
	MaxTraceEntries   = 256
	MaxPlanCache      = 1024
)
