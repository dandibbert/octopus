'use client';

import { useEffect, type RefObject } from 'react';

/** Extend the active page's wheel area into the app's empty outer margins. */
export function usePageGutterScroll(
    shellRef: RefObject<HTMLElement | null>,
    pageRef: RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        const onWheel = (event: WheelEvent) => {
            const shell = shellRef.current;
            const page = pageRef.current;
            const target = event.target;
            if (!shell || !page || !(target instanceof Element)) return;
            // Only bare shell/ancestor space. Controls, nested lists and portals
            // retain their native behavior, including a popup outside the shell.
            if (target !== shell && !target.contains(shell)) return;
            if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            if (document.querySelector('[aria-modal="true"]')) return;

            const candidates = page.querySelectorAll<HTMLElement>(
                '[data-virtualized-scroll], [data-page-scroll], :scope > *',
            );
            const scroller = Array.from(candidates).find((element) => {
                const overflow = getComputedStyle(element).overflowY;
                return (overflow === 'auto' || overflow === 'scroll') && element.clientHeight > 0
                    && element.scrollHeight > element.clientHeight && element.getClientRects().length > 0;
            });
            if (!scroller) return;
            const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? parseFloat(getComputedStyle(scroller).lineHeight) || 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1;
            const next = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + event.deltaY * unit));
            if (next === scroller.scrollTop) return;
            event.preventDefault();
            scroller.scrollTop = next;
        };
        window.addEventListener('wheel', onWheel, { passive: false });
        return () => window.removeEventListener('wheel', onWheel);
    }, [shellRef, pageRef]);
}
