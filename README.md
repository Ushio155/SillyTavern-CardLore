# SillyTavern-CardLore 插件

「填写即生成」角色卡 + 世界书生成器（SillyTavern 1.18.0 实测，兼容移动端窄屏）。

## 许可与开发声明

- 本插件以 **MIT 许可证** 开源（见 `LICENSE`），可自由使用、修改与再分发（保留版权声明即可）。
- 本插件功能需求设计由作者本人完成，借助 **DeepSeek Harness**（AI 编程助手）辅助完成代码实现、调试以及发布相关样板工作，详细声明见 [`AI-DISCLOSURE.md`](./AI-DISCLOSURE.md)。
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

**入口（三处）**：
1. 角色列表工具栏，「新建角色」按钮**左侧**的琥珀色 ✨ 按钮（悬停显示"一键生成"）—— 最显眼，推荐
2. 顶栏左侧「扩展程序」魔法棒菜单内的 ✨ 图标
3. 「扩展程序」设置面板中 CardLore 标题栏内的「✨ 一键生成」按钮（无论折叠/展开都可见，点击直接打开生成器）

点击后打开生成器：

1. 粘贴**任意原始文本**（无需关心插件格式）。输入框右上角「**展开**」可切换全屏编辑，方便查看和修改整段文本（编辑实时同步，`Esc` 或「完成」收起；全屏内也可直接「解析预览」）。
   - 也可以用本地文件作为素材：提示行「载入示例」右侧的琥珀色「**导入素材**」支持拖入或点击选择 **.txt / .md / .docx**（可多选、可重复添加），添加后文件名以标签显示在输入框下方（点 × 移除）。适合导入 Word/纯文本里的设定稿、小说、大纲等长文，再交给「AI 适配」整理。
2. 点「**AI 适配**」（🤖，解析预览左侧）——通过 **OpenAI 兼容接口**自动整理成插件格式并立即预览。已添加的素材文件会与输入框文本**一并合并**送入；整理完成回填后素材列表自动清空，避免重复合并。
   - **默认方案（推荐，免填 Key）**：预设方案列表第一项。直接借用 ST 顶部「**API 连接**」里的来源、模型与额度——插件内不用填接口地址和 API Key，ST 里能正常聊天就能用。切换方式：「预设方案」点第一项「**启用**」，或在「AI 接口设置 → 调用方式」里点「使用 ST 当前连接」。
   - 想用别的 Key/额度：展开「AI 接口设置」→ 展开「**预设方案**」选一家（DeepSeek / OpenAI / Kimi / 通义 / GLM / 硅基流动 / Groq / OpenRouter / 本地 Ollama），点「填入」自动填好地址与模型（默认填入各家当前最具性价比的模型，如 DeepSeek 为 `deepseek-v4-flash`）；填 API Key 后点「保存设置」。
   - 「调用方式」也可直接手动切到「自定义接口」，自行填 OpenAI 兼容地址 / API Key / 模型（不填 Key 时地址会按 ST 当前来源预填）。
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
src/filetext.js   # 素材文件提取：.txt/.md 编码识别(UTF-8→GB18030) + .docx 解压取文
AI-DISCLOSURE.md  # AI 开发声明（DeepSeek Harness）
```

## 依赖的 ST 内部 API（1.18.0 实测）

| 用途 | 来源 |
|---|---|
| `saveWorldInfo` / `updateWorldInfoList` / `getFreeWorldName` | `public/scripts/world-info.js` |
| `getCharacters` / `selectCharacterById` / `getRequestHeaders` / `name1` / `saveSettingsDebounced` | `public/script.js` |
| `extension_settings` / `oai_settings` | `public/scripts/extensions.js` / `public/scripts/openai.js` |
| `getContext().ChatCompletionService`（「默认方案」走 ST「API 连接」发请求） | `public/scripts/custom-request.js`（`ChatCompletionService.processRequest` → `POST /api/backends/chat-completions/generate`） |
| 「扩展程序」菜单 `#extensionsMenu`（`extensionsMenuExtensionButton`）、设置容器 `#extensions_settings` | `public/scripts/templates/wandMenu.html` / `public/index.html` |
| 角色导入 `POST /api/characters/import`（json） | `src/endpoints/characters.js`（readFromV2 保留 extensions.*） |
| JSZip（.docx 解压，运行时动态加载） | ST 自带静态资源 `public/lib/jszip.min.js` |

## 验证清单（浏览器 / 移动端）

- [ ] 刷新后，角色列表工具栏「新建角色」左侧出现琥珀色 ✨ 按钮，悬停显示"一键生成"
- [ ] （可选）顶栏「扩展程序」魔法棒菜单内也有 ✨ 图标
- [ ] 生成器内「AI 适配」在「解析预览」左侧；配置好接口后，粘贴任意文本点「AI 适配」能自动整理并预览
- [ ] 「默认方案」：预设方案第一项显示 ST「API 连接」的当前来源与模型；点「启用」后不填地址/Key 也能「AI 适配」成功（地址/Key/模型三行置灰）
- [ ] 「AI 接口设置」展开后内容过长时可在块内上下滑动，底部「保存设置 / 重置默认提示词」始终吸底可见可点（小窗口 / 窄屏同样如此）
- [ ] 移动端「保存设置 / 重置默认提示词」与上方「导出 JSON / 应用：创建角色+世界书」同款：两等宽铺满整行、字号/高度一致，不与上方错位或缩小
- [ ] 输入框右上角「展开」可全屏编辑：文本实时同步、`Esc`/「完成」收起、全屏内「解析预览」可用
- [ ] 「重置默认提示词」能恢复默认提示词
- [ ] 「应用」→ 角色库出现新角色，且「世界书」下拉里出现 `林晚的世界书`
- [ ] 该角色卡「深度提示」字段含角色备注内容；「替代开场白」含其余开场节点
- [ ] 导出的 `.card.json` 可被 ST 原生「导入角色」读回
- [ ] 「导入素材」：拖入/选择 .txt 与 .docx 各一 → 文件名标签出现在输入框下方；素材含「特定格式」内容时点「解析预览」可合并解析；「清空素材」红底白字可清待选
- [ ] 手机浏览器：弹窗全屏可用、按钮触控区够大、输入框聚焦不自动缩放

## 更新历史

**v1.2.1（开发中 · dev 分支）**
- ✨ **「AI 适配」新增「默认方案」**：未填写 CardLore 自有 API Key 时，默认直接复用 ST「API 连接」里已配置好的来源与模型（DeepSeek / OpenAI / 自定义…），**地址与 Key 都不用填**；预设方案列表第一项即为「默认方案」（带「推荐」徽标），随时可切回「自定义接口」
- 🔄 各厂商预设模型更新为当前最具性价比的型号（如 DeepSeek → `deepseek-flash`）
- 🐛 修复：「AI 接口设置」折叠区内容过长时底部「保存设置 / 重置默认提示词」被挤出可视区、点不到 → 折叠区改为块内可上下滑动 + 底部操作条吸底常驻
- 🐛 修复：折叠区改成滚动容器后，「预设方案」块被 flex 压成一条线而"消失"（滚动容器内子块禁止压缩）
- 📱 移动端「保存设置 / 重置默认提示词」与上方工具栏按钮同款：两等宽铺满整行、字号还原为面板基准，不再比上方小一圈

**v1.2.0（正式版）**
- ✨ **新增「导入素材」**：提示行「载入示例」右侧新增琥珀色「导入素材」入口，支持拖入或点击选择 **.txt / .md / .docx**（可多选，上限 20 个 / 单文件 20MB，超长自动截断）。
  - 添加后文件名以标签显示在输入框下方（点 × 可移除），并与输入框文本**一并合并**参与「解析预览」与「AI 适配」；AI 整理完成回填后素材列表自动清空，避免重复合并。
  - GBK 编码 txt 自动识别回退；.docx 复用 ST 自带 JSZip 解压取文，**插件无新增依赖**。
- ✨ 「扩展程序」设置面板统一为 ST 原生折叠面板（inline-drawer），标题栏内置「✨ 一键生成」按钮（折叠/展开均可用）
- 📱 移动端（≤640px）底部工具栏自动两行布局：第一行 AI 适配 / 解析预览 / 清空预览，第二行 导出 JSON / 应用（PC 单行 5 按钮不变）；「展开」按钮移至右下角胶囊；展开编辑器操作按钮横排、触控区加大
- 💡 输入框占位与解析警告后追加「AI 适配」引导文案
- 🐛 修复：输入框占位文字因右侧大留白提前换行（改为仅底部留白避让「展开」按钮）
- 📄 AI-DISCLOSURE.md 更新 AI 开发声明（设计由作者完成、AI 辅助实现与发布）；README 补充依赖的 ST 内部 API 说明

更早版本变更见 GitHub Releases。
