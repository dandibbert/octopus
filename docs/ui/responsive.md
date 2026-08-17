# 响应式

## 断点语义

应用外壳在 **`md`(768)** 从"移动"切到"桌面"：底部胶囊导航 → 左侧粘性栏，
单栏 → `md:grid-cols-[auto_1fr]`（见 `web/src/components/app.tsx`）。

**新代码的移动/桌面分界一律用 `md`。** 不要用 `sm` 或 `lg` 表达同一件事——
历史上 Channel 标签用 `sm`、Playground 双栏用 `lg`，导致 640–1023px 之间
不同区域的形态互相矛盾。`sm` / `lg` / `xl` 只用于同一形态内部的密度微调。

JS 侧判断用 `useIsMobile()`（`hooks/use-mobile.ts`，同为 768），
不要新写 `matchMedia`。注意它首帧返回 `false`，别用它决定首屏结构。

## 栅格列数：按容器宽度，不按视口断点

列表容器（`max-w-6xl` 外壳再减去侧栏）**始终窄于视口**，所以用视口断点算列数会算错。
统一用 `columnsByMinWidth`：

```tsx
import { VirtualizedGrid, columnsByMinWidth } from '@/components/common/VirtualizedGrid';

const CARD_COLUMNS = columnsByMinWidth(320, 3); // 模块作用域，保持引用稳定

<VirtualizedGrid items={items} columns={CARD_COLUMNS} estimateItemHeight={240} ... />
```

参数表达的是设计意图——"一张卡片至少要 320px 才读得下"——而不是拍脑袋的断点数字。
`layout="list"` 时组件自动按 1 列处理，不用自己判断。

配套的骨架屏用 `ListSkeleton` 并传同一个 `minCardWidth`（见 [interaction-patterns.md](./interaction-patterns.md)）。

## 触摸目标

`ui/button.tsx` 的所有 `size` 在 `pointer-coarse`（触屏）下自动撑到 44×44，
视觉尺寸不变。**用 `Button` 就已经达标，不要再写 `size-10 md:size-8` 这类补丁。**

确实无法容纳 44px 的表格行内场景，用 `size="icon-dense"` 显式选择退出，
而不是各写各的 override。

手写的 `<button>` 不受此保护——这也是应该优先用 `Button` 的理由之一。

## 底部导航留白

移动端底部有 fixed 导航栏，可滚动容器需要 `pb-24 md:pb-4` 留白。
`VirtualizedGrid` 已内置，直接用它的话不用管。

## 横向溢出

`globals.css` 里 `body { overflow-x: hidden }`，**页面级横向滚动会被静默裁掉而不是出现滚动条**。
宽内容必须自己套 `overflow-x-auto` 容器。

宽表格要给窄屏准备替代形态（参考 `site-channel` 的移动卡片视图），
不要只靠容器内横滚——`min-w-[74rem]` 这类固定宽表格在平板上体验很差。
