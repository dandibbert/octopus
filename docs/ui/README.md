# Octopus 管理面板设计系统

前端是一套成型的设计系统，不是一堆独立页面。改 `web/src` 之前先读这里，再动手。

仓库正文以本目录为准。本地 Cursor 可以把同一份内容放到 `.cursor/rules/ui-*.mdc`（该目录不入库），打开 `web/src/**/*.tsx` 时会自动带上。

| 文档 | 内容 |
|---|---|
| [system-first.md](./system-first.md) | 功能归属、缺词汇时补词汇、功能开关分层 |
| [design-tokens.md](./design-tokens.md) | 语义色 / 字号 / 圆角 / 阴影 / 模态遮罩 |
| [interaction-patterns.md](./interaction-patterns.md) | 表单容器、ConfirmAction、ListState、toast、i18n |
| [responsive.md](./responsive.md) | `md` 分界、`columnsByMinWidth`、触摸目标 |

要点：语义色用 `success` / `warning` / `info` / `destructive`（不必写 `dark:` 变体）；密集字号用 `text-2xs` / `text-3xs`；破坏性操作走 `common/ConfirmAction`；空/加载态走 `common/ListState`；栅格列数用 `columnsByMinWidth` 按容器宽度算。
