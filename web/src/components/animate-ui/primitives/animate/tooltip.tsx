'use client';

import * as React from 'react';
import {
  motion,
  AnimatePresence,
  LayoutGroup,
  type Transition,
  type HTMLMotionProps,
} from 'motion/react';
import {
  useFloating,
  offset as floatingOffset,
  flip,
  shift,
  arrow as floatingArrow,
  FloatingPortal,
  FloatingArrow,
  type UseFloatingReturn,
} from '@floating-ui/react';

import { getStrictContext } from '@/lib/get-strict-context';
import { Slot, type WithAsChild } from '@/components/animate-ui/primitives/animate/slot';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

type TooltipData = {
  contentProps: HTMLMotionProps<'div'>;
  contentAsChild: boolean;
  rect: DOMRect;
  element: HTMLElement;
  openDelay?: number;
  side: Side;
  sideOffset: number;
  align: Align;
  alignOffset: number;
  id: string;
};

type GlobalTooltipContextType = {
  showTooltip: (data: TooltipData) => void;
  hideTooltip: () => void;
  hideImmediate: (id?: string) => void;
  currentTooltip: TooltipData | null;
  transition: Transition;
  globalId: string;
};

const [GlobalTooltipProvider, useGlobalTooltip] =
  getStrictContext<GlobalTooltipContextType>('GlobalTooltipProvider');

type TooltipContextType = {
  props: HTMLMotionProps<'div'>;
  setProps: React.Dispatch<React.SetStateAction<HTMLMotionProps<'div'>>>;
  asChild: boolean;
  setAsChild: React.Dispatch<React.SetStateAction<boolean>>;
  side: Side;
  sideOffset: number;
  align: Align;
  alignOffset: number;
  openDelay?: number;
  id: string;
};

const [LocalTooltipProvider, useTooltip] = getStrictContext<TooltipContextType>(
  'LocalTooltipProvider',
);

type TooltipPosition = { x: number; y: number };

function getResolvedSide(placement: Side | `${Side}-${Align}`) {
  if (placement.includes('-')) {
    return placement.split('-')[0] as Side;
  }
  return placement as Side;
}

function initialFromSide(side: Side): Partial<Record<'x' | 'y', number>> {
  if (side === 'top') return { y: 15 };
  if (side === 'bottom') return { y: -15 };
  if (side === 'left') return { x: 15 };
  return { x: -15 };
}


type TooltipProviderProps = {
  children: React.ReactNode;
  id?: string;
  openDelay?: number;
  closeDelay?: number;
  transition?: Transition;
};

function TooltipProvider({
  children,
  id,
  openDelay = 700,
  closeDelay = 300,
  transition = { type: 'spring', stiffness: 300, damping: 35 },
}: TooltipProviderProps) {
  const globalId = React.useId();
  const [currentTooltip, setCurrentTooltip] =
    React.useState<TooltipData | null>(null);
  const timeoutRef = React.useRef<number | null>(null);
  const activeIdRef = React.useRef<string | null>(null);

  const showTooltip = React.useCallback(
    (data: TooltipData) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      activeIdRef.current = data.id;
      setCurrentTooltip(null);
      // Every trigger requires an intentional hover, including after scrolling.
      timeoutRef.current = window.setTimeout(
        () => {
          if (data.element.isConnected) setCurrentTooltip({ ...data, rect: data.element.getBoundingClientRect() });
        },
        data.openDelay ?? openDelay,
      );
    },
    [openDelay],
  );

  const hideTooltip = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setCurrentTooltip(null);
      activeIdRef.current = null;
    }, closeDelay);
  }, [closeDelay]);

  const hideImmediate = React.useCallback((id?: string) => {
    if (id && activeIdRef.current !== id) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    activeIdRef.current = null;
    setCurrentTooltip(null);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideImmediate();
    };
    window.addEventListener('keydown', onKeyDown, true);
    const dismiss = () => hideImmediate();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', dismiss, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', dismiss, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [hideImmediate]);

  return (
    <GlobalTooltipProvider
      value={{
        showTooltip,
        hideTooltip,
        hideImmediate,
        currentTooltip,
        transition,
        globalId: id ?? globalId,
      }}
    >
      <LayoutGroup>{children}</LayoutGroup>
      <TooltipOverlay />
    </GlobalTooltipProvider>
  );
}

type RenderedTooltipContextType = {
  side: Side;
  align: Align;
  open: boolean;
};

const [RenderedTooltipProvider, useRenderedTooltip] =
  getStrictContext<RenderedTooltipContextType>('RenderedTooltipContext');

type FloatingContextType = {
  context: UseFloatingReturn['context'];
  arrowRef: React.RefObject<SVGSVGElement | null>;
};

const [FloatingProvider, useFloatingContext] =
  getStrictContext<FloatingContextType>('FloatingContext');

const MotionTooltipArrow = motion.create(FloatingArrow);

type TooltipArrowProps = Omit<
  React.ComponentProps<typeof MotionTooltipArrow>,
  'context'
> & {
  withTransition?: boolean;
};

function TooltipArrow({
  ref,
  withTransition = true,
  ...props
}: TooltipArrowProps) {
  const { side, align, open } = useRenderedTooltip();
  const { context, arrowRef } = useFloatingContext();
  const { transition, globalId } = useGlobalTooltip();
  React.useImperativeHandle(ref, () => arrowRef.current as SVGSVGElement);

  const deg = { top: 0, right: 90, bottom: 180, left: -90 }[side];

  return (
    <MotionTooltipArrow
      ref={arrowRef}
      context={context}
      data-state={open ? 'open' : 'closed'}
      data-side={side}
      data-align={align}
      data-slot="tooltip-arrow"
      style={{ rotate: deg }}
      layoutId={withTransition ? `tooltip-arrow-${globalId}` : undefined}
      transition={withTransition ? transition : undefined}
      {...props}
    />
  );
}

type TooltipPortalProps = React.ComponentProps<typeof FloatingPortal>;

function TooltipPortal(props: TooltipPortalProps) {
  return <FloatingPortal {...props} />;
}

function TooltipOverlay() {
  const { currentTooltip, transition, globalId } = useGlobalTooltip();
  const arrowRef = React.useRef<SVGSVGElement | null>(null);
  const side = currentTooltip?.side ?? 'top';
  const align = currentTooltip?.align ?? 'center';
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: currentTooltip !== null,
    strategy: 'fixed',
    placement: align === 'center' ? side : `${side}-${align}`,
    middleware: [
      floatingOffset({
        mainAxis: currentTooltip?.sideOffset ?? 0,
        crossAxis: currentTooltip?.alignOffset ?? 0,
      }),
      flip(),
      shift({ padding: 8 }),
      // Floating UI reads the ref after mount.
      // eslint-disable-next-line react-hooks/refs
      floatingArrow({ element: arrowRef }),
    ],
  });

  React.useLayoutEffect(() => {
    if (!currentTooltip) return;
    // Freeze the anchor for this short-lived label. A deleted/unmounted trigger
    // must never send its exiting tooltip towards the viewport origin.
    const rect = currentTooltip.rect;
    refs.setReference({ getBoundingClientRect: () => rect });
  }, [currentTooltip, refs]);

  const resolvedSide = getResolvedSide(context.placement);
  const Component = currentTooltip?.contentAsChild ? Slot : motion.div;

  return (
    <AnimatePresence>
      {currentTooltip && (
        <TooltipPortal key={currentTooltip.id}>
          <div
            ref={refs.setFloating}
            data-slot="tooltip-overlay"
            style={{
              ...floatingStyles,
              visibility: isPositioned ? 'visible' : 'hidden',
              zIndex: 50,
              pointerEvents: 'none',
            }}
          >
            <FloatingProvider value={{ context, arrowRef }}>
              <RenderedTooltipProvider value={{ side: resolvedSide, align, open: true }}>
                <Component
                  {...currentTooltip.contentProps}
                  id={currentTooltip.id}
                  role="tooltip"
                  data-slot="tooltip-content"
                  data-side={resolvedSide}
                  data-align={align}
                  layoutId={`tooltip-content-${globalId}`}
                  initial={{ opacity: 0, scale: 0, ...initialFromSide(resolvedSide) }}
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, scale: 0, ...initialFromSide(resolvedSide) }}
                  transition={transition}
                />
              </RenderedTooltipProvider>
            </FloatingProvider>
          </div>
        </TooltipPortal>
      )}
    </AnimatePresence>
  );
}

type TooltipProps = {
  children: React.ReactNode;
  side?: Side;
  sideOffset?: number;
  align?: Align;
  alignOffset?: number;
  openDelay?: number;
};

function Tooltip({
  children,
  side = 'top',
  sideOffset = 0,
  align = 'center',
  alignOffset = 0,
  openDelay,
}: TooltipProps) {
  const id = React.useId();
  const [props, setProps] = React.useState<HTMLMotionProps<'div'>>({});
  const [asChild, setAsChild] = React.useState(false);

  return (
    <LocalTooltipProvider
      value={{
        props,
        setProps,
        asChild,
        setAsChild,
        side,
        sideOffset,
        align,
        alignOffset,
        openDelay,
        id,
      }}
    >
      {children}
    </LocalTooltipProvider>
  );
}

type TooltipContentProps = WithAsChild<HTMLMotionProps<'div'>>;

function shallowEqualWithoutChildren(
  a?: HTMLMotionProps<'div'>,
  b?: HTMLMotionProps<'div'>,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a).filter((k) => k !== 'children');
  const keysB = Object.keys(b).filter((k) => k !== 'children');
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    // @ts-expect-error index
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function TooltipContent({ asChild = false, ...props }: TooltipContentProps) {
  const { setProps, setAsChild } = useTooltip();
  const lastPropsRef = React.useRef<HTMLMotionProps<'div'> | undefined>(
    undefined,
  );

  React.useEffect(() => {
    if (!shallowEqualWithoutChildren(lastPropsRef.current, props)) {
      lastPropsRef.current = props;
      setProps(props);
    }
  }, [props, setProps]);

  React.useEffect(() => {
    setAsChild(asChild);
  }, [asChild, setAsChild]);

  return null;
}

type TooltipTriggerProps = WithAsChild<HTMLMotionProps<'div'>>;

function TooltipTrigger({
  ref,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onPointerDown,
  asChild = false,
  ...props
}: TooltipTriggerProps) {
  const {
    props: contentProps,
    asChild: contentAsChild,
    side,
    sideOffset,
    align,
    alignOffset,
    openDelay,
    id,
  } = useTooltip();
  const {
    showTooltip,
    hideTooltip,
    hideImmediate,
    currentTooltip,
  } = useGlobalTooltip();

  const triggerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => triggerRef.current as HTMLDivElement);

  React.useEffect(() => () => hideImmediate(id), [hideImmediate, id]);

  const handleOpen = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    showTooltip({
      contentProps,
      contentAsChild,
      rect,
      element: triggerRef.current,
      openDelay,
      side,
      sideOffset,
      align,
      alignOffset,
      id,
    });
  }, [
    showTooltip,
    contentProps,
    openDelay,
    contentAsChild,
    side,
    sideOffset,
    align,
    alignOffset,
    id,
  ]);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onPointerDown?.(e);
      hideImmediate(id);
    },
    [onPointerDown, id, hideImmediate],
  );

  const handleMouseEnter = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onMouseEnter?.(e);
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) handleOpen();
    },
    [handleOpen, onMouseEnter],
  );

  const handleMouseLeave = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onMouseLeave?.(e);
      hideTooltip();
    },
    [hideTooltip, onMouseLeave],
  );

  const handleFocus = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      onFocus?.(e);
      if (!e.currentTarget.matches(':focus-visible')) return;
      handleOpen();
    },
    [handleOpen, onFocus],
  );

  const handleBlur = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      onBlur?.(e);
      hideTooltip();
    },
    [hideTooltip, onBlur],
  );

  const Component = asChild ? Slot : motion.div;

  return (
    <Component
      ref={triggerRef}
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-describedby={currentTooltip?.id === id ? id : undefined}
      data-slot="tooltip-trigger"
      data-side={side}
      data-align={align}
      data-state={currentTooltip?.id === id ? 'open' : 'closed'}
      {...props}
    />
  );
}

export {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
  useGlobalTooltip,
  useTooltip,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipContentProps,
  type TooltipTriggerProps,
  type TooltipArrowProps,
  type TooltipPosition,
  type GlobalTooltipContextType,
  type TooltipContextType,
};
