/**
 * index.js — CardLore 角色卡·世界书生成器（SillyTavern 1.18.0 第三方扩展入口）
 *
 * 功能：
 *  - 「新建角色」左侧「一键生成」按钮 + 「扩展程序」菜单图标 → 打开生成器弹窗
 *  - 「AI 适配」按钮（解析预览左侧）：通过 OpenAI 兼容接口把任意原始文本整理成插件格式
 *  - 粘贴「特定格式」文本 → 解析预览（角色卡字段 / 世界书条目 / 校验报告）
 *  - 一键应用：保存独立世界书 + 导入角色卡（含 extensions.world 绑定）
 *  - 导出 JSON（角色卡 V2 / 世界书）
 */
import { selectCharacterById, saveSettingsDebounced } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { escapeHtml } from '../../../utils.js';
import { parse } from './src/parser.js';
import { buildCard, buildBook } from './src/builder.js';
import { applyToST, downloadJson } from './src/writer.js';
import { readSourceFile, isSupportedSourceFile, MAX_SOURCE_FILE_SIZE } from './src/filetext.js';

const MODULE_NAME = 'CardLore';

const DEFAULT_SETTINGS = {
    bookNameSuffix: '的世界书',
    confirmBeforeCreate: true,
};

/** AI 适配默认提示词 v6：完整性优先、禁止缩略；开场节点拆分为可选开局、角色备注→深度提示、核心规则仅入系统提示 */
const DEFAULT_AI_PROMPT = `你是专业 SillyTavern 角色卡格式转换助手（风格参照角色卡设计师"卡缔"）。你的唯一任务：把用户提供的原始设定文本（任意格式：完整角色卡、设定文档、小说片段、对话剧本等），完整转换为下面这种固定格式。输出严格遵循模板，信息量 100% 保留，禁止任何缩略。

【角色卡】
名称: 角色名
标签: 类型1、类型2
描述: 角色背景与外貌性格概述（含高频行为）
人格: 性格特质
开场白: 角色初见用户时的开场场景（第一个开场节点）
替代开场白: 其余开场节点（每行一条，用"- "前缀）
示例对话: <START>
  角色名: 台词
  用户: 台词
场景: 故事发生的时间地点
系统提示: 扮演该角色的系统提示（含核心规则、特别指令，逐字保留）
深度提示: 角色备注（高级定义内容）
作者注: 备注

【世界书】
### 条目：设定名
关键词: 关键词1; 关键词2
位置: before_char
顺序: 100
内容: 该条设定的详细说明

【区块映射规则】（必须严格执行，禁止输出【角色书】区块）
1. 原文的【开场节点】/开场场景内容 → 第一个节点**逐字**填入「开场白」字段；其余节点（节点二、节点三……）逐条**逐字**填入「替代开场白」（每条一行，以"- "开头）。所有节点（含节点标题、场景背景简述、玩家处境）必须全部保留，禁止省略、禁止截断、禁止合并；输出后自检节点数量，若少于原文即为失败，必须补全。
2. 原文的角色描述 + 【高频行为】→ 合并写入「描述」字段；高频行为逐条用"· "**逐字**列出完整保留，禁止删减、禁止概括。
3. 原文的扮演规则/【核心规则】（如"从现在起，你是……只扮演……"及所有编号规则）→ **只**写入「系统提示」字段，逐字保留，禁止概括、禁止只保留要点；**不得写入「描述」**。
4. 原文的【角色备注】/【系统数值备注】等高级定义内容 → **逐字**写入「深度提示」（Character's Note，位于情景下方的深度/角色区）字段，完整保留；**禁止写入「描述」或「作者注」**。
5. 原文的【特别指令】（OOC、重置剧情等）→ **逐字**填入「系统提示」末尾，禁止改写、禁止省略。
6. 原文的【对话示例】→ 填入「示例对话」字段，<START> 分隔，逐字完整保留。
7. 名词性设定（组织、地点、物品、人物、事件、能力、系统规则等）→ 【世界书】条目，条目必须带标题「### 条目：名称」；数值系统设专条并标注「常量: 是」。
8. 转换结果中禁止出现【角色书】区块；所有内容只允许落入【角色卡】字段或【世界书】条目。

【绝对输出规则】（严格遵守，全部必须满足）
1. 只输出转换结果本身，禁止"好的""明白了""以下是转换结果"等任何开场白、结束语、分析过程或额外解释。
2. 输出长度不受限制：禁止为了控制 Token 而压缩、概括、合并或删减内容（转换任务与"生成新卡"不同，长度不限，完整性第一）。
3. 原文全部信息逐条完整保留：所有规则、数值、系统、特别指令、开场节点、对话示例、条目内容一行都不能少，不得用"等""……"省略；【核心规则】【特别指令】【高频行为】【角色备注】【开场节点】等板块必须**逐字**保留原文表述，禁止概括为要点式短句。
4. 玩家与目标角色指代原样保留（如 {{user}}、你、原文人名），不得改名、不得用泛指替代。
5. 世界书条目要丰富：每个条目「内容」用"· "子要点展开，至少包含 2-3 种场景展开或条件分支（如：若对方配合/若对方搭话/若对方主动接触），原文已有的分支细节全部保留；可补充分支但不得偏离原设定。
6. 对话示例用 <START> 分隔，原文的对话、动作、心声【】、数值展示完整保留，不截断。
7. 忠实转换，禁止编造与遗漏：原文没有的字段省略该行；原文已有的信息不得遗漏、不得改写核心设定（人名、数值、关系、情节节点、规则条件一律原样）。
8. 关键词用中文分号分隔，简明且覆盖常见叫法；「顺序」数值原样保留（默认100，权重更高则更大）。
9. 长内容用两个空格缩进续行完整写下，段落与"· "子要点全部保留，不总结、不缩写。
10. 保持原文风格与尺度，包括成人向、直白、露骨表述——不要因为内容尺度而委婉化、删减或净化。
11. 始终使用中文输出，不要输出代码块围栏。

参照样例（信息密度标准）：以《白衣天使的隐秘炽热》这类完整角色卡为参照——角色设定、核心规则、高频行为、特别指令、开场节点、高级定义、系统数值备注、对话示例、世界书条目等所有板块的内容 100% 保留，原文每一行设定都必须有对应落点。`;

/** 提示词版本号：升级默认提示词后 +1，已保存旧提示词的用户会自动迁移到新版 */
const DEFAULT_AI_PROMPT_VERSION = 6;

const DEFAULT_AI_SETTINGS = {
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5.4-nano',
    prompt: DEFAULT_AI_PROMPT,
    promptVersion: DEFAULT_AI_PROMPT_VERSION,
    /** 调用方式：'st' = 直接使用 ST「API 连接」（免填 Key）；'custom' = 用下面填写的自定义接口 */
    apiMode: '',
};

/** 「默认方案」名称：直接使用 ST「API 连接」里的模型与额度 */
const ST_PRESET_NAME = '默认方案';

/**
 * ST「API 连接」来源 → 展示名 / 模型字段名 / 默认接口地址。
 * 字段名与 ST public/scripts/openai.js 的 getChatCompletionModel() 保持一致；
 * 地址仅用于「自定义接口」模式的预填参考。
 */
const ST_SOURCES = {
    openai: { label: 'OpenAI', field: 'openai_model', url: 'https://api.openai.com/v1' },
    claude: { label: 'Claude', field: 'claude_model', url: 'https://api.anthropic.com' },
    makersuite: { label: 'Google AI Studio', field: 'google_model', url: 'https://generativelanguage.googleapis.com' },
    vertexai: { label: 'Vertex AI', field: 'vertexai_model', url: '' },
    openrouter: { label: 'OpenRouter', field: 'openrouter_model', url: 'https://openrouter.ai/api/v1' },
    ai21: { label: 'AI21', field: 'ai21_model', url: 'https://api.ai21.com/studio/v1' },
    mistralai: { label: 'MistralAI', field: 'mistralai_model', url: 'https://api.mistral.ai/v1' },
    custom: { label: '自定义（OpenAI 兼容）', field: 'custom_model', url: '' },
    cohere: { label: 'Cohere', field: 'cohere_model', url: 'https://api.cohere.com/v1' },
    perplexity: { label: 'Perplexity', field: 'perplexity_model', url: 'https://api.perplexity.ai' },
    groq: { label: 'Groq', field: 'groq_model', url: 'https://api.groq.com/openai/v1' },
    electronhub: { label: 'ElectronHub', field: 'electronhub_model', url: 'https://api.electronhub.ai/v1' },
    chutes: { label: 'Chutes', field: 'chutes_model', url: 'https://llm.chutes.ai/v1' },
    nanogpt: { label: 'NanoGPT', field: 'nanogpt_model', url: 'https://nano-gpt.com/api/v1' },
    deepseek: { label: 'DeepSeek', field: 'deepseek_model', url: 'https://api.deepseek.com' },
    aimlapi: { label: 'AIMLAPI', field: 'aimlapi_model', url: 'https://api.aimlapi.com/v1' },
    xai: { label: 'xAI（Grok）', field: 'xai_model', url: 'https://api.x.ai/v1' },
    pollinations: { label: 'Pollinations', field: 'pollinations_model', url: 'https://text.pollinations.ai/openai' },
    moonshot: { label: 'Moonshot（Kimi）', field: 'moonshot_model', url: 'https://api.moonshot.cn/v1' },
    fireworks: { label: 'Fireworks', field: 'fireworks_model', url: 'https://api.fireworks.ai/inference/v1' },
    cometapi: { label: 'CometAPI', field: 'cometapi_model', url: 'https://api.cometapi.com/v1' },
    azure_openai: { label: 'Azure OpenAI', field: 'azure_openai_model', url: '' },
    zai: { label: '智谱 GLM', field: 'zai_model', url: 'https://open.bigmodel.cn/api/paas/v4' },
    siliconflow: { label: '硅基流动 SiliconFlow', field: 'siliconflow_model', url: 'https://api.siliconflow.cn/v1' },
    minimax: { label: 'MiniMax', field: 'minimax_model', url: 'https://api.minimax.io/v1' },
    workers_ai: { label: 'Cloudflare Workers AI', field: 'workers_ai_model', url: '' },
};

/**
 * AI 接口预设方案（OpenAI 兼容），点击一键填入接口地址与模型。
 * 首项为「默认方案」：不填地址与 Key，直接借用 ST「API 连接」。
 * 各家 models[0] = 默认填入的当前最具性价比模型（2026-06 整理）。
 */
const AI_PRESETS = [
    { name: ST_PRESET_NAME, st: true, url: '', models: [], note: '借用 ST「API 连接」的模型与额度，免填地址和 Key（推荐）' },
    { name: 'DeepSeek', url: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-flash'], note: '官方直连，flash 最便宜' },
    { name: 'OpenAI', url: 'https://api.openai.com/v1', models: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'], note: '官方接口，nano 最便宜' },
    { name: 'Moonshot（Kimi）', url: 'https://api.moonshot.cn/v1', models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'kimi-latest'], note: '国内直连，turbo 性价比高' },
    { name: '阿里云百炼（通义千问）', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-flash', 'qwen3.5-flash', 'qwen-plus'], note: '阿里云兼容端点，flash 有免费额度' },
    { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.7-flash', 'glm-4.6', 'glm-4.5-air'], note: '国内直连，glm-4.7-flash 免费' },
    { name: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V3.2-Exp', 'Qwen/Qwen3-30B-A3B-Instruct-2507'], note: '聚合多家开源模型，部分免费' },
    { name: 'Groq', url: 'https://api.groq.com/openai/v1', models: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'], note: '极速推理，有免费额度' },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash:free', 'openai/gpt-oss-20b'], note: '聚合平台，:free 后缀为免费版' },
    { name: '本地 Ollama', url: 'http://localhost:11434/v1', models: ['qwen3:8b', 'llama3.1'], note: '本机免费，需先安装 Ollama' },
];

/** 通过 ST 内置请求服务调用时，请求的最大输出 token 数（转换任务输出较长） */
const ST_MAX_OUTPUT_TOKENS = 8192;

/**
 * 读取 ST「API 连接」当前使用的来源与模型。
 * @returns {{source: string, label: string, model: string, url: string, ok: boolean}}
 */
function stConnectionInfo() {
    const source = String(oai_settings?.chat_completion_source || '');
    const meta = ST_SOURCES[source];
    let model = meta ? String(oai_settings?.[meta.field] || '') : '';
    // OpenRouter 选了「使用网站」时没有固定模型名
    if (source === 'openrouter' && model === 'OR_Website') model = '';
    const url = source === 'custom' ? String(oai_settings?.custom_url || '') : (meta?.url || '');
    return {
        source,
        label: meta?.label || source || '未选择',
        model,
        url,
        ok: Boolean(source && model),
    };
}

const SAMPLE_TEXT = `【角色卡】
名称: 林晚
标签: 武侠、江湖、剑客
版本: 1.0.0
描述: 青冥剑主，天机阁首席剑客，人称"月下青冥"。
  面冷心热，信奉"剑不轻出，出必见血"。
人格: 冷静克制、重诺守约、轻微毒舌
开场白: 月光下，你撞见了她拭剑的身影。"阁中弟子？报上名来。"
示例对话: <START>
  林晚: 剑指的不是人，是人心。
  你: 那你的剑，现在指着什么？
  林晚: 天机阁的规矩。你越界了。
场景: 深夜，青云峰顶，天机阁后山的剑坪。

【世界书】
### 条目：青冥剑
关键词: 青冥剑; 青冥; 名剑之首
位置: before_char
顺序: 120
内容: 上古名剑，剑身泛青，出鞘有龙吟。认主林晚。

### 条目：天机阁
关键词: 天机阁; 阁主
常量: 是
内容: 武林最神秘的情报组织，楼阁悬于青云峰绝壁。
  阁中弟子以星位为号。`;

/** 最近一次「解析+构建」结果 */
let lastResult = null;
/** 应用按钮防误触：arm 状态 */
let applyArmed = false;
/** 「导入素材」已添加的文件（含抽取文本，与输入框文本合并参与解析/AI 适配） */
let materials = [];
/** 素材数量上限 */
const MAX_MATERIALS = 20;
/** 一次性的「AI 适配完成」提示（由 onAiConvert 写入、onParse 显示后清除） */
let lastAiNote = '';

jQuery(async function () {
    const settings = (extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {});
    Object.assign(settings, DEFAULT_SETTINGS, settings);
    settings.ai = Object.assign({}, DEFAULT_AI_SETTINGS, settings.ai || {});
    // 默认提示词升级迁移：版本号不一致时用新版默认提示词覆盖（用户自定义的会随「重置默认提示词」找回）
    if (settings.ai.promptVersion !== DEFAULT_AI_PROMPT_VERSION) {
        settings.ai.prompt = DEFAULT_AI_PROMPT;
        settings.ai.promptVersion = DEFAULT_AI_PROMPT_VERSION;
    }
    // 预填「自定义接口」模式的地址与模型：取自 ST「API 连接」当前来源，最后兜底到默认值。
    // 注意：这只是给「自定义接口」模式做参考预填，不影响「默认方案」（调用时实时读取 ST 设置）
    const stConn = stConnectionInfo();
    if (!settings.ai.apiUrl) {
        settings.ai.apiUrl = stConn.url
            || String(oai_settings?.custom_url || '')
            || String(oai_settings?.reverse_proxy || '')
            || DEFAULT_AI_SETTINGS.apiUrl;
    }
    if (!settings.ai.model) {
        settings.ai.model = stConn.model || DEFAULT_AI_SETTINGS.model;
    }
    // 调用方式：首次使用（还没保存过）时，只要 ST「API 连接」可用就用「默认方案」
    if (settings.ai.apiMode !== 'st' && settings.ai.apiMode !== 'custom') {
        settings.ai.apiMode = (stConn.ok && !settings.ai.apiKey) ? 'st' : 'custom';
    }

    addQuickCreateButton();
    addWandMenuButton();
    addSettingsBlock();
});

/* ---------------- 入口 UI ---------------- */

/**
 * 「新建角色」按钮（#rm_button_create）左侧的一键生成入口。
 * 悬停 title 提示「一键生成」；点击打开生成器弹窗。
 */
function addQuickCreateButton() {
    const $btn = $(
        '<div id="cardlore_quick_button" class="menu_button fa-solid fa-wand-magic-sparkles" ' +
        'title="一键生成" data-i18n="[title]一键生成"></div>',
    );
    $('#rm_button_create').before($btn);
    $btn.on('click', openPopup);
}

/**
 * 在「扩展程序」菜单（#extensionsMenu，魔法棒下拉）中挂一个图标入口。
 * #extensionsMenu 由 ST 的 addExtensionsButtonAndMenu() 注入，可能在扩展加载后才出现，
 * 故用轮询等待；ST 侧 menuInterval 每秒检查菜单可见项并自动显示魔法棒按钮。
 */
function addWandMenuButton() {
    const tryInject = () => {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('cardlore_wand_container')) return false;

        const container = document.createElement('div');
        container.id = 'cardlore_wand_container';
        container.classList.add('extension_container');

        const icon = document.createElement('div');
        icon.className = 'fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton';
        icon.title = 'CardLore 角色卡·世界书生成器';
        icon.dataset.i18n = '[title]CardLore 角色卡·世界书生成器';
        icon.addEventListener('click', openPopup);

        container.appendChild(icon);
        menu.appendChild(container);
        return true;
    };

    if (tryInject()) return;
    const timer = setInterval(() => {
        if (tryInject()) clearInterval(timer);
    }, 500);
}

function addSettingsBlock() {
    const settings = extension_settings[MODULE_NAME];
    const html = `
        <div id="cardlore_container" class="extension_container">
            <div class="inline-drawer" id="cardlore_settings_drawer">
                <div class="inline-drawer-toggle inline-drawer-header" id="cardlore_settings_toggle">
                    <span class="flex-container alignItemsCenter flexGap5 flexGrow">
                        <b data-i18n="CardLore：角色卡·世界书生成器">CardLore：角色卡·世界书生成器</b>
                        <button id="cardlore_quick_create" type="button" class="menu_button menu_button_icon" title="一键生成角色卡与世界书">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span data-i18n="一键生成">一键生成</span>
                        </button>
                    </span>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <small data-i18n="粘贴「特定格式」文本，自动识别区块生成角色卡与世界书。">粘贴「特定格式」文本，自动识别区块生成角色卡与世界书。</small>
                    <label class="checkbox_label flex-container" for="cardlore_confirm_create">
                        <input id="cardlore_confirm_create" type="checkbox">
                        <span data-i18n="应用前二次确认">应用前二次确认</span>
                    </label>
                    <div class="flex-container flexGap5 alignItemsCenter">
                        <label for="cardlore_book_suffix" data-i18n="世界书命名后缀">世界书命名后缀</label>
                        <input id="cardlore_book_suffix" type="text" class="text_pole widthNatural" value="${escapeHtml(settings.bookNameSuffix)}">
                    </div>
                </div>
            </div>
        </div>`;
    $('#extensions_settings').append(html);

    // 「一键生成」：标题栏内始终可见，点击直接打开生成器，且不触发展开/收起
    $('#cardlore_quick_create').on('click', function (e) {
        e.stopPropagation();
        openPopup();
    });

    $('#cardlore_confirm_create').prop('checked', settings.confirmBeforeCreate).on('change', function () {
        settings.confirmBeforeCreate = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#cardlore_book_suffix').on('input', function () {
        settings.bookNameSuffix = String($(this).val() || '');
        saveSettingsDebounced();
    });
}

/* ---------------- 弹窗 ---------------- */

function openPopup() {
    const existing = $('#cardlore_popup');
    if (existing.length) {
        existing.show();
        // 「默认方案」展示的是 ST「API 连接」实时状态，每次打开都刷新一遍
        $('#cardlore_ai_presets_body').html(renderPresetsHtml());
        applyAiMode(extension_settings[MODULE_NAME].ai.apiMode === 'custom' ? 'custom' : 'st', { save: false, announce: false });
        return;
    }

    const popup = $(`
        <div id="cardlore_popup" class="cardlore_popup">
            <div class="cardlore_panel">
                <div class="cardlore_header">
                    <span><i class="fa-solid fa-wand-magic-sparkles"></i>&nbsp;CardLore 角色卡·世界书生成器</span>
                    <span id="cardlore_close" class="cardlore_close fa-solid fa-xmark" title="关闭"></span>
                </div>
                <div class="cardlore_body">
                    <div class="cardlore_hint">
                        粘贴「特定格式」文本（【角色卡】/【世界书】/【角色书】区块 + 键: 值 + ### 条目：名称）。
                        <a id="cardlore_load_sample" href="javascript:void(0)">载入示例</a>
                        <span class="cardlore_hint_sep">｜</span>
                        <a id="cardlore_import_material" class="cardlore_import_link" href="javascript:void(0)" title="支持 .txt/.md/.docx，可多选；素材与输入框文本合并参与「解析预览」与「AI 适配」">导入素材</a>
                    </div>
                    <div class="cardlore_input_wrap">
                        <textarea id="cardlore_input" class="text_pole cardlore_input" placeholder="在此粘贴角色设定文本，或输入设定文本进行「AI适配」…"></textarea>
                        <div id="cardlore_expand" class="menu_button cardlore_expand" title="展开全屏编辑" data-i18n="[title]展开全屏编辑"><i class="fa-solid fa-expand"></i>&nbsp;展开</div>
                    </div>
                    <div id="cardlore_materials" class="cardlore_materials" style="display:none;"></div>
                    <div class="cardlore_toolbar">
                        <div id="cardlore_ai" class="menu_button"><i class="fa-solid fa-robot"></i>&nbsp;AI 适配</div>
                        <div id="cardlore_parse" class="menu_button">解析预览</div>
                        <div id="cardlore_apply" class="menu_button menu_button_primary">应用：创建角色+世界书</div>
                        <div id="cardlore_export" class="menu_button">导出 JSON</div>
                        <div id="cardlore_clear" class="menu_button"><i class="fa-solid fa-eraser"></i>&nbsp;清空预览</div>
                    </div>
                    <div class="cardlore_ai_settings">
                        <div id="cardlore_ai_toggle" class="cardlore_ai_toggle"><i class="fa-solid fa-gear"></i>&nbsp;AI 接口设置（可折叠）<span id="cardlore_ai_mode_badge" class="cardlore_ai_mode_badge"></span></div>
                        <div id="cardlore_ai_settings_body" class="cardlore_ai_settings_body" style="display: none;">
                            <div class="cardlore_ai_presets">
                                <div id="cardlore_ai_presets_toggle" class="cardlore_ai_presets_toggle"><i class="fa-solid fa-list"></i>&nbsp;预设方案（点击展开，一键填入地址与模型）</div>
                                <div id="cardlore_ai_presets_body" class="cardlore_ai_presets_body" style="display: none;"></div>
                            </div>
                            <div class="cardlore_ai_mode">
                                <span class="cardlore_ai_mode_label">调用方式</span>
                                <div class="cardlore_ai_mode_row">
                                    <div id="cardlore_ai_mode_st" class="menu_button cardlore_ai_mode_btn" title="免填接口地址与 Key，直接使用 ST「API 连接」里的模型与额度">使用 ST 当前连接</div>
                                    <div id="cardlore_ai_mode_custom" class="menu_button cardlore_ai_mode_btn" title="自己填写 OpenAI 兼容接口地址、Key 与模型">自定义接口</div>
                                </div>
                                <div id="cardlore_ai_st_hint" class="cardlore_ai_st_hint"></div>
                            </div>
                            <div class="cardlore_ai_custom_row flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_url">接口地址</label>
                                <input id="cardlore_ai_url" type="text" class="text_pole flex1" placeholder="自定义 OpenAI 兼容地址（自动补 /chat/completions）">
                            </div>
                            <div class="cardlore_ai_custom_row flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_key">API Key</label>
                                <input id="cardlore_ai_key" type="password" class="text_pole flex1" placeholder="sk-…（可留空）">
                            </div>
                            <div class="cardlore_ai_custom_row flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_model">模型</label>
                                <input id="cardlore_ai_model" type="text" class="text_pole flex1" placeholder="gpt-5.4-nano">
                            </div>
                            <label for="cardlore_ai_prompt">提示词（AI 适配格式用，可自行修改）</label>
                            <textarea id="cardlore_ai_prompt" class="text_pole cardlore_ai_prompt"></textarea>
                            <div class="cardlore_toolbar">
                                <div id="cardlore_ai_save" class="menu_button">保存设置</div>
                                <div id="cardlore_ai_reset" class="menu_button">重置默认提示词</div>
                            </div>
                        </div>
                    </div>
                    <div id="cardlore_status" class="cardlore_status"></div>
                    <div id="cardlore_preview" class="cardlore_preview"></div>
                </div>
            </div>
            <div id="cardlore_expand_overlay" class="cardlore_expand_overlay" style="display:none;">
                <div class="cardlore_expand_header">
                    <span class="cardlore_expand_title"><i class="fa-solid fa-expand"></i>&nbsp;原始文本 · 全屏编辑</span>
                    <div class="cardlore_expand_actions">
                        <div id="cardlore_expand_parse" class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i>&nbsp;解析预览</div>
                        <div id="cardlore_expand_close" class="menu_button menu_button_primary">完成</div>
                    </div>
                </div>
                <textarea id="cardlore_expand_input" class="cardlore_expand_input" placeholder="在此编辑原始文本…"></textarea>
            </div>
        </div>`);
    $('body').append(popup);

    $('#cardlore_close').on('click', () => popup.hide());
    popup.on('click', function (e) {
        if (e.target === this) popup.hide(); // 点击遮罩关闭
    });
    $('#cardlore_load_sample').on('click', () => {
        $('#cardlore_input').val(SAMPLE_TEXT);
        setStatus('已载入示例文本，点击「解析预览」。', 'info');
    });
    $('#cardlore_import_material').on('click', openImportPopup);
    // 已添加素材 chips：点 × 移除
    $('#cardlore_materials').on('click', '.cardlore_material_rm', function () {
        const i = Number($(this).attr('data-i'));
        if (!Number.isInteger(i) || i < 0 || i >= materials.length) return;
        materials.splice(i, 1);
        reRenderMaterials();
        setStatus(materials.length ? `已移除素材，剩余 ${materials.length} 个。` : '已移除素材。', 'info');
    });
    $('#cardlore_ai').on('click', onAiConvert);
    $('#cardlore_parse').on('click', onParse);
    $('#cardlore_apply').on('click', onApply);
    $('#cardlore_export').on('click', onExport);
    $('#cardlore_clear').on('click', onClearPreview);

    // 展开全屏编辑：打开时同步文本，编辑实时写回主输入框，Esc / 「完成」收起
    const $expandOverlay = $('#cardlore_expand_overlay');
    const $expandInput = $('#cardlore_expand_input');
    const openExpandEditor = () => {
        $expandInput.val($('#cardlore_input').val());
        $expandOverlay.show();
        $expandInput.focus();
    };
    const closeExpandEditor = () => {
        $('#cardlore_input').val($expandInput.val());
        $expandOverlay.hide();
    };
    $('#cardlore_expand').on('click', openExpandEditor);
    $('#cardlore_expand_close').on('click', closeExpandEditor);
    $('#cardlore_expand_parse').on('click', () => {
        $('#cardlore_input').val($expandInput.val());
        onParse();
        closeExpandEditor(); // 解析完自动收起，回到弹窗查看预览
    });
    $expandInput.on('input', () => $('#cardlore_input').val($expandInput.val()));
    $(document).on('keydown.cardloreExpand', e => {
        if (e.key === 'Escape' && $expandOverlay.is(':visible')) closeExpandEditor();
    });

    // AI 设置回填与交互
    const ai = extension_settings[MODULE_NAME].ai;
    $('#cardlore_ai_url').val(ai.apiUrl);
    $('#cardlore_ai_key').val(ai.apiKey);
    $('#cardlore_ai_model').val(ai.model);
    $('#cardlore_ai_prompt').val(ai.prompt);
    $('#cardlore_ai_toggle').on('click', () => $('#cardlore_ai_settings_body').slideToggle(200));
    $('#cardlore_ai_save').on('click', saveAiSettings);
    $('#cardlore_ai_reset').on('click', resetAiPrompt);

    // 预设方案 + 调用方式：渲染 + 展开折叠 + 一键填入
    $('#cardlore_ai_presets_body').html(renderPresetsHtml());
    $('#cardlore_ai_presets_toggle').on('click', () => $('#cardlore_ai_presets_body').slideToggle(200));
    $('#cardlore_ai_mode_st').on('click', () => applyAiMode('st'));
    $('#cardlore_ai_mode_custom').on('click', () => applyAiMode('custom'));
    applyAiMode(ai.apiMode === 'custom' ? 'custom' : 'st', { save: false, announce: false });
    $('#cardlore_ai_presets_body').on('click', '.cardlore_ai_preset_use', function () {
        const presetName = $(this).closest('.cardlore_ai_preset').attr('data-preset');
        const preset = AI_PRESETS.find(p => p.name === presetName);
        if (!preset) return;
        if (preset.st) {
            applyAiMode('st', { announce: false });
            const info = stConnectionInfo();
            if (info.model) $('#cardlore_ai_model').val(info.model);
            setStatus(info.ok
                ? `「${ST_PRESET_NAME}」已启用：AI 适配将直接使用 ST「API 连接」的 ${info.label} · ${info.model}，接口地址与 Key 都不用填。`
                : `「${ST_PRESET_NAME}」已启用，但没读到 ST「API 连接」的模型：请先在 ST 顶部「API 连接」里选好模型，或改用「自定义接口」。`, info.ok ? 'info' : 'warn');
            return;
        }
        applyAiMode('custom', { announce: false });
        $('#cardlore_ai_url').val(preset.url);
        $('#cardlore_ai_model').val(preset.models[0]);
        setStatus(`已切到「自定义接口」并填入「${preset.name}」：${preset.url}，模型 ${preset.models[0]}（当前最具性价比）。填好 API Key 后点「保存设置」。`, 'info');
    });

    reRenderMaterials();
}

/* ---------------- 导入素材 ---------------- */

/** 待添加（弹窗内）的文件引用 */
let importPending = [];

/** 渲染输入框下方的「已添加素材」chips 行 */
function reRenderMaterials() {
    const $wrap = $('#cardlore_materials');
    if (!$wrap.length) return;
    if (!materials.length) {
        $wrap.hide().empty();
        return;
    }
    $wrap.empty();
    materials.forEach((m, i) => {
        const $chip = $(`<span class="cardlore_material_chip" title="已添加：${escapeHtml(m.name)}。点击 × 移除。"><i class="fa-solid fa-file-lines"></i>&nbsp;${escapeHtml(m.name)}<span class="cardlore_material_rm" data-i="${i}" title="移除该素材">×</span></span>`);
        $wrap.append($chip);
    });
    $wrap.show();
}

/** 打开「导入素材」弹窗 */
function openImportPopup() {
    let $popup = $('#cardlore_import_popup');
    if (!$popup.length) {
        $popup = $(buildImportPopupHtml()).appendTo('body');
        bindImportPopupEvents($popup);
    }
    importPending = [];
    renderImportPending();
    setImportPopupStatus('');
    $popup.show();
}

function buildImportPopupHtml() {
    return `
        <div id="cardlore_import_popup" class="cardlore_popup cardlore_import_popup" style="display:none;">
            <div class="cardlore_panel">
                <div class="cardlore_header">
                    <span><i class="fa-solid fa-file-import"></i>&nbsp;导入素材文件</span>
                    <span id="cardlore_import_close" class="cardlore_close fa-solid fa-xmark" title="关闭"></span>
                </div>
                <div class="cardlore_body">
                    <div class="cardlore_hint">
                        暂仅支持 .txt、.docx、.md 格式的文件。可拖入或点击选择（可多选），
                        点击【添加素材】后文件名将显示在输入框下方，并与输入框文本合并参与「解析预览」与「AI 适配」。
                    </div>
                    <div id="cardlore_import_drop" class="cardlore_import_drop" tabindex="0">
                        <div class="cardlore_import_drop_icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                        <div class="cardlore_import_drop_text">将文件拖到此处，或点击选择文件</div>
                    </div>
                    <input type="file" id="cardlore_import_file" accept=".txt,.md,.docx" multiple style="display:none;">
                    <div id="cardlore_import_count" class="cardlore_import_count" style="display:none;"></div>
                    <div id="cardlore_import_pending" class="cardlore_import_pending" style="display:none;"></div>
                    <div id="cardlore_import_status" class="cardlore_import_status" style="display:none;"></div>
                    <div class="cardlore_import_actions">
                        <div id="cardlore_import_add" class="menu_button cardlore_import_add_btn"><i class="fa-solid fa-plus"></i>&nbsp;添加素材</div>
                        <div id="cardlore_import_clear" class="menu_button cardlore_btn_danger"><i class="fa-solid fa-trash-can"></i>&nbsp;清空素材</div>
                    </div>
                </div>
            </div>
        </div>`;
}

function bindImportPopupEvents($popup) {
    $('#cardlore_import_close', $popup).on('click', () => $popup.hide());
    $popup.on('click', function (e) {
        if (e.target === this) $popup.hide(); // 点击遮罩关闭（取消）
    });
    $(document).on('keydown.cardloreImport', (e) => {
        const $p = $('#cardlore_import_popup');
        if (e.key === 'Escape' && $p.is(':visible')) $p.hide();
    });

    const $drop = $('#cardlore_import_drop', $popup);
    const $file = $('#cardlore_import_file', $popup);

    // 点击选择（触屏设备无拖拽，此为唯一入口）
    $drop.on('click', () => $file.trigger('click'));
    $file.on('change', function () {
        addFilesToPending([...this.files]);
        this.value = '';
    });

    // 拖放（preventDefault/stopPropagation 避免触发 ST 全局拖放）
    $drop.on('dragover dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        $drop.addClass('cardlore_import_drop_over');
    });
    $drop.on('dragleave dragend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        $drop.removeClass('cardlore_import_drop_over');
    });
    $drop.on('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        $drop.removeClass('cardlore_import_drop_over');
        addFilesToPending([...(e.originalEvent?.dataTransfer?.files || [])]);
    });

    // 待选列表内移除单项
    $('#cardlore_import_pending', $popup).on('click', '.cardlore_import_rm', function () {
        const i = Number($(this).attr('data-i'));
        if (!Number.isInteger(i) || i < 0 || i >= importPending.length) return;
        importPending.splice(i, 1);
        renderImportPending();
    });

    // 清空待选（红底白字）
    $('#cardlore_import_clear', $popup).on('click', () => {
        importPending = [];
        renderImportPending();
        setImportPopupStatus('');
    });

    // 读取并添加素材
    $('#cardlore_import_add', $popup).on('click', onImportAdd);
}

/** 把拖入/选中的文件加入待选列表（过滤扩展名、去重、数量上限） */
function addFilesToPending(files) {
    const unsupported = [];
    let added = 0;
    const quota = MAX_MATERIALS - materials.length - importPending.length;
    for (const f of files) {
        if (!f || typeof f.name !== 'string') continue;
        if (!isSupportedSourceFile(f)) {
            unsupported.push(f.name);
            continue;
        }
        if (f.size > MAX_SOURCE_FILE_SIZE) {
            unsupported.push(`${f.name}（过大）`);
            continue;
        }
        if (importPending.some(p => p.name === f.name && p.size === f.size)) continue;
        if (added >= quota) {
            unsupported.push(`${f.name}（超出 ${MAX_MATERIALS} 个上限）`);
            continue;
        }
        importPending.push(f);
        added++;
    }
    setImportPopupStatus(unsupported.length ? `已忽略：${unsupported.join('、')}` : '', 'error');
    if (added) renderImportPending();
}

/** 渲染待选文件列表 + 计数 */
function renderImportPending() {
    const $count = $('#cardlore_import_count');
    const $list = $('#cardlore_import_pending');
    if (!importPending.length) {
        $list.hide().empty();
        if (materials.length) {
            $count.text(`已添加 ${materials.length} 个素材（显示在输入框下方，可点 × 移除）`).show();
        } else {
            $count.hide().text('');
        }
        return;
    }
    $list.empty();
    importPending.forEach((f, i) => {
        const sizeText = f.size > 1024 * 1024
            ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(f.size / 1024))} KB`;
        $(`<div class="cardlore_import_file"><i class="fa-solid fa-file-lines"></i>&nbsp;<span class="cardlore_import_file_name">${escapeHtml(f.name)}</span><span class="cardlore_import_file_size">${sizeText}</span><span class="cardlore_material_rm cardlore_import_rm" data-i="${i}" title="移除">×</span></div>`)
            .appendTo($list);
    });
    $list.show();
    $count.text(`待添加 ${importPending.length} 个 · 已添加 ${materials.length} 个（合计上限 ${MAX_MATERIALS}）`).show();
}

/** 弹窗内小状态（红=错误，琥珀=进行中/提示） */
function setImportPopupStatus(text, type = 'error') {
    const $s = $('#cardlore_import_status');
    if (!text) {
        $s.hide().attr('class', 'cardlore_import_status').text('');
        return;
    }
    $s.attr('class', `cardlore_import_status cardlore_import_status_${type}`).text(text).show();
}

/** 【添加素材】：读取待选文件 → 加入 materials → 关闭弹窗并刷新 chips */
async function onImportAdd() {
    const $popup = $('#cardlore_import_popup');
    if (!importPending.length) {
        setImportPopupStatus('请先拖入或选择文件。', 'error');
        return;
    }
    setImportPopupStatus('正在读取文件…', 'info');
    const results = [];
    const failed = [];
    for (const f of importPending) {
        try {
            results.push(await readSourceFile(f));
        } catch (err) {
            failed.push(String(err?.message || err));
        }
    }
    if (!results.length) {
        setImportPopupStatus(failed.join('；') || '读取失败，请重试。', 'error');
        return;
    }
    materials.push(...results);
    importPending = [];
    renderImportPending();
    reRenderMaterials();
    $popup.hide();
    const names = results.map(r => r.name).join('、');
    setStatus(failed.length
        ? `已添加 ${results.length} 个素材（${names}）；${failed.length} 个失败：${failed.join('；')}。`
        : `已添加 ${results.length} 个素材：${names}。`, 'info');
}

/** 渲染 AI 接口预设方案列表（首项「默认方案」动态展示 ST「API 连接」当前状态） */
function renderPresetsHtml() {
    const st = stConnectionInfo();
    return AI_PRESETS.map(p => {
        if (p.st) {
            const stInfo = st.ok
                ? `来源：ST「API 连接」· ${escapeHtml(st.label)}`
                : '来源：ST「API 连接」（未检测到模型，请先在 ST 里选好）';
            const stModel = st.ok ? `模型：${escapeHtml(st.model)}` : '模型：—';
            return `
        <div class="cardlore_ai_preset cardlore_ai_preset_st" data-preset="${escapeHtml(p.name)}">
            <div class="cardlore_ai_preset_info">
                <b>${escapeHtml(p.name)}</b><span class="cardlore_ai_preset_badge">推荐</span>
                <span class="cardlore_ai_preset_url">${stInfo}</span>
                <span class="cardlore_ai_preset_models">${stModel}</span>
                <span class="cardlore_ai_preset_note">${escapeHtml(p.note)}</span>
            </div>
            <div class="cardlore_ai_preset_use menu_button">启用</div>
        </div>`;
        }
        return `
        <div class="cardlore_ai_preset" data-preset="${escapeHtml(p.name)}">
            <div class="cardlore_ai_preset_info">
                <b>${escapeHtml(p.name)}</b>
                <span class="cardlore_ai_preset_url">${escapeHtml(p.url)}</span>
                <span class="cardlore_ai_preset_models">模型：${escapeHtml(p.models.join(' / '))}</span>
                <span class="cardlore_ai_preset_note">${escapeHtml(p.note)}</span>
            </div>
            <div class="cardlore_ai_preset_use menu_button">填入</div>
        </div>`;
    }).join('');
}

/**
 * 切换调用方式（'st' = 用 ST 当前连接；'custom' = 用自定义接口）并同步界面。
 * @param {'st'|'custom'} mode
 * @param {{save?: boolean, announce?: boolean}} [opts]
 */
function applyAiMode(mode, { save = true, announce = true } = {}) {
    const ai = extension_settings[MODULE_NAME].ai;
    ai.apiMode = mode === 'custom' ? 'custom' : 'st';
    const isSt = ai.apiMode === 'st';
    $('#cardlore_ai_mode_st').toggleClass('cardlore_ai_mode_active', isSt);
    $('#cardlore_ai_mode_custom').toggleClass('cardlore_ai_mode_active', !isSt);
    // ST 模式下地址/Key/模型不参与请求，置灰并禁用避免误解
    $('#cardlore_ai_url, #cardlore_ai_key, #cardlore_ai_model').prop('disabled', isSt);
    $('.cardlore_ai_custom_row').toggleClass('cardlore_ai_custom_off', isSt);
    $('#cardlore_ai_presets_body .cardlore_ai_preset').each(function () {
        const name = $(this).attr('data-preset');
        const preset = AI_PRESETS.find(p => p.name === name);
        $(this).toggleClass('cardlore_ai_preset_active', Boolean(preset?.st) === isSt);
    });
    renderStHint();
    if (save) saveSettingsDebounced();
    if (announce) {
        setStatus(isSt
            ? '已切换为「使用 ST 当前连接」：AI 适配直接借用 ST「API 连接」的模型与额度，无需填写地址与 Key。'
            : '已切换为「自定义接口」：请在下面填写接口地址、API Key 与模型后点「保存设置」。', 'info');
    }
}

/** 刷新「调用方式」下方的状态提示 + 折叠标题上的模式徽标 */
function renderStHint() {
    const ai = extension_settings[MODULE_NAME].ai;
    const $hint = $('#cardlore_ai_st_hint');
    if (ai.apiMode === 'custom') {
        $hint.attr('class', 'cardlore_ai_st_hint')
            .text('自定义接口模式：AI 适配会直接请求下面填写的 OpenAI 兼容地址，需要自己的 API Key。');
        $('#cardlore_ai_mode_badge').text('自定义接口');
        return;
    }
    const st = stConnectionInfo();
    $('#cardlore_ai_mode_badge').text(st.ok ? `${ST_PRESET_NAME} · ${st.model}` : ST_PRESET_NAME);
    if (!st.ok) {
        $hint.attr('class', 'cardlore_ai_st_hint cardlore_ai_st_hint_warn')
            .text('ST「API 连接」里没检测到模型：请先在 ST 顶部选好来源与模型，或改用「自定义接口」。');
        return;
    }
    $hint.attr('class', 'cardlore_ai_st_hint')
        .text(`免填 Key：将使用 ST「API 连接」的 ${st.label} · ${st.model}。`);
}

/** 清空当前解析预览（保留输入框文本，便于修改后重新解析） */
function onClearPreview() {
    lastResult = null;
    applyArmed = false;
    $('#cardlore_preview').html('');
    $('#cardlore_apply').text('应用：创建角色+世界书');
    setStatus('预览已清空，可修改文本后重新「解析预览」。', 'info');
}

/* ---------------- AI 适配 ---------------- */

/** 有效原始文本 = 输入框文本 + 已添加素材文本（素材按添加顺序，空行分隔，不加装饰分隔行） */
function combinedInputText() {
    const own = String($('#cardlore_input').val() || '');
    const parts = [];
    if (own.trim()) parts.push(own);
    for (const m of materials) parts.push(m.text);
    return parts.join('\n\n');
}

function onAiConvert() {
    const text = combinedInputText();
    if (!text.trim()) {
        setStatus('请先粘贴原始文本或添加素材文件，再点「AI 适配」。', 'warn');
        return;
    }
    const ai = extension_settings[MODULE_NAME].ai;
    const useSt = ai.apiMode !== 'custom';
    let st = null;
    if (useSt) {
        st = stConnectionInfo();
        if (!st.ok) {
            setStatus('没读到 ST「API 连接」的模型：请先在 ST 顶部「API 连接」里选好来源与模型，或展开「AI 接口设置」切到「自定义接口」。', 'error');
            return;
        }
    } else {
        if (!ai.apiUrl) {
            setStatus('请先配置 AI 接口地址（展开「AI 接口设置」填写并保存）。', 'error');
            return;
        }
        if (!ai.model) {
            setStatus('请先填写模型名称（如 gpt-5.4-nano）。', 'error');
            return;
        }
    }

    (async () => {
        try {
            setBusy(true, useSt
                ? `AI 正在整理文本（ST「API 连接」· ${st.model}）…`
                : 'AI 正在整理文本…');
            const mergedCount = materials.length;
            const formatted = await aiConvert(text, ai, useSt);
            $('#cardlore_input').val(formatted);
            // 素材内容已并入整理结果（写回输入框），清空素材列表防止再次合并造成重复
            if (mergedCount) {
                materials = [];
                reRenderMaterials();
            }
            const via = useSt ? `经由 ST「API 连接」· ${st.model}` : `自定义接口 · ${ai.model}`;
            const merge = mergedCount ? `；已并入 ${mergedCount} 个素材文件并清空素材列表` : '';
            // 解析状态会紧接着覆盖状态栏，这里把「AI 适配」来源交给 onParse 一并显示，避免信息一闪而过
            lastAiNote = `AI 适配完成（${via}${merge}）。`;
            setStatus(lastAiNote, 'info');
            onParse();
        } catch (err) {
            console.error('[CardLore] AI convert failed', err);
            const tip = useSt ? '' : '（若这个接口不可用，可在「AI 接口设置 → 调用方式」切到「使用 ST 当前连接」）';
            setStatus(`AI 适配失败：${err.message || err}${tip}`, 'error');
            toastr.error(String(err.message || err), 'CardLore AI');
        } finally {
            setBusy(false);
        }
    })();
}

/**
 * 调用 AI 整理文本。
 * @param {string} rawText 原始文本
 * @param {object} ai CardLore AI 设置
 * @param {boolean} useSt true = 通过 ST「API 连接」发送；false = 直连自定义 OpenAI 兼容接口
 * @returns {Promise<string>} 整理后的文本
 */
async function aiConvert(rawText, ai, useSt) {
    return useSt
        ? aiConvertViaSt(rawText, ai.prompt || DEFAULT_AI_PROMPT)
        : aiConvertDirect(rawText, ai);
}

/**
 * 走 ST 内置请求服务（ChatCompletionService → /api/backends/chat-completions/generate），
 * 直接复用 ST「API 连接」的来源、模型、额度与已保存的 Key，用户无需在插件里再填任何凭据。
 */
async function aiConvertViaSt(rawText, promptText) {
    const st = stConnectionInfo();
    if (!st.ok) throw new Error('ST「API 连接」里没有可用的模型，请先设置');

    const service = getContext()?.ChatCompletionService;
    if (!service?.processRequest) {
        throw new Error('当前 ST 版本不支持内置请求服务，请在「AI 接口设置」里改用「自定义接口」');
    }

    const s = oai_settings || {};
    const payload = {
        stream: false,
        messages: [
            { role: 'system', content: promptText },
            { role: 'user', content: rawText },
        ],
        model: st.model,
        chat_completion_source: st.source,
        max_tokens: ST_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        use_sysprompt: true,
        // 与 ST 主连接一致的路由参数（未设置的值会被 ST 的 createRequestData 剔除）
        custom_url: s.custom_url,
        reverse_proxy: s.reverse_proxy,
        proxy_password: s.proxy_password,
        zai_endpoint: s.zai_endpoint,
        siliconflow_endpoint: s.siliconflow_endpoint,
        minimax_endpoint: s.minimax_endpoint,
        vertexai_region: s.vertexai_region,
        azure_base_url: s.azure_base_url,
        azure_deployment_name: s.azure_deployment_name,
        azure_api_version: s.azure_api_version,
        workers_ai_account_id: s.workers_ai_account_id,
        openrouter_providers: s.openrouter_providers,
        openrouter_quantizations: s.openrouter_quantizations,
        openrouter_allow_fallbacks: s.openrouter_allow_fallbacks,
    };

    const result = await service.processRequest(payload, {}, true);
    const content = typeof result === 'string' ? result : result?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('ST「API 连接」没有返回可用内容，请确认该连接能正常聊天');
    }
    return stripCodeFence(content.trim());
}

/** 直连用户填写的 OpenAI 兼容接口（chat/completions） */
async function aiConvertDirect(rawText, ai) {
    const url = normalizeChatUrl(ai.apiUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (ai.apiKey) headers['Authorization'] = `Bearer ${ai.apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: ai.model,
            messages: [
                { role: 'system', content: ai.prompt || DEFAULT_AI_PROMPT },
                { role: 'user', content: rawText },
            ],
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('响应中没有可用的 content（请确认接口兼容 OpenAI chat/completions 格式）');
    }
    return stripCodeFence(content.trim());
}

/** 去掉 AI 返回内容外层的 ``` 代码块围栏 */
function stripCodeFence(content) {
    const m = content.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    return m ? m[1].trim() : content;
}

/** 归一化 OpenAI 兼容接口地址：自动补 /chat/completions */
function normalizeChatUrl(base) {
    let url = String(base || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/\/chat\/completions$/i.test(url)) url += '/chat/completions';
    return url;
}

function saveAiSettings() {
    const settings = extension_settings[MODULE_NAME];
    settings.ai.apiMode = $('#cardlore_ai_mode_custom').hasClass('cardlore_ai_mode_active') ? 'custom' : 'st';
    settings.ai.apiUrl = String($('#cardlore_ai_url').val() || '').trim();
    settings.ai.apiKey = String($('#cardlore_ai_key').val() || '').trim();
    settings.ai.model = String($('#cardlore_ai_model').val() || '').trim();
    settings.ai.prompt = String($('#cardlore_ai_prompt').val() || '');
    saveSettingsDebounced();
    const st = stConnectionInfo();
    setStatus(settings.ai.apiMode === 'st'
        ? `AI 设置已保存（调用方式：使用 ST 当前连接${st.ok ? ` · ${st.label} · ${st.model}` : ''}）。`
        : 'AI 设置已保存（调用方式：自定义接口）。', 'info');
}

function resetAiPrompt() {
    $('#cardlore_ai_prompt').val(DEFAULT_AI_PROMPT);
    extension_settings[MODULE_NAME].ai.promptVersion = DEFAULT_AI_PROMPT_VERSION;
    setStatus('提示词已重置为默认，点击「保存设置」生效。', 'info');
}

function setStatus(text, type = 'info') {
    $('#cardlore_status')
        .attr('class', `cardlore_status cardlore_status_${type}`)
        .html(escapeHtml(text));
}

function setBusy(busy, text) {
    $('#cardlore_ai, #cardlore_parse, #cardlore_apply, #cardlore_export, #cardlore_clear, #cardlore_expand, #cardlore_expand_parse, #cardlore_expand_close, #cardlore_import_material, #cardlore_import_add, #cardlore_import_clear').prop('disabled', busy).toggleClass('disabled', busy);
    if (text) setStatus(text, 'info');
}

/* ---------------- 解析预览 ---------------- */

function onParse() {
    const aiNote = lastAiNote;
    lastAiNote = '';
    const text = combinedInputText();
    if (!text.trim()) {
        setStatus('请先粘贴文本或添加素材文件。', 'warn');
        return;
    }

    const ast = parse(text);
    const card = buildCard(ast);
    // 世界书（兼容旧【角色书】区块：条目并入世界书，不再生成内嵌 character_book）
    const bookAsts = ast.books.filter(b => b.type === 'world' || b.type === 'embedded');
    let world = null;
    if (bookAsts.length) {
        const combined = { type: 'world', entries: bookAsts.flatMap(b => b.entries) };
        world = buildBook(combined);
    }

    lastResult = { ast, card, world };
    applyArmed = false;
    $('#cardlore_apply').text('应用：创建角色+世界书');
    renderPreview(aiNote);
}

function collectErrors(result) {
    const errors = [
        ...result.ast.errors.map(e => (e.line ? `L${e.line}: ` : '') + e.message),
        ...result.card.errors,
        ...(result.world?.errors ?? []),
    ];
    return errors;
}

function collectWarnings(result) {
    return [
        ...result.ast.warnings.map(w => (w.line ? `L${w.line}: ` : '') + w.message),
        ...result.card.warnings,
        ...(result.world?.warnings ?? []),
    ];
}

/**
 * 渲染解析预览。
 * @param {string} [aiNote] 紧随解析摘要显示的「AI 适配完成」提示（可选）
 */
function renderPreview(aiNote = '') {
    const r = lastResult;
    if (!r) return;
    const errors = collectErrors(r);
    const warnings = collectWarnings(r);

    // 角色卡字段（剔除空值）
    const cardFields = Object.entries(r.card.createSave)
        .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== null && v !== undefined))
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(Array.isArray(v) ? v.join(' | ') : String(v)).slice(0, 200)}</td></tr>`)
        .join('');

    // 世界书条目（兼容 buildBook 结果形状；旧【角色书】条目的 V2 字段也能显示）
    const bookHtml = (book, label) => {
        if (!book) return '';
        const entries = book.book?.entries ?? book.characterBook?.entries;
        if (!entries) return '';
        const rows = Object.values(entries).map(e => {
            const keyList = Array.isArray(e.key) ? e.key : (Array.isArray(e.keys) ? e.keys : []);
            const content = String(e.content ?? '');
            const pos = typeof e.position === 'string' ? e.position
                : e.position === 0 ? 'before'
                    : e.position === 1 ? 'after'
                        : String(e.position ?? '');
            const order = e.order ?? e.insertion_order ?? '';
            const depth = e.depth ?? '';
            const constant = e.constant ? ' 常量' : '';
            return `<tr><td>${escapeHtml(keyList.join(', ') || '(无关键词)')}</td><td>${escapeHtml(content).slice(0, 120)}</td><td>pos=${escapeHtml(pos)} ord=${escapeHtml(order)} dep=${escapeHtml(depth)}${constant}</td></tr>`;
        }).join('');
        return `<h4>${escapeHtml(label)}（${Object.keys(entries).length} 条）</h4>
            <table class="cardlore_table"><thead><tr><th>关键词</th><th>内容</th><th>参数</th></tr></thead><tbody>${rows}</tbody></table>`;
    };

    const errorsHtml = errors.length
        ? `<div class="cardlore_block cardlore_block_error"><b>✖ 错误（${errors.length}）— 修复后再应用：</b><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
        : '<div class="cardlore_block cardlore_block_ok">✅ 校验通过，可应用</div>';
    const warningsHtml = warnings.length
        ? `<div class="cardlore_block cardlore_block_warn"><b>⚠ 警告（${warnings.length}）：</b><ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
        : '';

    $('#cardlore_preview').html(`
        <div class="cardlore_block">
            <h4>角色卡：${escapeHtml(r.card.createSave.name || '(未命名)')}</h4>
            <table class="cardlore_table"><tbody>${cardFields || '<tr><td colspan="2">（无字段）</td></tr>'}</tbody></table>
        </div>
        ${bookHtml(r.world, '世界书')}
        ${errorsHtml}
        ${warningsHtml}
    `);
    const summary = `解析完成：${errors.length ? `发现 ${errors.length} 个错误` : '无错误'}，${warnings.length} 条警告。`;
    const hint = errors.length ? ' 可使用「AI适配」进行一键适配「特定格式」。' : '';
    setStatus(summary + hint + (aiNote ? ' ' + aiNote : ''), errors.length ? 'warn' : 'info');
}

/* ---------------- 应用 / 导出 ---------------- */

async function onApply() {
    const r = lastResult;
    if (!r) {
        setStatus('请先点击「解析预览」。', 'warn');
        return;
    }
    const errors = collectErrors(r);
    if (errors.length) {
        setStatus(`存在 ${errors.length} 个错误，请修复后重试。首个错误：${errors[0]}`, 'error');
        return;
    }

    const settings = extension_settings[MODULE_NAME];
    if (settings.confirmBeforeCreate && !applyArmed) {
        applyArmed = true;
        $('#cardlore_apply').text('再次点击确认创建');
        setStatus('再次点击「应用」确认创建。将新建角色卡，并保存/绑定世界书。', 'warn');
        setTimeout(() => {
            applyArmed = false;
            $('#cardlore_apply').text('应用：创建角色+世界书');
        }, 5000);
        return;
    }

    try {
        setBusy(true, '正在应用…');
        const { avatar } = await applyToST({
            createSave: r.card.createSave,
            cardData: r.card.cardData,
            worldBook: r.world?.book ?? null,
            settings,
            onProgress: msg => setStatus(msg, 'info'),
        });
        toastr.success(`角色「${r.card.createSave.name}」创建成功`, 'CardLore');
        try {
            selectCharacterById(avatar);
        } catch { /* 选中失败不影响主流程 */ }
        $('#cardlore_popup').hide();
    } catch (err) {
        console.error('[CardLore] apply failed', err);
        setStatus(`应用失败：${err.message || err}`, 'error');
        toastr.error(String(err.message || err), 'CardLore');
    } finally {
        setBusy(false);
    }
}

function onExport() {
    const r = lastResult;
    if (!r) {
        setStatus('请先点击「解析预览」。', 'warn');
        return;
    }
    const base = r.card.createSave.name || 'character';
    downloadJson(`${base}.card.json`, r.card.cardData);
    if (r.world) downloadJson(`${base}.worldbook.json`, r.world.book);
    setStatus('已导出 JSON 文件（角色卡 / 世界书）。', 'info');
}
