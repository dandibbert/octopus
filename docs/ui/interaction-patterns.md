# 交互模式

同一个动作在不同页面必须长得一样、行为一样。

## 破坏性操作：一律走 ConfirmAction

`web/src/components/common/ConfirmAction.tsx`（基于 Radix AlertDialog，可安全叠在
已打开的 Dialog / MorphingDialog 之上）。

```tsx
<ConfirmAction
    title={t('deleteConfirmTitle')}
    description={t('deleteConfirmDescription', { name })}
    onConfirm={() => remove.mutate(id)}
>
    <Button variant="ghost" size="icon-sm" aria-label={t('delete')}>
        <Trash2 className="size-4" />
    </Button>
</ConfirmAction>
```

**禁止**：`window.confirm`、无确认直接删除、以及新写"点两次才生效"的内联确认。

唯一例外：`channel/CardContent`、`model/Item`、`group/Card`、`setting/APIKey` 里
既有的内联两步确认——它们的触发点位于已打开的浮层内部，且删除对象就是该浮层的主体，
再叠一层模态反而更差。**改这些文件时保留原样，但不要把这个模式复制到新地方。**

## 表单容器

- **新建**：`MorphingDialog`，入口挂在 `Toolbar`（业务动作在各模块的 `ToolbarActions.tsx`，通用弹窗容器在 `toolbar/ToolbarActions.tsx`）
- **编辑**：与新建同构，从卡片触发
- **多步 / 主从结构**：`Dialog`

不要为了省事新引一套浮层实现。需要在卡片上就地编辑时，复用 `setting/OverlayPortal` 的现成做法。

表单使用 `common/ValidatedForm`。保留 `required`、输入类型、范围和步长等 HTML 约束，
由组件统一阻止无效提交、使用项目 Toast 提示并聚焦错误字段，避免浏览器默认校验气泡。
业务层校验继续保留，不能只加 `noValidate` 就把校验关掉。

## 空态 / 加载态 / 错误态

用 `web/src/components/common/ListState.tsx`，不要自己拼虚线框或写一行灰字。

```tsx
<VirtualizedGrid
    columns={columnsByMinWidth(320, 3)}
    emptyState={<ListState icon={Layers3} title={t('empty.title')} description={t('empty.description')} />}
/>

{isLoading && <ListSkeleton layout={layout} count={3} minCardWidth={320} />}
{error && <ListState tone="error" icon={CircleAlert} title={t('loadFailed', { message: error.message })} />}
```

`ListSkeleton` 的 `minCardWidth` 要和 `columnsByMinWidth` 传同一个数值，
骨架屏才会和真实列表在同一个宽度换列。

## 反馈提示

统一从 `@/components/common/Toast` 导入 `toast`，**不要直接 import sonner**。

CRUD 的成功与失败都要给反馈。失败时保留输入和当前操作上下文，便于修正后重试。

## 组件复用

可点击元素用 `@/components/ui/button` 的 `Button`，不要手写 `<button className="...">`；
输入框用 `ui/input`、下拉用 `ui/select`。需要 `motion` 动画时用 `asChild` 或
`buttonVariants()` 拿到样式，而不是重抄一遍类名。

## 文案

所有会渲染到界面的字符串（含 `aria-label` / `title` / `placeholder`）都必须走 next-intl，
并且 `en` / `zh_hans` / `zh_hant` 三份 `web/public/locale/*.json` 同时补齐。

非组件的辅助函数需要文案时，把 `t` 作为参数传进去（参考 `log/Item.tsx` 的 `getWSBadgeMeta`）。
文案里出现字面量花括号要用 ICU 单引号转义：`'{"a":1}'`。
