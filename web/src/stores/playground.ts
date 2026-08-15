import { create } from 'zustand';
import { useNavStore } from '@/components/modules/navbar';

export type PlaygroundTarget =
    | { type: 'group'; groupId?: number; group?: string }
    | { type: 'channel_model'; channelId: number; model: string };

interface PlaygroundState {
    target: PlaygroundTarget | null;
    setTarget: (target: PlaygroundTarget | null) => void;
}

export const usePlaygroundStore = create<PlaygroundState>((set) => ({
    target: null,
    setTarget: (target) => set({ target }),
}));

export function openPlayground(target?: PlaygroundTarget) {
    usePlaygroundStore.getState().setTarget(target ?? null);
    const nav = useNavStore.getState();
    if (nav.activeItem !== 'playground') nav.setActiveItem('playground');
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = '';
    if (target?.type === 'group') {
        url.searchParams.set('mode', 'group');
        if (target.groupId) url.searchParams.set('group_id', String(target.groupId));
        if (target.group) url.searchParams.set('group', target.group);
    } else if (target?.type === 'channel_model') {
        url.searchParams.set('mode', 'channel');
        url.searchParams.set('channel_id', String(target.channelId));
        url.searchParams.set('model', target.model);
    }
    window.history.replaceState(null, '', url);
}

export function targetFromLocation(): PlaygroundTarget | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'channel') {
        const channelId = Number(params.get('channel_id'));
        const model = params.get('model') ?? '';
        if (channelId > 0 && model) return { type: 'channel_model', channelId, model };
    }
    if (params.get('mode') === 'group') {
        const groupId = Number(params.get('group_id'));
        const group = params.get('group') ?? undefined;
        if (groupId > 0 || group) return { type: 'group', groupId: groupId || undefined, group };
    }
    return null;
}
