# 设计令牌

全部定义在 `web/src/app/globals.css`，light/dark 各一份。

## 颜色：不要写 Tailwind 调色板色

产品是暖中性 + 绿色品牌的配色。`text-blue-500`、`bg-emerald-50`、`border-amber-200`
这类类名一律禁止，`#hex` / `rgb()` 同理（`lib/model-icons.tsx` 里的厂商品牌色除外）。

语义色：`primary` `destructive` `success` `warning` `info` `muted`，
以及表面色 `background` `foreground` `card` `popover` `border` `input` `ring`。

```tsx
// ❌ 不要
<span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">健康</span>
<p className="text-red-500">失败</p>

// ✅ 要
<span className="bg-success/10 text-success">健康</span>
<p className="text-destructive">失败</p>
```

**令牌在两个主题下已经分别调过明度，所以不需要写 `dark:` 变体。**
写了 `dark:text-success-*` 之类反而是错的。

用途对照：成功/健康 → `success`；警告/降级/待处理 → `warning`；
中性提示/进行中 → `info`；错误/破坏性 → `destructive`；停用/次要 → `muted`。

## 字号：只用刻度，不写方括号

`text-3xs`(10px) · `text-2xs`(11px) · `text-xs` · `text-sm` · `text-base` · `text-lg` …

`text-3xs` / `text-2xs` 是本项目补进 Tailwind 刻度的两档，专给表格与徽章这类
高密度元数据用。**不要再写 `text-[13px]` 这种任意值**；确实需要新档位就加进
`globals.css` 的 `@theme inline`，而不是就地写死。

## 排版层级

| 层级 | 规格 |
|---|---|
| 页面标题（应用外壳） | `text-3xl font-bold` |
| 对话框标题 | `text-2xl font-bold` |
| 卡片 / 区块标题 | `text-lg font-bold` |
| 次级区块标题 | `text-sm font-semibold` |
| 正文 | `text-sm` |
| 辅助说明 | `text-xs text-muted-foreground` |
| 密集元数据 | `text-2xs text-muted-foreground` |

同一语义层级在不同模块必须用同一规格。

## 圆角

`--radius: 0.5rem` 派生出 `rounded-sm/md/lg/xl`。产品的卡片语言另外用到
`rounded-2xl`（对话框、弹层）和 `rounded-3xl`（页面级卡片、面板）。
**不要写 `rounded-[28px]` 这类任意值。**

## 阴影

卡片级 elevation 一律用 `.custom-shadow`（它由 `--shadow-*` 令牌驱动，
light/dark 各自保持预期深度）。**不要写 `shadow-[0_20px_60px_-42px_rgba(...)]`。**

嵌套在卡片内部的区块**不加阴影**——elevation 属于最外层卡片，靠 `border` 区分层次即可。

## 模态遮罩

所有浮层的遮罩统一用 `.overlay-scrim`（`globals.css`，由 `--overlay-scrim-color`
和 `--overlay-scrim-blur` 驱动的毛玻璃）。`ui/dialog`、`ui/alert-dialog`、
`ui/morphing-dialog`、`setting/OverlayPortal` 已经全部走它。

新写浮层时**不要再手写 `bg-black/50` 或 `bg-white/40 backdrop-blur-xs dark:bg-black/40`**——
历史上这两套并存，同一个产品里点开不同浮层背景表现不一样。
浅色/深色的蒙层颜色由 CSS 变量分别定义，所以**组件里不要写 `dark:` 变体**。
