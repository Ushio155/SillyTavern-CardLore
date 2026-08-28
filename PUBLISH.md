# 发布指南：把 CardLore 发布到 GitHub 供 SillyTavern 一键安装

SillyTavern 的第三方扩展安装器（扩展程序 → 管理扩展程序 → Install extension）本质是 **git clone 你的仓库到 `public/scripts/extensions/third-party/<仓库名>/`**。
所以**仓库根目录必须直接包含 `manifest.json`**（即本目录结构原样推送即可）。

## 一键发布脚本（推荐）

仓库创建 + 内容推送已封装为脚本 `publish.ps1`（位于仓库上级目录，不要提交进仓库）：

```powershell
cd D:\code_practice\AI_coding\script
.\publish.ps1
```

脚本自动完成：
1. 用你的 GitHub Token 通过 API **创建 Public 仓库**（`SillyTavern-CardLore`，不自动生成文件）
2. 替换 `manifest.json` 的 `homePage` 占位符为你的真实地址
3. `git init → add → commit → branch main → push`
4. 打并推送标签 `v1.0.0`

> Token 获取：github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → 勾选 **repo** → 生成后复制（仅本次使用，用完可删除）。

推送完成后，**手动创建 Release**（见文末「五、版本发布与更新」）。

## 一、发布前检查清单

- [ ] 仓库根目录含 `manifest.json`（`js`/`css` 路径正确：`index.js` / `cardlore.css`）
- [ ] `manifest.json` 的 `version` 已设为发布版本（如 `1.0.0`）
- [ ] `manifest.json` 的 `homePage` 填你的 GitHub 仓库地址（ST 扩展管理器会显示链接）
- [ ] `README.md` 已包含：简介、安装方法、使用说明、兼容版本
- [ ] `LICENSE`（MIT）已存在
- [ ] 本机实测通过（解析/预览/应用/导出/AI 适配）

## 二、创建 GitHub 仓库并推送

```bash
# 1. 在 github.com 新建仓库（Public），仓库名建议：SillyTavern-CardLore
#    不要勾选 README/.gitignore/LICENSE（本地已有，避免冲突）

# 2. 本地初始化并推送
cd D:\code_practice\AI_coding\script\SillyTavern-CardLore
git init
git add .
git commit -m "feat: CardLore 角色卡·世界书生成器 v1.0.0"
git branch -M main
git remote add origin https://github.com/<你的用户名>/SillyTavern-CardLore.git
git push -u origin main
```

> 若未安装 git：https://git-scm.com/download/win

## 三、在 SillyTavern 中安装

**方式 A：Git 安装（推荐，可后续一键更新）**
1. ST 顶栏 → 扩展程序（魔法棒）→ 管理扩展程序
2. 点击 **Install extension**（导入扩展）
3. 粘贴仓库地址：`https://github.com/<你的用户名>/SillyTavern-CardLore`
4. 安装完成后刷新页面，即可使用

**方式 B：ZIP 手动安装**
1. GitHub 仓库页面 → Code → Download ZIP
2. 解压后把 `SillyTavern-CardLore` 文件夹放进 `public/scripts/extensions/third-party/`
3. 刷新页面

## 四、（可选）加入官方扩展列表，让全球用户可搜索到

SillyTavern 官方维护了扩展索引 [SillyTavern/Extension-List](https://github.com/SillyTavern/Extension-List)：

1. fork 该仓库
2. 编辑 `index.json`，在末尾追加你的条目：
```json
{
  "name": "CardLore",
  "description": "粘贴任意文本，自动生成角色卡与世界书（支持 OpenAI 兼容 API 智能整理）",
  "url": "https://github.com/<你的用户名>/SillyTavern-CardLore",
  "author": "<你的用户名>",
  "tags": ["character", "world-info", "AI", "generator"]
}
```
3. 提交 Pull Request（英文描述更佳）
4. 合并后，ST 用户即可在扩展安装器内直接搜索到

## 五、（可选）版本发布与更新

- 每次修改后：更新 `manifest.json` 的 `version` → `git add . && git commit && git tag v1.0.1 && git push --tags`
- ST 用户点扩展管理器里的 **Update** 即可拉取更新（若开启 `auto_update` 更佳：manifest 中可加 `"auto_update": true`）

## 六、注意事项

- **不要**把 ST 数据、密钥、`.env` 等提交到仓库（`.gitignore` 已包含常见项）
- API Key 等敏感信息永远只存在用户本机 `extension_settings`，仓库内不得出现
- 若引用了他人的模板/代码，保留来源许可
- 中文 README 可加一份 `README_en.md` 方便海外用户
