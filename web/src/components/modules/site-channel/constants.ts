import type { SiteModelRouteSource, SiteModelRouteType } from '@/api/endpoints/site-channel';
import { ChannelType } from '@/api/endpoints/channel';

export const SITE_ROUTE_COLUMN_ORDER: SiteModelRouteType[] = [
    'openai_chat',
    'openai_response',
    'anthropic',
    'gemini',
    'volcengine',
    'openai_embedding',
];

export const SITE_ROUTE_DISPLAY_ORDER: SiteModelRouteType[] = [
    ...SITE_ROUTE_COLUMN_ORDER,
    'unknown',
];

export const SITE_ROUTE_TO_CHANNEL_TYPE: Record<Exclude<SiteModelRouteType, 'unknown'>, ChannelType> = {
    openai_chat: ChannelType.OpenAIChat,
    openai_response: ChannelType.OpenAIResponse,
    anthropic: ChannelType.Anthropic,
    gemini: ChannelType.Gemini,
    volcengine: ChannelType.Volcengine,
    openai_embedding: ChannelType.OpenAIEmbedding,
};

export const ROUTE_COLUMN_KEY_PREFIX = 'site-route-column';

export function getRouteTypeTone(routeType: SiteModelRouteType) {
    switch (routeType) {
        case 'unknown':
            return 'border-warning/30 bg-warning/10 text-warning';
        case 'anthropic':
            return 'border-warning/30 bg-warning/10 text-warning';
        case 'gemini':
            return 'border-success/30 bg-success/10 text-success';
        case 'volcengine':
            return 'border-info/30 bg-info/10 text-info';
        case 'openai_embedding':
            return 'border-border bg-muted/40 text-muted-foreground';
        case 'openai_response':
            return 'border-info/30 bg-info/10 text-info';
        default:
            return 'border-primary/20 bg-primary/10 text-primary';
    }
}

export function isSupportedRouteType(routeType: SiteModelRouteType): routeType is Exclude<SiteModelRouteType, 'unknown'> {
    return routeType !== 'unknown';
}

export function getRouteSourceTone(routeSource: SiteModelRouteSource) {
    switch (routeSource) {
        case 'manual_override':
            return 'border-primary/30 bg-primary/10 text-primary';
        case 'runtime_learned':
            return 'border-info/30 bg-info/10 text-info';
        case 'default_assigned':
            return 'border-warning/30 bg-warning/10 text-warning';
        default:
            return 'border-border bg-muted/40 text-muted-foreground';
    }
}
