# 把它当成一个成型的产品，而不是一堆页面

Octopus 的前端有一套完整的设计系统：令牌在 `web/src/app/globals.css`，原语在
`web/src/components/ui/` 与 `web/src/components/common/`，导航模型在 `web/src/route/config.tsx`。
新功能要看起来像一直就在产品里，而不是后来贴上去的。

## 动手之前先回答三个问题

1. **这个功能属于哪里？** 是某个已有页面的一种视图，还是一个独立资源？独立资源应该进
   `ROUTES`（`web/src/route/config.tsx`）拿一个导航席位，而不是塞进某个页面的 tab 或
   工具栏弹窗里。
2. **这个动作属于哪一层？** 作用于整页的动作进 `Toolbar`；作用于单条记录的动作进卡片；
   作用于某个字段的动作进表单行。
3. **系统里有没有现成的说法？** 先在 `components/ui/` 和 `components/common/` 找。
   找不到就**补进系统**，不要在模块里就地发明。

## 反模式

不要因为"新需求"就在最近的空位插一个按钮、卡片、行、动画或开关。

工具栏使用 `priority` 控制溢出。业务动作和弹窗内容由各模块的 `ToolbarActions.tsx`
提供，外壳负责组合，通用组件负责布局。渠道子标签、待补全数量等业务判断留在渠道模块，
避免功能内部状态再次泄漏进产品级外壳。

## 功能开关：在系统边界上关，不要逐个组件加判断

整块功能的开关（目前只有站点域的 `site_enabled`）在四个层面生效，照这个分层来加新的：

| 层面 | 做法 |
|---|---|
| 后端接口 | `middleware.RequireSiteEnabled()` 挂在整个 `GroupRouter` 上，关闭时整组 403 |
| 后端任务 | 任务照常注册，函数开头读设置后 early return，开关切换无需重启 |
| 前端数据 | 开关喂进 `useQuery` 的 `enabled`（见 `api/endpoints/site.ts`），请求根本不发 |
| 前端导航 | `route/config.tsx` 的 `feature` 字段 + `useVisibleRoutes()` 摘掉导航席位 |

关键是**在 API 层就把数据掐断**：展示该域元数据的地方（分组来源标签、日志筛选分桶）
拿不到数据就自然退化，不需要在十几个消费组件里各写一遍 `if (!enabled)`。

被隐藏的席位可能正是持久化的 `activeItem`，所以外壳要调 `useActiveRouteGuard()` 兜底。

## 缺词汇的时候，补词汇

如果你发现自己在写 `text-[13px]`、`bg-emerald-500`、又一个自定义空状态，
那说明**系统缺少表达这个需求的词汇**。正确做法是往 `globals.css` 加令牌、
往 `components/common/` 加原语，然后所有地方一起用；就地绕过只会让下一个人继续绕。

## 功能能跑 ≠ 做完

提交前对照检查：视觉层级、间距节奏、响应式行为、导航模型、交互反馈，
是否都和它周围的既有部分一致。
