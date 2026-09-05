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
import { extension_settings } from '../../../extensions.js';
import { escapeHtml } from '../../../utils.js';
import { parse } from './src/parser.js';
import { buildCard, buildBook } from './src/builder.js';
import { applyToST, downloadJson } from './src/writer.js';

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
    model: 'gpt-4o-mini',
    prompt: DEFAULT_AI_PROMPT,
    promptVersion: DEFAULT_AI_PROMPT_VERSION,
};

/** AI 接口预设方案（OpenAI 兼容），点击一键填入接口地址与模型；自定义选项始终保留 */
const AI_PRESETS = [
    { name: 'DeepSeek', url: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], note: '官方直连，便宜好用' },
    { name: 'OpenAI', url: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'], note: '官方接口' },
    { name: 'Moonshot（Kimi）', url: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'], note: '国内直连，中文友好' },
    { name: '阿里云百炼（通义千问）', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], note: '阿里云 OpenAI 兼容端点' },
    { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'], note: '国内直连，glm-4-flash 免费' },
    { name: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], note: '聚合多家开源模型' },
    { name: 'Groq', url: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], note: '极速推理，有免费额度' },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini'], note: '聚合平台，多模型切换' },
    { name: '本地 Ollama', url: 'http://localhost:11434/v1', models: ['llama3.1', 'qwen2.5'], note: '本机免费，需先安装 Ollama' },
];

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

jQuery(async function () {
    const settings = (extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {});
    Object.assign(settings, DEFAULT_SETTINGS, settings);
    settings.ai = Object.assign({}, DEFAULT_AI_SETTINGS, settings.ai || {});
    // 默认提示词升级迁移：版本号不一致时用新版默认提示词覆盖（用户自定义的会随「重置默认提示词」找回）
    if (settings.ai.promptVersion !== DEFAULT_AI_PROMPT_VERSION) {
        settings.ai.prompt = DEFAULT_AI_PROMPT;
        settings.ai.promptVersion = DEFAULT_AI_PROMPT_VERSION;
    }
    // 预填接口地址与模型：优先取 ST「自定义 OpenAI」源，其次取 ST 的 DeepSeek 源，最后用默认值
    const isDeepSeek = oai_settings?.chat_completion_source === 'deepseek';
    if (!settings.ai.apiUrl) {
        settings.ai.apiUrl = oai_settings?.custom_url
            || (isDeepSeek ? 'https://api.deepseek.com' : '')
            || DEFAULT_AI_SETTINGS.apiUrl;
    }
    if (!settings.ai.model) {
        settings.ai.model = oai_settings?.custom_model
            || (isDeepSeek ? oai_settings?.deepseek_model : '')
            || DEFAULT_AI_SETTINGS.model;
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
                    </div>
                    <div class="cardlore_input_wrap">
                        <textarea id="cardlore_input" class="text_pole cardlore_input" placeholder="在此粘贴角色设定文本，或输入设定文本进行「AI适配」…"></textarea>
                        <div id="cardlore_expand" class="menu_button cardlore_expand" title="展开全屏编辑" data-i18n="[title]展开全屏编辑"><i class="fa-solid fa-expand"></i>&nbsp;展开</div>
                    </div>
                    <div class="cardlore_toolbar">
                        <div id="cardlore_ai" class="menu_button"><i class="fa-solid fa-robot"></i>&nbsp;AI 适配</div>
                        <div id="cardlore_parse" class="menu_button">解析预览</div>
                        <div id="cardlore_apply" class="menu_button menu_button_primary">应用：创建角色+世界书</div>
                        <div id="cardlore_export" class="menu_button">导出 JSON</div>
                        <div id="cardlore_clear" class="menu_button"><i class="fa-solid fa-eraser"></i>&nbsp;清空预览</div>
                    </div>
                    <div class="cardlore_ai_settings">
                        <div id="cardlore_ai_toggle" class="cardlore_ai_toggle"><i class="fa-solid fa-gear"></i>&nbsp;AI 接口设置（可折叠）</div>
                        <div id="cardlore_ai_settings_body" class="cardlore_ai_settings_body" style="display: none;">
                            <div class="cardlore_ai_presets">
                                <div id="cardlore_ai_presets_toggle" class="cardlore_ai_presets_toggle"><i class="fa-solid fa-list"></i>&nbsp;预设方案（点击展开，一键填入地址与模型）</div>
                                <div id="cardlore_ai_presets_body" class="cardlore_ai_presets_body" style="display: none;"></div>
                            </div>
                            <div class="flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_url">接口地址</label>
                                <input id="cardlore_ai_url" type="text" class="text_pole flex1" placeholder="自定义 OpenAI 兼容地址（自动补 /chat/completions）">
                            </div>
                            <div class="flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_key">API Key</label>
                                <input id="cardlore_ai_key" type="password" class="text_pole flex1" placeholder="sk-…（可留空）">
                            </div>
                            <div class="flex-container flexGap5 alignItemsCenter">
                                <label for="cardlore_ai_model">模型</label>
                                <input id="cardlore_ai_model" type="text" class="text_pole flex1" placeholder="gpt-4o-mini">
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

    // 预设方案：渲染 + 展开折叠 + 一键填入
    $('#cardlore_ai_presets_body').html(renderPresetsHtml());
    $('#cardlore_ai_presets_toggle').on('click', () => $('#cardlore_ai_presets_body').slideToggle(200));
    $('#cardlore_ai_presets_body').on('click', '.cardlore_ai_preset_use', function () {
        const presetName = $(this).closest('.cardlore_ai_preset').attr('data-preset');
        const preset = AI_PRESETS.find(p => p.name === presetName);
        if (!preset) return;
        $('#cardlore_ai_url').val(preset.url);
        $('#cardlore_ai_model').val(preset.models[0]);
        setStatus(`已填入「${preset.name}」：${preset.url}，模型 ${preset.models[0]}。填好 API Key 后点「保存设置」。`, 'info');
    });
}

/** 渲染 AI 接口预设方案列表 */
function renderPresetsHtml() {
    return AI_PRESETS.map(p => `
        <div class="cardlore_ai_preset" data-preset="${escapeHtml(p.name)}">
            <div class="cardlore_ai_preset_info">
                <b>${escapeHtml(p.name)}</b>
                <span class="cardlore_ai_preset_url">${escapeHtml(p.url)}</span>
                <span class="cardlore_ai_preset_models">模型：${escapeHtml(p.models.join(' / '))}</span>
                <span class="cardlore_ai_preset_note">${escapeHtml(p.note)}</span>
            </div>
            <div class="cardlore_ai_preset_use menu_button">填入</div>
        </div>`).join('');
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

function onAiConvert() {
    const text = $('#cardlore_input').val();
    if (!text.trim()) {
        setStatus('请先粘贴原始文本，再点「AI 适配」。', 'warn');
        return;
    }
    const ai = extension_settings[MODULE_NAME].ai;
    if (!ai.apiUrl) {
        setStatus('请先配置 AI 接口地址（展开「AI 接口设置」填写并保存）。', 'error');
        return;
    }
    if (!ai.model) {
        setStatus('请先填写模型名称（如 gpt-4o-mini）。', 'error');
        return;
    }

    (async () => {
        try {
            setBusy(true, 'AI 正在整理文本…');
            const formatted = await aiConvert(text, ai);
            $('#cardlore_input').val(formatted);
            setStatus('AI 整理完成，已自动解析预览。', 'info');
            onParse();
        } catch (err) {
            console.error('[CardLore] AI convert failed', err);
            setStatus(`AI 适配失败：${err.message || err}`, 'error');
            toastr.error(String(err.message || err), 'CardLore AI');
        } finally {
            setBusy(false);
        }
    })();
}

/** 调用 OpenAI 兼容 chat/completions，返回整理后的文本 */
async function aiConvert(rawText, ai) {
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
    settings.ai.apiUrl = String($('#cardlore_ai_url').val() || '').trim();
    settings.ai.apiKey = String($('#cardlore_ai_key').val() || '').trim();
    settings.ai.model = String($('#cardlore_ai_model').val() || '').trim();
    settings.ai.prompt = String($('#cardlore_ai_prompt').val() || '');
    saveSettingsDebounced();
    setStatus('AI 设置已保存。', 'info');
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
    $('#cardlore_ai, #cardlore_parse, #cardlore_apply, #cardlore_export, #cardlore_clear, #cardlore_expand, #cardlore_expand_parse, #cardlore_expand_close').prop('disabled', busy).toggleClass('disabled', busy);
    if (text) setStatus(text, 'info');
}

/* ---------------- 解析预览 ---------------- */

function onParse() {
    const text = $('#cardlore_input').val();
    if (!text.trim()) {
        setStatus('请先粘贴文本。', 'warn');
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
    renderPreview();
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

function renderPreview() {
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
    setStatus(summary + hint, errors.length ? 'warn' : 'info');
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
