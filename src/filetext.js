/**
 * filetext.js — 从本地文本类文件提取纯文本（CardLore「导入素材」）
 *
 * 支持：
 *  - .txt / .md：UTF-8（含 BOM/UTF-16 BOM）优先，失败回退 GB18030（兼容中文 Windows 常见 GBK 编码）
 *  - .docx：复用 ST 自带解压库 public/lib/jszip.min.js（浏览器路径 /lib/jszip.min.js，v3.10.1），
 *    解出 word/document.xml 后用 DOMParser 抽取段落文本（w:p 分段、w:t 取字、w:tab/br/cr 还原，
 *    表格文本自然顺读）。插件自身不捆绑任何第三方依赖。
 *
 * 限制：.doc 老式二进制格式不支持（提示另存为 .docx）；单文件 20MB 上限；抽取文本 50 万字符截断。
 */

export const MAX_SOURCE_FILE_SIZE = 20 * 1024 * 1024; // 单文件上限 20MB
const MAX_TEXT_LENGTH = 500000;                       // 单文件抽取文本上限（超出截断）
const JSZIP_URL = '/lib/jszip.min.js';

let jszipPromise = null;

/**
 * 读取素材文件 → { name, text }
 * 不支持的扩展名 / 读取失败会 throw Error（带友好中文信息）。
 * @param {File} file
 * @returns {Promise<{name: string, text: string}>}
 */
export async function readSourceFile(file) {
    if (!file || typeof file.name !== 'string') throw new Error('未获取到文件');
    if (file.size > MAX_SOURCE_FILE_SIZE) {
        throw new Error(`「${file.name}」过大（>${Math.round(MAX_SOURCE_FILE_SIZE / 1024 / 1024)}MB），已忽略`);
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.docx')) {
        return { name: file.name, text: await readDocx(file) };
    }
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
        return { name: file.name, text: await readPlainText(file) };
    }
    throw new Error(`「${file.name}」不是支持的格式（仅支持 .txt / .md / .docx）`);
}

/** 判断文件扩展名是否受支持（供拖放/选择时快速过滤） */
export function isSupportedSourceFile(file) {
    return file && typeof file.name === 'string' && /\.(txt|md|docx)$/i.test(file.name);
}

async function readPlainText(file) {
    const buf = await file.arrayBuffer();
    return truncate(decodeBytes(buf));
}

/** 字节解码：BOM 优先 → UTF-8 严格 → GB18030（覆盖常见 GBK 中文 txt） */
function decodeBytes(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        // 非 UTF-8（常见 GBK/GB2312）→ 用浏览器原生 gb18030 解码（GBK 是其子集）
        return new TextDecoder('gb18030').decode(bytes);
    }
}

async function readDocx(file) {
    const zip = await loadJSZip();
    let archive;
    try {
        archive = await zip.loadAsync(await file.arrayBuffer());
    } catch (err) {
        throw new Error(`「${file.name}」不是有效的 .docx 文件（${err?.message || err}）`);
    }
    const entry = archive.file('word/document.xml');
    if (!entry) {
        throw new Error(`「${file.name}」缺少 word/document.xml，不是标准 .docx（.doc 旧格式请先在 Word 中另存为 .docx）`);
    }
    const xml = await entry.async('string');
    return truncate(docxXmlToText(xml, file.name));
}

/** 动态加载 ST 自带 JSZip（UMD，执行后挂到 window.JSZip）；只加载一次，失败允许重试 */
async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    if (!jszipPromise) {
        jszipPromise = import(JSZIP_URL)
            .then(() => {
                if (!window.JSZip) throw new Error('JSZip 加载后未就绪');
                return window.JSZip;
            })
            .catch((err) => {
                jszipPromise = null; // 允许下次重试
                throw new Error(`无法加载解压库（${JSZIP_URL}）：${err?.message || err}`);
            });
    }
    return jszipPromise;
}

/** 从 word/document.xml 抽取纯文本（命名空间无关：适配不同 OOXML 前缀） */
function docxXmlToText(xmlString, fileName) {
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    } catch (err) {
        throw new Error(`「${fileName}」内容解析失败：${err?.message || err}`);
    }
    const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc;
    const paragraphs = body.getElementsByTagNameNS('*', 'p');
    const lines = [];
    for (const p of paragraphs) {
        if (!p || p.localName !== 'p') continue;
        let line = '';
        // SHOW_ELEMENT = 1；按文档顺序走 p 子树，w:t 取字、w:tab→制表、w:br/w:cr→换行
        const walker = doc.createTreeWalker(p, 1);
        let node = walker.nextNode();
        while (node) {
            const local = node.localName;
            if (local === 't' || local === 'delText') line += node.textContent || '';
            else if (local === 'tab') line += '\t';
            else if (local === 'br' || local === 'cr') line += '\n';
            node = walker.nextNode();
        }
        lines.push(line.trimEnd());
    }
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error(`「${fileName}」中未提取到文字内容`);
    return text;
}

function truncate(text) {
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return `${text.slice(0, MAX_TEXT_LENGTH)}\n\n[内容过长，已截断，仅保留前 ${MAX_TEXT_LENGTH} 字符]`;
}
