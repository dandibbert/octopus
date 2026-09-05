'use client';

import { useIsMobile } from '@/hooks/use-mobile';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Copy, Eraser, RotateCcw, Send, Square, User, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useChannelList } from '@/api/endpoints/channel';
import { useGroupList } from '@/api/endpoints/group';
import {
    createPlaygroundChat,
    readPlaygroundError,
    translatePlaygroundError,
    type PlaygroundMessage,
    type PlaygroundRequest,
} from '@/api/endpoints/playground';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select as RadixSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import { targetFromLocation, usePlaygroundStore, type PlaygroundTarget } from '@/stores/playground';
import { cn, copyText } from '@/lib/utils';

type Diagnostics = {
    ttft?: number;
    total?: number;
    outputRate?: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    requestedGroup?: string;
    requestedChannel?: string;
    requestedModel?: string;
    channel?: string;
    remoteModel?: string;
    actualModel?: string;
    requestId?: string;
};

type ChatMessage = PlaygroundMessage & { id: string; diagnostics?: Diagnostics; error?: string };
type Usage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
};
type StreamChunk = {
    model?: string;
    error?: string | { message?: string; type?: string };
    error_code?: string;
    params?: Record<string, string | number | boolean | null | undefined>;
    message?: string;
    estimated_cost?: number;
    requested_model?: string;
    channel_name?: string;
    remote_model?: string;
    choices?: Array<{ delta?: { content?: string } }>;
    usage?: Usage;
};

class PlaygroundDisplayError extends Error {}

const newID = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2);
const modelsFor = (model: string, custom: string) => Array.from(new Set((model + ',' + custom).split(',').map((item) => item.trim()).filter(Boolean)));
const numericHeader = (value: string | null) => {
    if (value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
const formatEstimatedCost = (cost: number) => Number(cost.toFixed(6)).toString();
const validHistory = (history: ChatMessage[]): PlaygroundMessage[] => history
    .filter((message) => !message.error && message.content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));

function usageDiagnostics(usage: Usage | undefined) {
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
    const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens
        ?? usage?.input_tokens_details?.cached_tokens
        ?? usage?.cache_read_input_tokens;
    return {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: usage?.cache_creation_input_tokens,
    };
}

export function Playground() {
    const isMobile = useIsMobile();
    const t = useTranslations('playground');
    const { data: channelEntries = [] } = useChannelList();
    const channels = useMemo(() => channelEntries.map((entry) => entry.raw), [channelEntries]);
    const { data: groups = [] } = useGroupList();
    const storedTarget = usePlaygroundStore((state) => state.target);
    const setStoredTarget = usePlaygroundStore((state) => state.setTarget);
    const [target, setTarget] = useState<PlaygroundTarget | null>(storedTarget);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [reasoning, setReasoning] = useState<PlaygroundRequest['parameters']['reasoning_effort']>('auto');
    const [temperature, setTemperature] = useState('1');
    const [maxTokens, setMaxTokens] = useState('');
    const [stream, setStream] = useState(true);
    const [running, setRunning] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const pageScrollRef = useRef<HTMLDivElement | null>(null);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    const mobileFollowAnchorRef = useRef<HTMLDivElement | null>(null);
    const draftRef = useRef<HTMLTextAreaElement | null>(null);
    const shouldFollowOutputRef = useRef(true);
    const nextScrollBehaviorRef = useRef<ScrollBehavior>('auto');
    const programmaticScrollUntilRef = useRef(0);

    useEffect(() => {
        const located = targetFromLocation();
        if (located) {
            setTarget(located);
            setStoredTarget(located);
        }
    }, [setStoredTarget]);
    useEffect(() => {
        if (messages.length === 0 || !shouldFollowOutputRef.current) return;
        const behavior = nextScrollBehaviorRef.current;
        nextScrollBehaviorRef.current = 'auto';
        if (behavior === 'smooth') programmaticScrollUntilRef.current = performance.now() + 600;
        const element = messageListRef.current;
        if (!isMobile) {
            element?.scrollTo({ top: element.scrollHeight, behavior });
            return;
        }
        // 移动端只有页面这一层主滚动。锚点放在输入区之后，才能在追随
        // 流式输出时同时保留最后一条消息和停止/发送操作，而不是把输入区
        // 推到视口下方。
        mobileFollowAnchorRef.current?.scrollIntoView({ behavior, block: 'end' });
    }, [messages, isMobile]);

    const mode = target?.type ?? 'group';
    const selectedChannel = target?.type === 'channel_model' ? channels.find((item) => item.id === target.channelId) : undefined;
    const channelModels = selectedChannel ? modelsFor(selectedChannel.model, selectedChannel.custom_model) : [];
    const selectedGroupID = target?.type === 'group'
        ? target.groupId ?? groups.find((group) => group.name === target.group)?.id
        : undefined;
    const updateTarget = (next: PlaygroundTarget) => {
        setTarget(next);
        setStoredTarget(next);
    };
    const requestTarget = useMemo<PlaygroundRequest['target'] | null>(() => {
        if (target?.type === 'group' && (target.groupId || target.group)) {
            return { type: 'group', group_id: target.groupId, group: target.group };
        }
        if (target?.type === 'channel_model' && target.channelId > 0 && target.model) {
            return { type: 'channel_model', channel_id: target.channelId, model: target.model };
        }
        return null;
    }, [target]);
    const temperatureValue = temperature === '' ? undefined : Number(temperature);
    const maxTokensValue = maxTokens === '' ? undefined : Number(maxTokens);
    const temperatureError = temperatureValue !== undefined
        && (!Number.isFinite(temperatureValue) || temperatureValue < 0 || temperatureValue > 2)
        ? t('errors.invalidTemperature')
        : undefined;
    const maxTokensError = maxTokensValue !== undefined
        && (!Number.isInteger(maxTokensValue) || maxTokensValue < 1 || maxTokensValue > 131072)
        ? t('errors.invalidMaxOutputTokens')
        : undefined;
    const parametersInvalid = Boolean(temperatureError || maxTokensError);

    const resizeDraft = (element: HTMLTextAreaElement) => {
        element.style.height = 'auto';
        const nextHeight = Math.min(element.scrollHeight, 144);
        element.style.height = `${Math.max(48, nextHeight)}px`;
        element.style.overflowY = element.scrollHeight > 144 ? 'auto' : 'hidden';
    };

    const resetDraftHeight = () => {
        if (!draftRef.current) return;
        draftRef.current.style.height = '48px';
        draftRef.current.style.overflowY = 'hidden';
    };

    const handleMessageScroll = () => {
        const element = messageListRef.current;
        if (!element || performance.now() < programmaticScrollUntilRef.current) return;
        const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
        shouldFollowOutputRef.current = distanceFromBottom <= 64;
    };

    const handlePageScroll = () => {
        const container = pageScrollRef.current;
        const end = mobileFollowAnchorRef.current;
        if (!container || !end || performance.now() < programmaticScrollUntilRef.current) return;
        const containerRect = container.getBoundingClientRect();
        const endRect = end.getBoundingClientRect();
        shouldFollowOutputRef.current = endRect.bottom <= containerRect.bottom + 64
            && endRect.bottom >= containerRect.top;
    };

    const handleUserScrollIntent = () => {
        programmaticScrollUntilRef.current = 0;
        shouldFollowOutputRef.current = false;
    };

    const run = async (history: ChatMessage[]) => {
        if (!requestTarget) {
            toast.error(t('errors.selectTarget'));
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        const assistantID = newID();
        setMessages([...history, { id: assistantID, role: 'assistant', content: '' }]);
        const started = performance.now();
        let firstTokenAt: number | undefined;
        let content = '';
        let usage: Usage | undefined;
        let actualModel = '';
        let estimatedCost: number | undefined;
        let diagnosticsBase: Diagnostics = {};

        try {
            const response = await createPlaygroundChat({
                target: requestTarget,
                messages: validHistory(history),
                system_prompt: systemPrompt,
                parameters: {
                    reasoning_effort: reasoning,
                    temperature: temperatureValue,
                    max_output_tokens: maxTokensValue,
                    stream,
                },
            }, controller.signal);
            diagnosticsBase = {
                requestedGroup: requestTarget.type === 'group' ? (requestTarget.group || String(requestTarget.group_id ?? '')) : undefined,
                requestedChannel: requestTarget.type === 'channel_model' ? (selectedChannel?.name || String(requestTarget.channel_id)) : undefined,
                requestedModel: requestTarget.type === 'channel_model'
                    ? requestTarget.model
                    : response.headers.get('X-Octopus-Requested-Model') ?? undefined,
                channel: response.headers.get('X-Octopus-Channel-Name') ?? undefined,
                remoteModel: response.headers.get('X-Octopus-Remote-Model') ?? undefined,
                requestId: response.headers.get('X-Octopus-Request-ID') ?? undefined,
                estimatedCost: numericHeader(response.headers.get('X-Octopus-Estimated-Cost')),
            };
            if (!response.ok) {
                throw new PlaygroundDisplayError(await readPlaygroundError(response, t('errors.generationFailed')));
            }

            if (stream && response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const consumeEvent = (event: string) => {
                    const lines = event.split(/\r?\n/);
                    const eventType = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
                    const raw = lines
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trimStart())
                        .join('\n')
                        .trim();
                    if (!raw || raw === '[DONE]') return;

                    let chunk: StreamChunk;
                    try {
                        chunk = JSON.parse(raw) as StreamChunk;
                    } catch {
                        if (eventType === 'error') {
                            throw new PlaygroundDisplayError(translatePlaygroundError(undefined, t('errors.generationFailed')));
                        }
                        throw new PlaygroundDisplayError(t('errors.invalidStream'));
                    }
                    if (chunk.error || chunk.error_code || eventType === 'error') {
                        throw new PlaygroundDisplayError(translatePlaygroundError(chunk, t('errors.streamFailed')));
                    }

                    const delta = chunk.choices?.[0]?.delta?.content ?? '';
                    if (delta && firstTokenAt === undefined) firstTokenAt = performance.now();
                    content += delta;
                    actualModel = chunk.model ?? actualModel;
                    usage = chunk.usage ?? usage;
                    estimatedCost = chunk.estimated_cost ?? estimatedCost;
                    diagnosticsBase = {
                        ...diagnosticsBase,
                        requestedModel: chunk.requested_model ?? diagnosticsBase.requestedModel,
                        channel: chunk.channel_name ?? diagnosticsBase.channel,
                        remoteModel: chunk.remote_model ?? diagnosticsBase.remoteModel,
                    };
                    setMessages((current) => current.map((item) => item.id === assistantID ? { ...item, content } : item));
                };

                while (true) {
                    const result = await reader.read();
                    if (result.done) break;
                    buffer += decoder.decode(result.value, { stream: true });
                    const events = buffer.split(/\r?\n\r?\n/);
                    buffer = events.pop() ?? '';
                    events.forEach(consumeEvent);
                }
                buffer += decoder.decode();
                if (buffer.trim()) consumeEvent(buffer);
            } else {
                const data = await response.json() as StreamChunk & { choices?: Array<{ message?: { content?: string } }> };
                if (data.error || data.error_code) {
                    throw new PlaygroundDisplayError(translatePlaygroundError(data, t('errors.generationFailed')));
                }
                content = data.choices?.[0]?.message?.content ?? '';
                actualModel = data.model ?? '';
                usage = data.usage;
            }

            if (!content.trim()) throw new PlaygroundDisplayError(t('errors.emptyResponse'));
            const completedAt = performance.now();
            const tokenDiagnostics = usageDiagnostics(usage);
            const generationMS = firstTokenAt ? completedAt - firstTokenAt : undefined;
            const diagnostics: Diagnostics = {
                ...diagnosticsBase,
                ...tokenDiagnostics,
                estimatedCost: estimatedCost ?? diagnosticsBase.estimatedCost,
                ttft: firstTokenAt ? firstTokenAt - started : undefined,
                total: completedAt - started,
                outputRate: tokenDiagnostics.outputTokens !== undefined && generationMS && generationMS >= 250
                    ? tokenDiagnostics.outputTokens / (generationMS / 1000)
                    : undefined,
                actualModel,
            };
            setMessages((current) => current.map((item) => item.id === assistantID ? { ...item, content, diagnostics } : item));
        } catch (error) {
            if (controller.signal.aborted) {
                setMessages((current) => content
                    ? current.map((item) => item.id === assistantID ? {
                        ...item,
                        content,
                        diagnostics: { ...diagnosticsBase, total: performance.now() - started, actualModel },
                    } : item)
                    : current.filter((item) => item.id !== assistantID));
            } else {
                const message = error instanceof PlaygroundDisplayError
                    ? error.message
                    : t('errors.generationFailed');
                setMessages((current) => current.map((item) => item.id === assistantID ? {
                    ...item,
                    error: message,
                    content: content || t('errors.generationFailed'),
                    diagnostics: { ...diagnosticsBase, total: performance.now() - started, actualModel },
                } : item));
            }
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const send = () => {
        const text = draft.trim();
        if (!text || running || !requestTarget || parametersInvalid) return;
        shouldFollowOutputRef.current = true;
        nextScrollBehaviorRef.current = 'smooth';
        const next = [...messages, { id: newID(), role: 'user' as const, content: text }];
        setDraft('');
        resetDraftHeight();
        void run(next);
    };
    const regenerate = () => {
        if (running || !requestTarget || parametersInvalid) return;
        const lastAssistant = messages.findLastIndex((message) => message.role === 'assistant');
        const history = lastAssistant === messages.length - 1 ? messages.slice(0, -1) : messages;
        if (history.findLast((message) => !message.error && message.content.trim())?.role === 'user') void run(history);
    };

    return (
        <div
            ref={pageScrollRef}
            onScroll={handlePageScroll}
            onWheel={handleUserScrollIntent}
            onTouchMove={handleUserScrollIntent}
            className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-28 [-webkit-overflow-scrolling:touch] md:grid md:h-full md:grid-cols-[minmax(0,1fr)_18rem] md:overflow-hidden md:pb-6"
        >
            <section className="flex min-h-[30rem] flex-none flex-col overflow-hidden rounded-3xl border bg-card shadow-sm md:h-full md:min-h-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                        <div className="font-semibold">{t('title')}</div>
                        <div className="text-xs text-muted-foreground">{t('subtitle')}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button
                            className="min-h-10 w-10 px-0 sm:w-auto sm:px-3 md:min-h-8"
                            variant="outline"
                            size="sm"
                            aria-label={t('regenerate')}
                            onClick={regenerate}
                            disabled={running || messages.length === 0 || !requestTarget || parametersInvalid}
                        >
                            <RotateCcw className="size-4" />
                            <span className="sr-only sm:not-sr-only">{t('regenerate')}</span>
                        </Button>
                        <Button
                            className="min-h-10 w-10 px-0 sm:w-auto sm:px-3 md:min-h-8"
                            variant="outline"
                            size="sm"
                            aria-label={t('clear')}
                            onClick={() => setMessages([])}
                            disabled={running || messages.length === 0}
                        >
                            <Eraser className="size-4" />
                            <span className="sr-only sm:not-sr-only">{t('clear')}</span>
                        </Button>
                    </div>
                </div>
                <div className="flex-1 p-2 md:min-h-0">
                    <div
                        ref={messageListRef}
                        data-page-scroll
                        onScroll={handleMessageScroll}
                        className="min-h-56 space-y-4 px-2 py-2 pb-10 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain md:[-webkit-overflow-scrolling:touch]"
                    >
                        {messages.length === 0 && <div className="grid h-full min-h-56 place-items-center text-center text-muted-foreground"><div><Bot className="mx-auto mb-3 size-10" /><p>{t('empty')}</p></div></div>}
                        {messages.map((message) => <Message key={message.id} message={message} />)}
                        <div />
                    </div>
                </div>
                <div className="border-t p-3">
                    <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/30">
                        <textarea
                            id="playground-message-input"
                            ref={draftRef}
                            aria-label={t('inputPlaceholder')}
                            aria-invalid={!requestTarget}
                            aria-describedby={!requestTarget ? 'playground-target-error' : undefined}
                            className="min-h-12 max-h-36 flex-1 resize-none overflow-y-hidden bg-transparent px-2 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            value={draft}
                            disabled={!requestTarget}
                            onChange={(event) => {
                                setDraft(event.target.value);
                                resizeDraft(event.currentTarget);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    send();
                                }
                            }}
                            placeholder={t('inputPlaceholder')}
                        />
                        {running
                            ? <Button className="size-10 md:size-9" size="icon" variant="destructive" aria-label={t('stop')} onClick={() => abortRef.current?.abort()}><Square className="size-4" /></Button>
                            : <Button className="size-10 md:size-9" size="icon" aria-label={t('send')} onClick={send} disabled={!draft.trim() || !requestTarget || parametersInvalid}><Send className="size-4" /></Button>}
                    </div>
                    {!requestTarget && <p id="playground-target-error" className="mt-2 text-xs text-destructive" role="alert">{t('errors.selectTarget')}</p>}
                </div>
                <div ref={mobileFollowAnchorRef} className="h-px shrink-0 md:hidden" aria-hidden="true" />
            </section>

            <aside className="min-w-0 flex-none rounded-3xl border bg-card p-2 shadow-sm md:min-h-0 md:overflow-hidden">
                <div className="space-y-4 px-3 py-3 scroll-py-3 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain md:px-2 md:[-webkit-overflow-scrolling:touch]">
                <Setting label={t('settings.mode')} htmlFor="playground-mode">
                    <PlaygroundSelect id="playground-mode" ariaLabel={t('settings.mode')} value={mode} options={[
                        { value: 'group', label: t('settings.group') },
                        { value: 'channel_model', label: t('settings.directChannel') },
                    ]} onChange={(value) => value === 'group'
                        ? updateTarget({ type: 'group', groupId: groups[0]?.id, group: groups[0]?.name })
                        : updateTarget({ type: 'channel_model', channelId: channels[0]?.id ?? 0, model: channels[0] ? modelsFor(channels[0].model, channels[0].custom_model)[0] ?? '' : '' })} />
                </Setting>
                {mode === 'group' ? (
                    <Setting label={t('settings.group')} htmlFor="playground-group">
                        <PlaygroundSelect
                            id="playground-group"
                            ariaLabel={t('settings.group')}
                            value={selectedGroupID ? String(selectedGroupID) : ''}
                            placeholder={t('settings.selectGroup')}
                            options={groups.flatMap((group) => group.id ? [{ value: String(group.id), label: group.name }] : [])}
                            onChange={(value) => {
                                const group = groups.find((item) => item.id === Number(value));
                                if (group) updateTarget({ type: 'group', groupId: group.id, group: group.name });
                            }}
                        />
                    </Setting>
                ) : (
                    <>
                        <Setting label={t('settings.channel')} htmlFor="playground-channel">
                            <PlaygroundSelect
                                id="playground-channel"
                                ariaLabel={t('settings.channel')}
                                value={target?.type === 'channel_model' ? String(target.channelId || '') : ''}
                                placeholder={t('settings.selectChannel')}
                                options={channels.map((channel) => ({ value: String(channel.id), label: channel.name }))}
                                onChange={(value) => {
                                    const channel = channels.find((item) => item.id === Number(value));
                                    if (channel) updateTarget({ type: 'channel_model', channelId: channel.id, model: modelsFor(channel.model, channel.custom_model)[0] ?? '' });
                                }}
                            />
                        </Setting>
                        <Setting label={t('settings.remoteModel')} htmlFor="playground-model">
                            <PlaygroundSelect
                                id="playground-model"
                                ariaLabel={t('settings.remoteModel')}
                                value={target?.type === 'channel_model' ? target.model : ''}
                                placeholder={t('settings.selectModel')}
                                options={channelModels.map((model) => ({ value: model, label: model }))}
                                onChange={(value) => target?.type === 'channel_model' && updateTarget({ ...target, model: value })}
                            />
                        </Setting>
                    </>
                )}
                <div className="h-px bg-border" />
                <Setting label={t('settings.systemPrompt')} htmlFor="playground-system-prompt">
                    <textarea id="playground-system-prompt" className="min-h-24 w-full resize-y rounded-xl border bg-background p-3 text-sm" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder={t('settings.optional')} />
                </Setting>
                <Setting label={t('settings.reasoning')} htmlFor="playground-reasoning">
                    <PlaygroundSelect
                        id="playground-reasoning"
                        ariaLabel={t('settings.reasoning')}
                        value={reasoning}
                        options={(['auto', 'off', 'low', 'medium', 'high', 'xhigh'] as const).map((value) => ({ value, label: t(`reasoning.${value}`) }))}
                        onChange={(value) => setReasoning(value as typeof reasoning)}
                    />
                </Setting>
                <Setting label={t('settings.temperature')} htmlFor="playground-temperature" error={temperatureError} errorId="playground-temperature-error">
                    <Input id="playground-temperature" type="number" min="0" max="2" step="0.1" value={temperature} aria-invalid={Boolean(temperatureError)} aria-describedby={temperatureError ? 'playground-temperature-error' : undefined} onChange={(event) => setTemperature(event.target.value)} />
                </Setting>
                <Setting label={t('settings.maxOutputTokens')} htmlFor="playground-max-output-tokens" error={maxTokensError} errorId="playground-max-output-tokens-error">
                    <Input id="playground-max-output-tokens" type="number" min="1" max="131072" step="1" value={maxTokens} aria-invalid={Boolean(maxTokensError)} aria-describedby={maxTokensError ? 'playground-max-output-tokens-error' : undefined} onChange={(event) => setMaxTokens(event.target.value)} placeholder={t('settings.auto')} />
                </Setting>
                <div className="flex items-center justify-between">
                    <label htmlFor="playground-streaming"><span className="block text-sm font-medium">{t('settings.streaming')}</span><span className="block text-xs text-muted-foreground">{t('settings.streamingHint')}</span></label>
                    <Switch id="playground-streaming" aria-label={t('settings.streaming')} checked={stream} onCheckedChange={setStream} />
                </div>
                </div>
            </aside>
        </div>
    );
}

type PlaygroundSelectOption = { value: string; label: string };

function PlaygroundSelect({
    id,
    ariaLabel,
    value,
    placeholder,
    options,
    onChange,
}: {
    id: string;
    ariaLabel: string;
    value: string;
    placeholder?: string;
    options: PlaygroundSelectOption[];
    onChange: (value: string) => void;
}) {
    return (
        <RadixSelect value={value} onValueChange={onChange}>
            <SelectTrigger
                id={id}
                aria-label={ariaLabel}
                className="h-auto min-h-10 w-full min-w-0 overflow-hidden rounded-xl bg-background py-2 text-left data-[size=default]:h-auto data-[size=sm]:h-auto *:data-[slot=select-value]:line-clamp-2"
            >
                <SelectValue className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-all text-left leading-5" placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent position="popper">
                {options.filter((option) => option.value).map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
            </SelectContent>
        </RadixSelect>
    );
}

function Setting({
    label,
    htmlFor,
    error,
    errorId,
    children,
}: {
    label: string;
    htmlFor: string;
    error?: string;
    errorId?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
            {children}
            {error && <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
    );
}

function Message({ message }: { message: ChatMessage }) {
    const t = useTranslations('playground');
    const copyT = useTranslations('common.copy');
    const assistant = message.role === 'assistant';
    const diagnostics = message.diagnostics;
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const copyMessage = async () => {
        try {
            await copyText(message.content);
            toast.success(copyT('success'));
        } catch {
            toast.error(copyT('failed'));
        }
    };
    return (
        <div className={cn('flex gap-3', !assistant && 'justify-end')}>
            <div className={cn('mt-1 grid size-8 shrink-0 place-items-center rounded-xl', assistant ? 'bg-primary text-primary-foreground' : 'order-2 bg-muted')}>
                {assistant ? <Bot className="size-4" /> : <User className="size-4" />}
            </div>
            <div className={cn('max-w-[85%] space-y-2', !assistant && 'order-1')}>
                <div className={cn('whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6', assistant ? 'border bg-background' : 'bg-primary text-primary-foreground')}>
                    {message.content || (
                        <span className="inline-flex items-center gap-1" role="status" aria-label={t('settings.streamingHint')}>
                            <span className="sr-only">{t('settings.streamingHint')}</span>
                            <span aria-hidden="true" className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: '-0.3s' }} />
                            <span aria-hidden="true" className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: '-0.15s' }} />
                            <span aria-hidden="true" className="size-1.5 animate-bounce rounded-full bg-current" />
                        </span>
                    )}
                </div>
                {message.error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{message.error}</div>}
                {assistant && message.content && (
                    <div className="space-y-2">
                        <div className="flex min-h-10 items-center gap-1 md:min-h-8">
                            <Button className="min-h-10 px-2.5 md:min-h-8" variant="ghost" size="sm" onClick={() => void copyMessage()}>
                                <Copy className="size-3.5" />
                                {t('copy')}
                            </Button>
                            {diagnostics && (
                                <Button
                                    type="button"
                                    className="min-h-10 px-2.5 md:min-h-8"
                                    variant="ghost"
                                    size="sm"
                                    aria-expanded={diagnosticsOpen}
                                    onClick={() => setDiagnosticsOpen((open) => !open)}
                                >
                                    <Wrench className="size-3.5" />
                                    {t('diagnostics.title')}
                                    <ChevronDown className={cn('size-3.5 transition-transform', diagnosticsOpen && 'rotate-180')} />
                                </Button>
                            )}
                        </div>
                        {diagnostics && diagnosticsOpen && (
                            <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-5 gap-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                                    {diagnostics.ttft !== undefined && <><span>TTFT</span><span>{Math.round(diagnostics.ttft)} ms</span></>}
                                    {diagnostics.total !== undefined && <><span>{t('diagnostics.total')}</span><span>{(diagnostics.total / 1000).toFixed(2)} s</span></>}
                                    {diagnostics.outputRate !== undefined && <><span>{t('diagnostics.outputRate')}</span><span>{diagnostics.outputRate > 1000 ? '>1000 tok/s' : `${diagnostics.outputRate.toFixed(1)} tok/s`}</span></>}
                                    {diagnostics.inputTokens !== undefined && <><span>{t('diagnostics.inputTokens')}</span><span>{diagnostics.inputTokens}</span></>}
                                    {diagnostics.outputTokens !== undefined && <><span>{t('diagnostics.outputTokens')}</span><span>{diagnostics.outputTokens}</span></>}
                                    {diagnostics.estimatedCost !== undefined && <><span>{t('diagnostics.estimatedCost')}</span><span>${formatEstimatedCost(diagnostics.estimatedCost)}</span></>}
                                    {diagnostics.cacheReadTokens !== undefined && <><span>{t('diagnostics.cacheReadTokens')}</span><span>{diagnostics.cacheReadTokens}</span></>}
                                    {diagnostics.cacheWriteTokens !== undefined && <><span>{t('diagnostics.cacheWriteTokens')}</span><span>{diagnostics.cacheWriteTokens}</span></>}
                                    {diagnostics.requestedGroup && <><span>{t('diagnostics.requestedGroup')}</span><span className="break-all">{diagnostics.requestedGroup}</span></>}
                                    {diagnostics.requestedChannel && <><span>{t('diagnostics.requestedChannel')}</span><span className="break-all">{diagnostics.requestedChannel}</span></>}
                                    {diagnostics.requestedModel && <><span>{t('diagnostics.requestedModel')}</span><span className="break-all">{diagnostics.requestedModel}</span></>}
                                    {diagnostics.channel && <><span>{t('diagnostics.actualChannel')}</span><span className="break-all">{diagnostics.channel}</span></>}
                                    {diagnostics.remoteModel && <><span>{t('diagnostics.remoteModel')}</span><span className="break-all">{diagnostics.remoteModel}</span></>}
                                    {diagnostics.actualModel && <><span>{t('diagnostics.actualModel')}</span><span className="break-all">{diagnostics.actualModel}</span></>}
                                    {diagnostics.requestId && <><span>{t('diagnostics.requestId')}</span><span className="break-all font-mono">{diagnostics.requestId}</span></>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
