/**
 * parser.js — 「特定格式」文本 → AST 的确定性解析器
 *
 * 纯函数、零依赖、可在浏览器与 Node 中复用。
 * （与 prototype/parser.js 同源，随插件分发）
 *
 * 格式规则（与方案文档 §3 一致）：
 *  - 顶层区块： 【角色卡】 / 【角色书】 / 【世界书】 （兼容 [角色卡] / # 角色卡）
 *  - 字段行：   键: 值  （顶格、键≤40字符、兼容全角冒号）
 *  - 多行值：   后续行以 ≥1 空格缩进，或为无冒号的裸文本行，
 *               直到下一个「已知字段行 / 区块头 / 条目头」为止
 *  - 空行：     多行字段内的空行属于内容（Markdown 段落分隔、表格分隔），**不结束字段**
 *  - Markdown 标题：字段内以 `#` 开头的行属于内容（如「## 核心规则」）；
 *               只有没有正在累积的字段时，`#` 开头行才当作注释
 *  - 数组值：   `- 项` 或 `* 项` 的 bullet 列表；或 `; , 、` 分隔（由 builder 拆分）
 *  - 世界书条目： `### 条目：名称` （兼容 ## / - 前缀）
 *  - 内容字段： 条目内一旦出现 `内容:`，其后所有非标题行（含冒号/#/空行）都属于内容
 */

export const BLOCK_TYPES = {
    CARD: 'card',
    EMBEDDED_BOOK: 'embedded', // 【角色书】→ 内嵌 character_book
    WORLD_BOOK: 'world',       // 【世界书】→ 独立 lorebook
};

const BLOCK_HEADER_RE = /^\s*(?:#{1,4}\s*)?[【\[]\s*(角色卡|角色书|世界书)\s*[】\]]\s*$/;
const BLOCK_HEADER_PLAIN_RE = /^\s*#{1,4}\s*(角色卡|角色书|世界书)\s*$/;
const ENTRY_HEADER_RE = /^\s*(?:#{2,4}\s*|[-*]\s*)?条目\s*[:：]\s*(.+?)\s*$/;
const FIELD_RE = /^([^\s#:：][^:：]{0,40}?)\s*[:：]\s*(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.+)$/;
const COMMENT_RE = /^\s*#/;

const BLOCK_TYPE_BY_NAME = {
    '角色卡': BLOCK_TYPES.CARD,
    '角色书': BLOCK_TYPES.EMBEDDED_BOOK,
    '世界书': BLOCK_TYPES.WORLD_BOOK,
};

/**
 * 长文本字段：这些字段里以 `#` 开头的行是 Markdown 标题（属于内容，必须逐字保留）。
 * 短字段（名称/标签/版本…）里的 `#` 行仍按注释丢弃，避免注释被并进字段值。
 */
const PROSE_FIELDS = new Set([
    '描述', '人格', '性格', '场景', '世界观场景', '开场白', '首条消息', '开场节点',
    '替代开场白', '备用开场白', '示例对话', '对话示例', '系统提示', '系统提示词',
    '深度提示', '深度提示词', '作者注', '创作者笔记', '备注', '角色备注',
    '核心规则', '高频行为', '行为', '特别指令', '内容', '注释',
]);

/**
 * 已知字段名集合（与 builder.js 的 CARD_FIELD_ALIASES / KEY_ALIASES 保持同步）。
 * 只有键属于此集合的冒号行才被识别为新字段；
 * 其余冒号行（如"节点二：…""1. 禁止扮演 徐汐：…""· 若 徐汐 配合沉默：…"）
 * 一律视为上一字段的内容续行，避免把正文误拆成字段而丢失。
 */
const KNOWN_FIELDS = new Set([
    // 角色卡字段
    '名称', '姓名', '描述', '人格', '性格', '开场白', '首条消息', '开场节点',
    '替代开场白', '备用开场白', '示例对话', '对话示例', '场景', '世界观场景',
    '系统提示', '系统提示词', '作者注', '创作者笔记', '备注', '后置历史指令', '历史后指令',
    '标签', '作者', '创作者', '版本', '角色版本', '话痨度', '世界', '关联世界书', '关联书',
    '深度提示', '深度提示词', '深度提示深度', '提示深度', '深度提示角色', '提示角色',
    '高频行为', '行为', '角色备注', '核心规则', '特别指令',
    // 世界书条目字段
    '关键词', '关键字', '触发词', '次要关键词', '次要关键字', '内容', '注释',
    '位置', '插入位置', '顺序', '优先级', '深度', '扫描深度', '常量', '常驻注入',
    '启用', '禁用', '概率', '使用概率', '组', '分组', '组权重', '组覆盖',
    '常驻', '粘性', '冷却', '延迟', '角色', '提示角色', '大小写敏感', '整词匹配',
    '忽略预算', '排除递归', '禁止递归', '递归延迟', '出口名',
]);

/**
 * 行首项目符号（「· 」/「• 」/「- 」/「* 」）。
 * 字段行允许带它：提示词要求条目内容用「· 」子要点展开，模型很自然会把「常量: 是」
 * 这类元数据行也带上符号；带上就必须照字段处理，否则会被并进内容里静默失效。
 */
const LEAD_BULLET_RE = /^\s*(?:[·•]|[-*+])\s+/;

/** 值形状（只在"带 bullet 的字段行"与"内容之后的字段行"这两条宽松路径上校验） */
const VALUE_SHAPES = {
    bool: /^(是|否|真|假|true|false|yes|no|1|0|开|关|启用|禁用)$/i,
    num: /^\d+(\.\d+)?$/,
    position: /^(before_char|after_char|before|after|antop|an_bottom|atdepth|emtop|embottom|outlet|角色前|角色后|前|后)$/i,
};

/** 字段 → 值形状；未列出的字段（关键词/组/出口名…）只要值非空即可 */
const FIELD_VALUE_SHAPE = {
    常量: 'bool', 常驻注入: 'bool', 忽略预算: 'bool', 排除递归: 'bool', 禁止递归: 'bool',
    递归延迟: 'bool', 大小写敏感: 'bool', 整词匹配: 'bool', 组覆盖: 'bool', 常驻: 'bool',
    启用: 'bool', 禁用: 'bool',
    顺序: 'num', 优先级: 'num', 深度: 'num', 扫描深度: 'num', 概率: 'num', 使用概率: 'num',
    粘性: 'num', 冷却: 'num', 延迟: 'num', 组权重: 'num',
    位置: 'position', 插入位置: 'position',
};

/**
 * 「内容」之后仍允许被识别的条目元数据字段。
 * 真实 AI 输出常把「常量: 是」写在条目末尾（提示词只说要标注「常量: 是」，没规定位置），
 * 内容区默认吞掉一切的话这条就静默失效了。
 * 刻意不含「内容」「注释」「备注」：它们出现在正文里更像正文而不是字段。
 */
const ENTRY_META_FIELDS = new Set([
    '关键词', '关键字', '触发词', '次要关键词', '次要关键字',
    '位置', '插入位置', '顺序', '优先级', '深度', '扫描深度',
    '常量', '常驻注入', '启用', '禁用', '概率', '使用概率',
    '组', '分组', '组权重', '组覆盖', '常驻', '粘性', '冷却', '延迟', '角色', '提示角色',
    '大小写敏感', '整词匹配', '忽略预算', '排除递归', '禁止递归', '递归延迟', '出口名',
]);

function valueShapeOk(key, value) {
    const shape = FIELD_VALUE_SHAPE[key];
    if (!shape) return value.length > 0;
    return VALUE_SHAPES[shape].test(value);
}

/**
 * @param {string} text 原始文本
 * @returns {{
 *   card: Record<string, {raw: string, bullets: string[]|null, lines: number[]}>,
 *   books: Array<{type: string, entries: Array<{name: string, fields: Record<string, {raw: string, bullets: string[]|null, lines: number[]}>}>}>,
 *   warnings: Array<{line: number, message: string}>,
 *   errors: Array<{line: number, message: string}>,
 * }}
 */
export function parse(text) {
    const ast = { card: {}, books: [], warnings: [], errors: [] };
    const lines = text.split(/\r?\n/);

    let state = 'OUTSIDE'; // OUTSIDE | CARD | BOOK | ENTRY
    let currentBook = null;   // 当前书（含条目列表）
    let currentEntry = null;  // 当前条目
    let currentField = null;  // 当前正在累积的字段
    let contentMode = false;  // 条目内已见 内容: → 其后全部为内容

    const addWarning = (line, message) => ast.warnings.push({ line, message });
    const addError = (line, message) => ast.errors.push({ line, message });

    /** 无法归属到任何字段的文本：按当前状态给出可操作的告警，绝不静默丢弃 */
    const warnOrphan = (lineNo, line) => {
        const preview = line.trim().slice(0, 40);
        if (state === 'OUTSIDE') {
            addWarning(lineNo, `忽略区块外的文本：「${preview}」`);
        } else if (state === 'BOOK') {
            addWarning(lineNo, `忽略条目外的文本：「${preview}」（请用「### 条目：名称」开头）`);
        } else if (state === 'ENTRY') {
            addWarning(lineNo, `条目「${currentEntry?.name ?? ''}」内无法归属的文本：「${preview}」（请检查字段名或把它并入上一字段）`);
        } else {
            addWarning(lineNo, `角色卡区块内无法归属的文本：「${preview}」（前一行不是字段行？这段内容未写入角色卡）`);
        }
    };

    const startBlock = (type, lineNo) => {
        state = type === BLOCK_TYPES.CARD ? 'CARD' : 'BOOK';
        contentMode = false;
        currentField = null;
        currentEntry = null;
        currentBook = null;
        if (state === 'BOOK') {
            currentBook = { type, entries: [] };
            ast.books.push(currentBook);
        }
    };

    const startEntry = (name, lineNo) => {
        if (state === 'CARD') {
            addWarning(lineNo, `角色卡区块内出现世界书条目「${name}」，已按世界书处理`);
        }
        if (state === 'OUTSIDE' || state === 'CARD') {
            // 宽松处理：区块外/卡内出现条目 → 自动开一个世界书
            state = 'BOOK';
            currentBook = { type: BLOCK_TYPES.WORLD_BOOK, entries: [] };
            ast.books.push(currentBook);
        }
        currentEntry = { name, fields: {} };
        currentBook.entries.push(currentEntry);
        currentField = null;
        contentMode = false;
        state = 'ENTRY'; // 条目状态：激活内容模式（内容: 之后全部归内容）与条目级续行规则
    };

    const addField = (key, raw, lineNo) => {
        const target = currentEntry ? currentEntry.fields : ast.card;
        if (target[key] !== undefined) {
            // 自动承接的内容（auto）遇到后续显式「内容:」→ 合并而非覆盖（显式值在前）
            if (key === '内容' && target[key].auto) {
                target[key].raw = raw ? `${raw}\n${target[key].raw}` : target[key].raw;
                target[key].auto = false;
                target[key].lines.push(lineNo);
                currentField = key;
                if (currentEntry) contentMode = true;
                return;
            }
            addWarning(lineNo, `字段「${key}」重复定义，后者覆盖前者`);
        }
        target[key] = { raw, bullets: null, lines: [lineNo], auto: (key === '内容' && !!currentEntry) };
        currentField = key;
        if (currentEntry && key === '内容') {
            contentMode = true;
        }
    };

    /**
     * 追加续行。
     * raw 始终保留「逐字原文」（含 `- ` 前缀与空行），bullets 另存去掉记号的列表视图。
     * 之所以两者都存：raw 是写入角色卡时的唯一来源（保证不漏内容），
     * bullets 只是数组字段的便捷视图，不能被当成字段的全部值。
     */
    const appendContinuation = (text, lineNo) => {
        if (!currentField) return; // 不应发生
        const target = currentEntry ? currentEntry.fields : ast.card;
        const field = target[currentField];
        field.raw = field.raw ? `${field.raw}\n${text}` : text;
        const bullet = text.match(BULLET_RE);
        if (bullet && !contentMode) {
            (field.bullets = field.bullets ?? []).push(bullet[1]);
        }
        field.lines.push(lineNo);
    };

    /**
     * 内容区里的条目元数据字段行 → [key, value]，不是元数据字段就返回 null。
     * 这是宽松路径，所以三重保险：字段名已知 + 该字段尚未定义 + 值形状站得住脚。
     * 少了后两条，正文里一句「· 位置: 王宫地下」就会被当成字段而把内容吞掉。
     */
    const matchEntryMetaField = (line) => {
        if (!currentEntry) return null;
        const m = line.replace(LEAD_BULLET_RE, '').match(FIELD_RE);
        if (!m) return null;
        const key = m[1].trim();
        const value = m[2].trim().replace(/\s+#\s.*$/, '');
        if (!ENTRY_META_FIELDS.has(key)) return null;
        if (currentEntry.fields[key]) return null;
        if (!valueShapeOk(key, value)) return null;
        return [key, value];
    };

    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];
        const line = raw.trimEnd();

        // 1) 区块头
        let m = line.match(BLOCK_HEADER_RE) || line.match(BLOCK_HEADER_PLAIN_RE);
        if (m) {
            startBlock(BLOCK_TYPE_BY_NAME[m[1]], lineNo);
            continue;
        }

        // 2) 条目头
        m = line.match(ENTRY_HEADER_RE);
        if (m) {
            startEntry(m[1], lineNo);
            continue;
        }

        // 3) 内容模式（条目内 内容: 之后）：默认全部归入内容，直到下一个标题。
        //    例外：条目元数据字段行（真实 AI 输出把「· 常量: 是」写在条目末尾）。
        if (contentMode && state === 'ENTRY') {
            const meta = matchEntryMetaField(line);
            if (meta) {
                addField(meta[0], meta[1], lineNo);
                contentMode = false;
                continue;
            }
            appendContinuation(raw, lineNo);
            continue;
        }

        // 4) 注释：没有正在累积的字段时，`#` 开头行是注释；
        //    字段内只有「长文本字段」才把 `#` 行当 Markdown 标题保留（「## 核心规则」「## 角色备注」），
        //    短字段（名称/标签…）里的 `#` 行仍按注释丢弃。
        if (COMMENT_RE.test(line) && !(currentField && PROSE_FIELDS.has(currentField))) {
            continue;
        }

        // 5) 空行：字段内的空行是内容的一部分（段落/表格分隔），不结束字段累积。
        //    历史行为是「空行 → currentField = null」，会让下方所有正文被静默丢弃
        //    （AI 输出「系统提示: 首行 + ## 核心规则…」这类 Markdown 结构必踩）。
        if (line.trim() === '') {
            if (currentField) appendContinuation('', lineNo);
            continue;
        }

        // 6) 字段行（键: 值，且键为已知字段名）；允许「· 常量: 是」这种带项目符号的写法
        //    —— 带符号时值形状也要站得住脚，免得把正文里的「· 位置: 王宫地下」当字段
        m = line.match(FIELD_RE);
        if (m) {
            const key = m[1].trim();
            let matched = KNOWN_FIELDS.has(key) ? m : null;
            if (!matched && LEAD_BULLET_RE.test(line)) {
                const m2 = line.replace(LEAD_BULLET_RE, '').match(FIELD_RE);
                if (m2 && KNOWN_FIELDS.has(m2[1].trim()) && valueShapeOk(m2[1].trim(), m2[2].trim())) matched = m2;
            }
            // 未知键的冒号行：不是字段，而是上一字段的内容续行（保留而非丢弃）
            // 条目内且尚无「内容」时自动开一个「内容」字段承接，避免污染关键词等字段
            if (!matched) {
                if (state === 'ENTRY' && !contentMode && !currentEntry.fields['内容']) {
                    addField('内容', '', lineNo);
                }
                if (currentField) {
                    appendContinuation(line, lineNo);
                } else {
                    warnOrphan(lineNo, line);
                }
                continue;
            }

            const fieldKey = matched[1].trim();
            // 行内注释剥离：` # ...`（# 前须有空白，仅作用于字段首行值；内容区不受影响）
            let value = matched[2].trim().replace(/\s+#\s.*$/, '');
            if (state === 'OUTSIDE') {
                addError(lineNo, `区块外的字段「${fieldKey}」被忽略（请先写【角色卡】/【世界书】）`);
                continue;
            }
            if (state === 'BOOK' && !currentEntry) {
                addWarning(lineNo, `世界书区块内、条目外的字段「${fieldKey}」被忽略（请用「### 条目：名称」开头）`);
                continue;
            }
            addField(fieldKey, value, lineNo);
            continue;
        }

        // 7) 续行（缩进行或裸文本行）
        if (currentField) {
            // 条目内：关键词等字段之后的正文（含「· 」bullet、无冒号文本）自动归入「内容」，
            // 避免污染关键词；`- ` / `* ` 关键词列表仍归当前数组字段
            if (state === 'ENTRY' && !contentMode && !currentEntry.fields['内容']) {
                const isKeywordField = ['关键词', '关键字', '触发词', '次要关键词', '次要关键字'].includes(currentField);
                if (!(isKeywordField && BULLET_RE.test(line))) {
                    addField('内容', '', lineNo);
                }
            }
            appendContinuation(line, lineNo);
        } else {
            // 没有正在累积的字段：裸文本无法归属 → 告警（不再静默丢弃）
            warnOrphan(lineNo, line);
        }
    }

    // 收尾校验
    if (Object.keys(ast.card).length === 0 && ast.books.length === 0) {
        ast.errors.push({ line: 0, message: '未识别到任何区块（需要【角色卡】/【角色书】/【世界书】）' });
    }
    if (currentBook && currentBook.entries.length === 0) {
        addWarning(0, '存在空的【世界书/角色书】区块（没有条目）');
    }

    return ast;
}
