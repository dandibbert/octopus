import type { RewriteScope } from '@/api/endpoints/rewrite';
import type { RewriteConfig } from './schema';

export type BuiltinTemplateCategory = 'policy' | 'compatibility' | 'provider' | 'advanced';
export type BuiltinTemplateRisk = 'low' | 'medium' | 'high';
export type BuiltinTargetFormat = 'openai_chat' | 'openai_responses' | 'anthropic_messages' | 'gemini';

export type BuiltinRewriteTemplate = {
    key: string;
    nameKey:
        | 'builtinTemplateKimiTemperatureName'
        | 'builtinTemplateDefaultOutputLimitName'
        | 'builtinTemplateEnsureWebSearchName'
        | 'builtinTemplateRemoveStreamOptionsName'
        | 'builtinTemplateRemoveServiceTierName'
        | 'builtinTemplateReasoningCompatibilityName'
        | 'builtinTemplateOpenRouterHeadersName';
    descriptionKey:
        | 'builtinTemplateKimiTemperatureDescription'
        | 'builtinTemplateDefaultOutputLimitDescription'
        | 'builtinTemplateEnsureWebSearchDescription'
        | 'builtinTemplateRemoveStreamOptionsDescription'
        | 'builtinTemplateRemoveServiceTierDescription'
        | 'builtinTemplateReasoningCompatibilityDescription'
        | 'builtinTemplateOpenRouterHeadersDescription';
    category: BuiltinTemplateCategory;
    risk: BuiltinTemplateRisk;
    scopes: RewriteScope[];
    targetFormats: BuiltinTargetFormat[];
    providerHint?: string;
    requiresEdit?: boolean;
    config: RewriteConfig;
};

export type UneditedBuiltinPlaceholder = {
    operationId: string;
    header: string;
};

export const BUILTIN_REWRITE_TEMPLATES: BuiltinRewriteTemplate[];
export function builtinTemplatesForScope(scope: RewriteScope): BuiltinRewriteTemplate[];
export function findUneditedBuiltinPlaceholder(config: RewriteConfig): UneditedBuiltinPlaceholder | null;
