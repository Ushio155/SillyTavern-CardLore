/**
 * fidelity.js —— 解析保真自检：输入文本的每一行，是否都真的落进了角色卡/世界书？
 *
 * 起因：`系统提示: 首行` + 空行 + `## 核心规则…` 这类 Markdown 结构，
 * 曾因「空行结束字段」被腰斩，而后续行「不是字段行、也不是裸文本可归属」就被静默丢弃，
 * 用户只能从写出来的卡里自己发现少了内容。此模块把「丢了内容」变成一条显式告警。
 *
 * 纯函数、零依赖，可在浏览器与 Node 中复用。
 */

/** 区块头行：解析时被消费掉，不参与「内容落位」检查 */
const BLOCK_HEADER_LINE_RE = /^\s*(?:#{1,4}\s*)?[【\[]\s*(角色卡|角色书|世界书)\s*[】\]]\s*$/;

/** 只转成 ST 参数、不需要出现在正文里的字段名 */
export const CONTROL_FIELD_NAMES = new Set([
    '位置', '插入位置', '顺序', '优先级', '深度', '扫描深度', '常量', '常驻注入', '启用', '禁用',
    '概率', '使用概率', '组', '分组', '组权重', '组覆盖', '常驻', '粘性', '冷却', '延迟',
    '角色', '提示角色', '大小写敏感', '整词匹配', '忽略预算', '排除递归', '禁止递归', '递归延迟',
    '出口名', '话痨度', '版本', '角色版本', '深度提示深度', '提示深度', '深度提示角色',
    '次要关键词', '次要关键字',
]);

/** 正文类字段名（其后紧跟的值属于内容，要到结果里找） */
export const CONTENT_FIELD_NAMES = new Set([
    '名称', '姓名', '标签', '描述', '人格', '性格', '开场白', '首条消息', '开场节点', '替代开场白', '备用开场白',
    '示例对话', '对话示例', '场景', '世界观场景', '系统提示', '系统提示词', '深度提示', '深度提示词', '作者注',
    '创作者笔记', '备注', '关键词', '关键字', '触发词', '内容', '注释', '高频行为', '行为', '角色备注',
    '核心规则', '特别指令', '世界', '关联世界书', '关联书',
]);

/** 比对用的归一化：忽略分隔符、Markdown 记号与所有空白（换行/缩进差异不算内容差异） */
const COMPARE_STRIP_RE = /[、，；;|｜,*`]/g;
export const normalizeForCompare = (s) => String(s ?? '').replace(COMPARE_STRIP_RE, '').replace(/\s+/g, '');

/**
 * 把解析结果拼成「可搜索的正文」。
 * @param {string[]} parts
 */
export function buildOutputText(parts) {
    return normalizeForCompare(parts.filter(Boolean).join('\n'));
}

/**
 * 找出「没落位」的输入行。
 * @param {string} text 输入文本
 * @param {string} outputText 归一化后的解析结果正文（见 buildOutputText）
 * @returns {{line: number, snippet: string, chars: number}[]}
 */
export function collectMissingLines(text, outputText) {
    const haystack = normalizeForCompare(outputText);
    const missing = [];
    const lines = String(text ?? '').split(/\r?\n/);

    lines.forEach((rawLine, idx) => {
        const trimmed = rawLine.trim();
        if (!trimmed || BLOCK_HEADER_LINE_RE.test(trimmed)) return;

        // 去掉行首记号（#、-、*、·、|）与「条目：」前缀，再剥掉「已知字段名:」前缀
        let body = trimmed.replace(/^[#>+\-*•·|\s]+/, '').replace(/^条目\s*[:：]\s*/, '');
        const m = body.match(/^([^\s:：][^:：]{0,20}?)\s*[:：]\s*(.*)$/);
        if (m) {
            const key = m[1].trim();
            if (CONTROL_FIELD_NAMES.has(key)) return;
            if (CONTENT_FIELD_NAMES.has(key)) body = m[2];
        }

        // 按分隔符/空白切成小段逐段比对：字段标签、列表记号、全角半角分隔符差异都不算丢失
        const segments = body.replace(COMPARE_STRIP_RE, ' ').split(/\s+/)
            .map(normalizeForCompare).filter(s => s.length >= 4);
        for (const seg of segments) {
            if (!haystack.includes(seg)) {
                missing.push({ line: idx + 1, snippet: seg.slice(0, 30), chars: seg.length });
                break; // 一行只报一次
            }
        }
    });

    return missing;
}

/**
 * 是否需要就此提示用户（少量注释行/格式差异不该打扰）。
 * @param {{chars: number}[]} missing
 * @param {string} text
 */
export function isFidelityAlarm(missing, text) {
    if (!missing.length) return false;
    const missingChars = missing.reduce((n, m) => n + m.chars, 0);
    const inputChars = normalizeForCompare(text).length || 1;
    return missingChars / inputChars >= 0.03;
}
