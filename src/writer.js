/**
 * writer.js — 将构建结果写回 SillyTavern（基于 1.18.0 源码实测的稳定路径）
 *
 * 落盘路径（方案文档 §6 路径 A/B 的组合）：
 *  1) 世界书：saveWorldInfo 直写（POST /api/worldinfo/edit）
 *  2) 卡片关联：cardData.data.extensions.world = bookName
 *     （ST 以 data.extensions.world 识别角色-世界书绑定）
 *  3) 角色卡：POST /api/characters/import（file_type=json）导入，
 *     服务端 readFromV2 保留 data.extensions.*，
 *     不触碰 create_save/DOM，天然规避「编辑模式 vs 新建模式」状态问题。
 */
import { getRequestHeaders, name1, getCharacters } from '../../../../../script.js';
import { saveWorldInfo, updateWorldInfoList, getFreeWorldName, deleteWorldInfo } from '../../../../world-info.js';

/**
 * @param {object} params
 * @param {object} params.createSave       buildCard() 产出的 create_save 形状（用于命名/后缀）
 * @param {object} params.cardData         buildCard() 产出的角色卡 V2 data
 * @param {object|null} params.worldBook   buildBook() 产出的世界书（ST entries 格式）
 * @param {object} params.settings         插件设置（bookNameSuffix 等）
 * @param {(msg: string) => void} [params.onProgress]
 * @returns {Promise<{avatar: string, bookName: string}>}
 */
export async function applyToST({ createSave, cardData, worldBook, settings, onProgress = () => { } }) {
    let bookName = '';

    // 1) 世界书落盘
    if (worldBook && Object.keys(worldBook.entries).length > 0) {
        bookName = getFreeWorldName(`${createSave.name}${settings?.bookNameSuffix ?? '的世界书'}`);
        onProgress(`保存世界书「${bookName}」…`);
        await saveWorldInfo(bookName, worldBook, true);
        await updateWorldInfoList();
    }

    // 2) 卡片关联世界书
    if (bookName) {
        cardData.data.extensions.world = bookName;
    }

    // 3) 导入角色卡（JSON）
    // ⚠️ 这一段失败必须把第 1 步刚建的世界书删掉。顺序是「先存书、再导卡」，中间失败时原来
    //    什么都不回滚 —— 用户的世界书列表里会留下一本**没有任何角色指向**的孤儿书，
    //    而且它名字带 (1)，下次再应用又会新建一本 (2)，一轮一轮攒下去。
    try {
        onProgress('导入角色卡…');
        const file = new File([JSON.stringify(cardData, null, 2)], `${createSave.name}.json`, { type: 'application/json' });
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('file_type', 'json');
        formData.append('user_name', name1);

        const response = await fetch('/api/characters/import', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
            body: formData,
            cache: 'no-cache',
        });

        const result = await response.json().catch(() => ({}));
        // ST 的失败分支是 `response.send({ error: true })`（error 是布尔），所以不能只把它拼进消息里
        if (!response.ok || result.error || !result.file_name) {
            throw new Error(
                typeof result.error === 'string'
                    ? result.error
                    : `角色卡导入失败（HTTP ${response.status}）`,
            );
        }

        await getCharacters();
        return { avatar: `${result.file_name}.png`, bookName };
    } catch (err) {
        if (bookName) {
            onProgress(`角色卡导入失败，回滚世界书「${bookName}」…`);
            try {
                const removed = await deleteWorldInfo(bookName);
                if (!removed) {
                    console.warn('[CardLore] 世界书回滚未生效（deleteWorldInfo 返回 false）', bookName);
                    err.message = `${err.message}（另：世界书「${bookName}」未能自动回滚，请手动删除）`;
                }
            } catch (rollbackErr) {
                // 回滚失败不能盖掉原始错误，但要留痕，让用户知道要去手动清一本
                console.error('[CardLore] 世界书回滚失败', rollbackErr);
                err.message = `${err.message}（另：世界书「${bookName}」回滚失败，请手动删除）`;
            }
        }
        throw err;
    }
}

/** 下载 JSON 文件（导出路径） */
export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
