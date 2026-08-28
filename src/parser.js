/**
 * parser.js — 「特定格式」文本 → AST 的确定性解析器
 *
 * 纯函数、零依赖、可在浏览器与 Node 中复用。
 * （与 prototype/parser.js 同源，随插件分发）
 *
 * 格式规则（与方案文档 §3 一致）：
 *  - 顶层区块： 【角色卡】 / 【角色书】 / 【世界书】 （兼容 [角色卡] / # 角色卡）
 *  - 字段行：   键: 值  （顶格、键≤40字符、兼容全角冒号）
 *  - 多行值：   后续行以 ≥1 空格缩进，或为无冒号的裸文本行，直到下一个字段/标题
 *  - 数组值：   `- 项` 或 `* 项` 的 bullet 列表；或 `; , 、` 分隔（由 builder 拆分）
 *  - 世界书条目： `### 条目：名称` （兼容 ## / - 前缀）
 *  - 内容字段： 条目内一旦出现 `内容:`，其后所有非标题行（含冒号/#/空行）都属于内容
 *  - 注释：    `#` 开头行在非内容模式下视为注释
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

    const appendContinuation = (text, lineNo) => {
        if (!currentField) return; // 不应发生
        const target = currentEntry ? currentEntry.fields : ast.card;
        const field = target[currentField];
        const bullet = text.match(BULLET_RE);
        if (bullet && !contentMode) {
            // 内容模式下 bullet 视为正文
            (field.bullets = field.bullets ?? []).push(bullet[1]);
        } else {
            field.raw = field.raw ? `${field.raw}\n${text}` : text;
        }
        field.lines.push(lineNo);
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

        // 3) 内容模式（条目内 内容: 之后）：全部归入内容，直到下一个标题
        if (contentMode && state === 'ENTRY') {
            appendContinuation(raw, lineNo);
            continue;
        }

        // 4) 注释
        if (COMMENT_RE.test(line)) {
            continue;
        }

        // 5) 空行：结束当前字段的多行累积（非内容模式）
        if (line.trim() === '') {
            currentField = null;
            continue;
        }

        // 6) 字段行（顶格 键: 值，且键为已知字段名）
        m = line.match(FIELD_RE);
        if (m) {
            const key = m[1].trim();
            // 未知键的冒号行：不是字段，而是上一字段的内容续行（保留而非丢弃）
            // 条目内且尚无「内容」时自动开一个「内容」字段承接，避免污染关键词等字段
            if (!KNOWN_FIELDS.has(key)) {
                if (state === 'ENTRY' && !contentMode && !currentEntry.fields['内容']) {
                    addField('内容', '', lineNo);
                }
                if (currentField) {
                    appendContinuation(line, lineNo);
                } else if (state === 'OUTSIDE') {
                    addWarning(lineNo, `忽略区块外的文本：「${line.slice(0, 40)}」`);
                } else if (state === 'BOOK') {
                    addWarning(lineNo, `忽略条目外的文本：「${line.slice(0, 40)}」（请用「### 条目：名称」开头）`);
                }
                // state === 'CARD' 且无当前字段：无法归属，忽略
                continue;
            }

            // 行内注释剥离：` # ...`（# 前须有空白，仅作用于字段首行值；内容区不受影响）
            let value = m[2].trim().replace(/\s+#\s.*$/, '');
            if (state === 'OUTSIDE') {
                addError(lineNo, `区块外的字段「${key}」被忽略（请先写【角色卡】/【世界书】）`);
                continue;
            }
            if (state === 'BOOK' && !currentEntry) {
                addWarning(lineNo, `世界书区块内、条目外的字段「${key}」被忽略（请用「### 条目：名称」开头）`);
                continue;
            }
            addField(key, value, lineNo);
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
        } else if (state === 'OUTSIDE') {
            addWarning(lineNo, `忽略区块外的文本：「${line.slice(0, 40)}」`);
        } else if (state === 'BOOK') {
            addWarning(lineNo, `忽略条目外的文本：「${line.slice(0, 40)}」（请用「### 条目：名称」开头）`);
        }
        // state === 'CARD' 且无当前字段：裸文本无法归属 → 忽略
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
