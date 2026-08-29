# SillyTavern-CardLore 插件

「填写即生成」角色卡 + 世界书生成器（SillyTavern 1.18.0 实测，兼容移动端窄屏）。

## 许可与开发声明

- 本插件以 **MIT 许可证** 开源（见 `LICENSE`），可自由使用、修改与再分发（保留版权声明即可）。
- 本插件由 **DeepSeek Harness**（AI 编程助手）辅助开发，详细声明见 [`AI-DISCLOSURE.md`](./AI-DISCLOSURE.md)。
- 使用本插件请同时遵守 SillyTavern 自身的许可与使用条款。

## 安装

**方式 A：从 GitHub 一键安装（推荐）**
ST 顶栏 → 扩展程序（魔法棒）→ 管理扩展程序 → **Install extension** → 粘贴仓库地址：

```
https://github.com/Ushio155/SillyTavern-CardLore
```

**方式 B：手动放置**
把整个 `SillyTavern-CardLore` 目录放进 `public/scripts/extensions/third-party/`。

安装后**刷新浏览器页面**（扩展在客户端发现/加载，需刷新才生效）。

## 使用

**入口（两处）**：
1. 角色列表工具栏，「新建角色」按钮**左侧**的琥珀色 ✨ 按钮（悬停显示"一键生成"）—— 最显眼，推荐
2. 顶栏左侧「扩展程序」魔法棒菜单内的 ✨ 图标

点击后打开生成器：

1. 粘贴**任意原始文本**（无需关心插件格式）。输入框右上角「**展开**」可切换全屏编辑，方便查看和修改整段文本（编辑实时同步，`Esc` 或「完成」收起；全屏内也可直接「解析预览」）。
2. 点「**AI 适配**」（🤖，解析预览左侧）——通过 **OpenAI 兼容接口**自动整理成插件格式并立即预览。
   - 首次使用：展开「AI 接口设置」→ 展开「**预设方案**」选择一家（DeepSeek / OpenAI / Kimi / 通义 / GLM / 硅基流动 / Groq / OpenRouter / 本地 Ollama），点「填入」自动填好地址与模型；填 API Key 后点「保存设置」。
   - 或保留「自定义 OpenAI 兼容」选项，手动填接口地址 / API Key / 模型。
   - 接口地址留空会自动预填 ST「自定义 OpenAI」或 DeepSeek 源配置。
   - 提示词可自行修改；点「重置默认提示词」一键恢复，避免改崩。
3. 「解析预览」→ 查看角色卡字段 / 世界书条目 / 校验报告（AI 整理后会自动执行）。
4. 「清空预览」→ 清除当前解析结果（输入框文本保留，便于修改后重新解析）。
5. 「应用」→ 自动：
   - 保存独立世界书（`saveWorldInfo`，重名自动加序号）
   - 导入角色卡（`POST /api/characters/import`，`file_type=json`）
   - 卡片 `extensions.world` 绑定世界书
6. 或「导出 JSON」下载角色卡 / 世界书两个文件。

**区块映射**（AI 适配自动完成，均逐字保留不缩略）：【开场节点】→ 节点一进「开场白」、其余节点进「替代开场白」（ST 原生"可选开局"选择功能）；角色描述 + 高频行为 → 描述；【角色备注】→ 「深度提示」（Character's Note，情景下方，带深度/角色功能，**不进描述/作者注**）；【核心规则】【特别指令】→ 「系统提示」（逐字，**不进描述**）；数值系统 → 世界书专条（`常量: 是`）。世界书条目标题（`### 条目：名称`）写入条目 comment，在 ST 编辑器中作为条目标题显示。不再生成内嵌角色书（`character_book`）。

## 输入格式（摘要）

```text
【角色卡】
名称: 林晚
标签: 武侠、江湖
描述: 多行内容用缩进续行
  第二行
开场白: …

【世界书】
### 条目：青冥剑
关键词: 青冥剑; 青冥
位置: before_char        # before_char|after_char|ANTop|ANBottom|atDepth|EMTop|EMBottom|outlet
顺序: 120
深度: 4
内容: 条目内容，`内容:` 之后直到下一个标题都是正文（冒号/# 行不会被误判）
```

说明：`开场节点`/`角色备注`/`高频行为`/`核心规则`/`特别指令` 等键也会被识别——`开场节点` 拆分进开场白/替代开场白，`角色备注` 进深度提示，`高频行为` 并入描述，`核心规则`/`特别指令` 并入系统提示（见上文「区块映射」）。

完整字段别名表见方案文档 §5（`SillyTavern-角色卡世界书生成插件方案.md`）。

## 文件结构

```
manifest.json     # display_name/loading_order/js/css
index.js          # 入口：一键生成按钮/扩展程序图标/设置面板/弹窗/AI 适配/预览/应用导出
cardlore.css      # 弹窗样式（含按钮配色、移动端适配）
src/parser.js     # 文本 → AST（行级状态机，纯函数）
src/builder.js    # AST → 卡 V2 data + 世界书 entries（默认值对齐 1.18.0）
src/writer.js     # 写回 ST：saveWorldInfo + /api/characters/import
AI-DISCLOSURE.md  # AI 开发声明（DeepSeek Harness）
```

## 依赖的 ST 内部 API（1.18.0 实测）

| 用途 | 来源 |
|---|---|
| `saveWorldInfo` / `updateWorldInfoList` / `getFreeWorldName` | `public/scripts/world-info.js` |
| `getCharacters` / `selectCharacterById` / `getRequestHeaders` / `name1` / `saveSettingsDebounced` | `public/script.js` |
| `extension_settings` / `oai_settings` | `public/scripts/extensions.js` / `public/scripts/openai.js` |
| 「扩展程序」菜单 `#extensionsMenu`（`extensionsMenuExtensionButton`）、设置容器 `#extensions_settings` | `public/scripts/templates/wandMenu.html` / `public/index.html` |
| 角色导入 `POST /api/characters/import`（json） | `src/endpoints/characters.js`（readFromV2 保留 extensions.*） |

## 验证清单（浏览器 / 移动端）

- [ ] 刷新后，角色列表工具栏「新建角色」左侧出现琥珀色 ✨ 按钮，悬停显示"一键生成"
- [ ] （可选）顶栏「扩展程序」魔法棒菜单内也有 ✨ 图标
- [ ] 生成器内「AI 适配」在「解析预览」左侧；配置好接口后，粘贴任意文本点「AI 适配」能自动整理并预览
- [ ] 输入框右上角「展开」可全屏编辑：文本实时同步、`Esc`/「完成」收起、全屏内「解析预览」可用
- [ ] 「重置默认提示词」能恢复默认提示词
- [ ] 「应用」→ 角色库出现新角色，且「世界书」下拉里出现 `林晚的世界书`
- [ ] 该角色卡「深度提示」字段含角色备注内容；「替代开场白」含其余开场节点
- [ ] 导出的 `.card.json` 可被 ST 原生「导入角色」读回
- [ ] 手机浏览器：弹窗全屏可用、按钮触控区够大、输入框聚焦不自动缩放
