/**
 * builder.js — AST → 角色卡 V2 data + 世界书 entries（与 SillyTavern 1.18.0 内部结构 1:1 对齐）
 * （与 prototype/builder.js 同源，随插件分发）
 *
 * 字段默认值对齐 ST 源码：
 *  - world-info.js: newWorldInfoEntryTemplate / world_info_position / world_info_logic
 *  - script.js: create_save 形状
 */

/** ST world_info_position 枚举（world-info.js L855） */
export const POSITION = {
    before: 0,        // before_char
    after: 1,         // after_char（默认）
    ANTop: 2,
    ANBottom: 3,
    atDepth: 4,
    EMTop: 5,
    EMBottom: 6,
    outlet: 7,
};

const POSITION_ALIASES = {
    before_char: POSITION.before, '角色前': POSITION.before, '前': POSITION.before, before: POSITION.before,
    after_char: POSITION.after, '角色后': POSITION.after, '后': POSITION.after, after: POSITION.after,
    antop: POSITION.ANTop, an_bottom: POSITION.ANBottom, atdepth: POSITION.atDepth,
    emtop: POSITION.EMTop, embottom: POSITION.EMBottom, outlet: POSITION.outlet,
};

const ROLE = { system: 0, user: 1, assistant: 2, instruct: 3 };
const ROLE_ALIASES = {
    system: 0, '系统': 0, 用户: 1, user: 1, assistant: 2, '助手': 2, instruct: 3, '指令': 3,
};

/** 角色卡字段别名表：文本键（可多别名）→ ST 字段 */
const CARD_FIELD_ALIASES = {
    name: ['名称', '姓名'],
    description: ['描述'],
    personality: ['人格', '性格'],
    first_mes: ['开场白', '首条消息', '开场节点'],
    alternate_greetings: ['替代开场白', '备用开场白'],
    mes_example: ['示例对话', '对话示例'],
    scenario: ['场景', '世界观场景'],
    system_prompt: ['系统提示', '系统提示词'],
    creator_notes: ['作者注', '创作者笔记', '备注'],
    post_history_instructions: ['后置历史指令', '历史后指令'],
    tags: ['标签'],
    creator: ['作者', '创作者'],
    character_version: ['版本', '角色版本'],
    talkativeness: ['话痨度'],
    world: ['世界', '关联世界书', '关联书'],
    depth_prompt_prompt: ['深度提示', '深度提示词'],
    depth_prompt_depth: ['深度提示深度', '提示深度'],
    depth_prompt_role: ['深度提示角色', '提示角色'],
};

const KEY_ALIASES = {
    key: ['关键词', '关键字', '触发词'],
    keysecondary: ['次要关键词', '次要关键字'],
    content: ['内容'],
    comment: ['注释', '备注'],
    position: ['位置', '插入位置'],
    order: ['顺序', '优先级'],
    depth: ['深度'],
    scanDepth: ['扫描深度'],
    constant: ['常量', '常驻注入'],
    disable: ['启用', '禁用'],
    probability: ['概率'],
    useProbability: ['使用概率'],
    group: ['组', '分组'],
    groupWeight: ['组权重'],
    groupOverride: ['组覆盖'],
    sticky: ['常驻', '粘性'],
    cooldown: ['冷却'],
    delay: ['延迟'],
    role: ['角色', '提示角色'],
    caseSensitive: ['大小写敏感'],
    matchWholeWords: ['整词匹配'],
    ignoreBudget: ['忽略预算'],
    excludeRecursion: ['排除递归'],
    preventRecursion: ['禁止递归'],
    delayUntilRecursion: ['递归延迟'],
    outletName: ['出口名'],
};

/** 字符串 → 数组：按 ; ，, 、 及换行拆分 */
export function splitList(value) {
    return value
        .split(/[;；,，、\n]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const v = String(value).trim().toLowerCase();
    if (['是', '真', 'true', 'yes', '1', '开', '启用'].includes(v)) return true;
    if (['否', '假', 'false', 'no', '0', '关', '禁用'].includes(v)) return false;
    return fallback;
}

function toNum(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : fallback;
}

function toNullableNum(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

function fieldValue(field) {
    if (!field) return '';
    // bullet 列表优先（数组字段）
    if (field.bullets && field.bullets.length > 0) return field.bullets.join('\n');
    return field.raw;
}

function findField(fields, keys) {
    for (const k of keys) {
        if (fields[k] !== undefined) return fields[k];
    }
    return undefined;
}

/**
 * 把"节点N：…"开头的多段文本按节点拆分（保留节点标题与内容）。
 * 用于：开场白中若包含多个开场节点，节点一留作开场白、其余转入替代开场白。
 * @param {string} text
 * @returns {string[]}
 */
function splitNodeSegments(text) {
    if (!text) return [];
    const parts = text.split(/(节点[一二三四五六七八九十百\d]+\s*[:：])/);
    const segments = [];
    for (let i = 1; i < parts.length; i += 2) {
        const seg = ((parts[i] ?? '') + (parts[i + 1] ?? '')).trim();
        if (seg) segments.push(seg);
    }
    // 节点前的引言/前导文本并入第一个节点
    if (segments.length > 1 && parts[0] && parts[0].trim()) {
        segments[0] = `${parts[0].trim()}\n${segments[0]}`;
    }
    return segments;
}

/**
 * 构建角色卡（两种输出形状）
 * @returns {{ createSave: object, cardData: object, warnings: string[], errors: string[] }}
 */
export function buildCard(ast) {
    const warnings = [];
    const errors = [];
    const fields = ast.card || {};

    const aliasToKey = {};
    for (const [key, aliases] of Object.entries(CARD_FIELD_ALIASES)) {
        for (const a of aliases) aliasToKey[a] = key;
    }

    const get = (stKey) => {
        const aliases = CARD_FIELD_ALIASES[stKey];
        return findField(fields, aliases);
    };

    const name = fieldValue(get('name'));
    if (!name) errors.push('角色卡缺少必填字段「名称」');
    let description = fieldValue(get('description'));
    if (!description) warnings.push('角色卡缺少「描述」（建议填写，影响模型表现）');
    let systemPrompt = fieldValue(get('system_prompt'));

    // 特殊字段合并（兜底：AI/手写输入若保留独立字段则并入而非丢弃）
    const SPECIAL_KEYS = ['高频行为', '行为', '角色备注', '核心规则', '特别指令'];
    const appendTo = (base, header, text) => (base ? `${base}\n\n${header}：\n${text}` : `${header}：\n${text}`);

    // 高频行为 → 描述
    const freqField = findField(fields, ['高频行为', '行为']);
    if (freqField && fieldValue(freqField)) description = appendTo(description, '高频行为', fieldValue(freqField));
    // 核心规则 / 特别指令 → 系统提示（逐字保留，不简略，不进入描述）
    const coreRuleField = findField(fields, ['核心规则']);
    if (coreRuleField && fieldValue(coreRuleField)) systemPrompt = appendTo(systemPrompt, '核心规则', fieldValue(coreRuleField));
    const specialField = findField(fields, ['特别指令']);
    if (specialField && fieldValue(specialField)) systemPrompt = appendTo(systemPrompt, '特别指令', fieldValue(specialField));
    // 角色备注 → 深度提示（Character's Note，位于情景下方的深度/角色区），而非描述/作者注
    const notesField = findField(fields, ['角色备注']);
    let depthPromptText = fieldValue(get('depth_prompt_prompt'));
    if (notesField && fieldValue(notesField)) {
        const notes = fieldValue(notesField);
        depthPromptText = depthPromptText ? `${depthPromptText}\n\n【角色备注】\n${notes}` : `【角色备注】\n${notes}`;
    }

    // 未知字段告警（已处理字段除外）
    for (const key of Object.keys(fields)) {
        if (!aliasToKey[key] && !SPECIAL_KEYS.includes(key)) warnings.push(`未知角色卡字段「${key}」（将被忽略）`);
    }

    const tagsRaw = fieldValue(get('tags'));
    const tags = tagsRaw ? splitList(tagsRaw) : [];

    // 开场节点拆分：节点一 → 开场白，其余节点 → 替代开场白（ST 原生"可选开局"选择功能）
    const rawFirstMessage = fieldValue(get('first_mes'));
    const nodeSegments = splitNodeSegments(rawFirstMessage);
    const firstMessage = nodeSegments.length > 1 ? nodeSegments[0] : rawFirstMessage;
    const altGreetings = [
        ...(fieldValue(get('alternate_greetings')) || '').split('\n').map(s => s.trim()).filter(Boolean),
        ...(nodeSegments.length > 1 ? nodeSegments.slice(1) : []),
    ];

    const depthPrompt = {
        prompt: depthPromptText,
        depth: toNum(fieldValue(get('depth_prompt_depth')), 4),
        role: ROLE_ALIASES[String(fieldValue(get('depth_prompt_role'))).trim().toLowerCase()] ?? 0,
    };

    const createSave = {
        name,
        description,
        personality: fieldValue(get('personality')),
        scenario: fieldValue(get('scenario')),
        first_message: firstMessage,
        mes_example: fieldValue(get('mes_example')),
        creator_notes: fieldValue(get('creator_notes')),
        system_prompt: systemPrompt,
        post_history_instructions: fieldValue(get('post_history_instructions')),
        tags: tags.join(', '),
        creator: fieldValue(get('creator')),
        character_version: fieldValue(get('character_version')),
        talkativeness: toNum(fieldValue(get('talkativeness')), 0.5),
        world: fieldValue(get('world')),
        depth_prompt_prompt: depthPrompt.prompt,
        depth_prompt_depth: depthPrompt.depth,
        depth_prompt_role: depthPrompt.role,
        alternate_greetings: altGreetings,
        extensions: {},
        extra_books: [],
        avatar: null,
    };

    const cardData = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name,
            description,
            personality: createSave.personality,
            scenario: createSave.scenario,
            first_mes: createSave.first_message,
            mes_example: createSave.mes_example,
            creator_notes: createSave.creator_notes,
            system_prompt: createSave.system_prompt,
            post_history_instructions: createSave.post_history_instructions,
            alternate_greetings: createSave.alternate_greetings,
            tags,
            creator: createSave.creator,
            character_version: createSave.character_version,
            extensions: {
                talkativeness: createSave.talkativeness,
                depth_prompt: depthPrompt,
            },
        },
    };

    return { createSave, cardData, warnings, errors };
}

/**
 * 构建世界书（ST 内部 entries 字典格式）
 * @param {object} bookAst  parser 输出中的一本书 { type, entries }
 * @returns {{ book: {entries: object}, warnings: string[], errors: string[] }}
 */
export function buildBook(bookAst) {
    const warnings = [];
    const errors = [];
    const entries = {};

    const aliasToKey = {};
    for (const [key, aliases] of Object.entries(KEY_ALIASES)) {
        for (const a of aliases) aliasToKey[a] = key;
    }

    bookAst.entries.forEach((entry, index) => {
        const fields = entry.fields || {};
        const rawKey = fieldValue(findField(fields, ['关键词', '关键字', '触发词']));
        const content = fieldValue(findField(fields, ['内容']));

        if (!rawKey) errors.push(`条目「${entry.name}」缺少必填字段「关键词」`);
        if (!content) errors.push(`条目「${entry.name}」缺少必填字段「内容」`);

        for (const key of Object.keys(fields)) {
            if (!aliasToKey[key] && key !== '内容') {
                warnings.push(`条目「${entry.name}」未知字段「${key}」（将被忽略）`);
            }
        }

        const positionRaw = String(fieldValue(findField(fields, ['位置', '插入位置']))).trim().toLowerCase();
        let position = POSITION_ALIASES[positionRaw];
        if (positionRaw && position === undefined) {
            warnings.push(`条目「${entry.name}」位置「${positionRaw}」非法，已回退为 after_char`);
            position = POSITION.after;
        }
        if (position === undefined) position = POSITION.after;

        const enabledRaw = fieldValue(findField(fields, ['启用', '禁用']));
        const disable = enabledRaw ? !toBool(enabledRaw) : false;

        // 条目标题：ST 世界书编辑器把 comment 当作「条目标题/备注」显示（Entry Title/Memo），
        // 故用「### 条目：名称」作为 comment；仅显式填写「注释」时才开启 addMemo（注入提示词）
        const commentField = fieldValue(findField(fields, ['注释', '备注']));
        const comment = commentField || entry.name || '';

        entries[index] = {
            uid: index,
            key: rawKey ? splitList(rawKey) : [],
            keysecondary: fieldValue(findField(fields, ['次要关键词', '次要关键字'])) ? splitList(fieldValue(findField(fields, ['次要关键词', '次要关键字']))) : [],
            comment,
            content,
            constant: toBool(fieldValue(findField(fields, ['常量', '常驻注入']))),
            selective: true,
            selectiveLogic: 0, // AND_ANY
            addMemo: Boolean(commentField),
            order: toNum(fieldValue(findField(fields, ['顺序', '优先级'])), 100),
            position,
            disable,
            ignoreBudget: toBool(fieldValue(findField(fields, ['忽略预算']))),
            excludeRecursion: toBool(fieldValue(findField(fields, ['排除递归']))),
            preventRecursion: toBool(fieldValue(findField(fields, ['禁止递归']))),
            delayUntilRecursion: toBool(fieldValue(findField(fields, ['递归延迟']))),
            probability: toNum(fieldValue(findField(fields, ['概率'])), 100),
            useProbability: true,
            depth: toNum(fieldValue(findField(fields, ['深度'])), 4),
            scanDepth: toNullableNum(fieldValue(findField(fields, ['扫描深度']))),
            caseSensitive: String(fieldValue(findField(fields, ['大小写敏感']))).trim() === '' ? null : toBool(fieldValue(findField(fields, ['大小写敏感']))),
            matchWholeWords: String(fieldValue(findField(fields, ['整词匹配']))).trim() === '' ? null : toBool(fieldValue(findField(fields, ['整词匹配']))),
            group: fieldValue(findField(fields, ['组', '分组'])),
            groupOverride: toBool(fieldValue(findField(fields, ['组覆盖']))),
            groupWeight: toNum(fieldValue(findField(fields, ['组权重'])), 100),
            role: ROLE_ALIASES[String(fieldValue(findField(fields, ['角色', '提示角色']))).trim().toLowerCase()] ?? 0,
            sticky: toNullableNum(fieldValue(findField(fields, ['常驻', '粘性']))),
            cooldown: toNullableNum(fieldValue(findField(fields, ['冷却']))),
            delay: toNullableNum(fieldValue(findField(fields, ['延迟']))),
            outletName: fieldValue(findField(fields, ['出口名'])),
            vectorized: false,
            automationId: '',
            triggers: [],
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
        };
    });

    return { book: { entries }, warnings, errors };
}

