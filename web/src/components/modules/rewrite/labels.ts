import type { RewriteOp } from './schema';

const OP_LABEL_KEYS: Record<RewriteOp, string> = {
    set: 'opSet',
    set_if_absent: 'opSetIfAbsent',
    delete: 'opDelete',
    move: 'opMove',
    copy: 'opCopy',
    array_append: 'opArrayAppend',
    array_prepend: 'opArrayPrepend',
    array_insert: 'opArrayInsert',
    array_remove: 'opArrayRemove',
    header_set: 'opHeaderSet',
    header_set_if_absent: 'opHeaderSetIfAbsent',
    header_add: 'opHeaderAdd',
    header_delete: 'opHeaderDelete',
    header_copy: 'opHeaderCopy',
    header_move: 'opHeaderMove',
    return_error: 'opReturnError',
    trim_prefix: 'opTrimPrefix',
    trim_suffix: 'opTrimSuffix',
    ensure_prefix: 'opEnsurePrefix',
    ensure_suffix: 'opEnsureSuffix',
    trim_space: 'opTrimSpace',
    to_lower: 'opToLower',
    to_upper: 'opToUpper',
    replace: 'opReplace',
    regex_replace: 'opRegexReplace',
    prune_objects: 'opPruneObjects',
    header_pass: 'opHeaderPass',
    sync_fields: 'opSyncFields',
};

const CONDITION_OPERATOR_KEYS: Record<string, string> = {
    exists: 'condOpExists',
    missing: 'condOpMissing',
    eq: 'condOpEq',
    neq: 'condOpNeq',
    prefix: 'condOpPrefix',
    suffix: 'condOpSuffix',
    contains: 'condOpContains',
    regex: 'condOpRegex',
    gt: 'condOpGt',
    gte: 'condOpGte',
    lt: 'condOpLt',
    lte: 'condOpLte',
    in: 'condOpIn',
    not_in: 'condOpNotIn',
    type_is: 'condOpTypeIs',
};

const CONDITION_SOURCE_KEYS: Record<string, string> = {
    body: 'condSourceBody',
    header: 'condSourceHeader',
    context: 'condSourceContext',
    item: 'condSourceItem',
};

type Translate = (key: string) => string;

export function operationLabel(t: Translate, op: string): string {
    return t(OP_LABEL_KEYS[op as RewriteOp] ?? 'operation');
}

export function conditionOperatorLabel(t: Translate, operator: string): string {
    const key = CONDITION_OPERATOR_KEYS[operator];
    return key ? t(key) : operator;
}

export function conditionSourceLabel(t: Translate, source: string): string {
    const key = CONDITION_SOURCE_KEYS[source];
    return key ? t(key) : source;
}
