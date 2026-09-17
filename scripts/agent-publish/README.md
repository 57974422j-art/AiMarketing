# AGENT 发布脚本（在用）

> 本目录是 **AGENT 发布链路**的确定性脚本。**改发布逻辑，只改这里的 `bu_pub_*.py`。**

## 真正被调用的，只有这 7 个文件

| 文件 | 用途 |
|---|---|
| `bu_pub_douyin.py` | 抖音发布 |
| `bu_pub_xhs.py` | 小红书发布 |
| `bu_pub_weibo.py` | 微博发布 |
| `bu_pub_shipinhao.py` | 视频号发布 |
| `bu_pub_kuaishou.py` | 快手发布 |
| `bu_pub_bilibili.py` | B站发布 |
| `_cdp_click.py` | CDP 穿透点击公共模块（被上面各脚本引用） |

**谁在调用它**：`electron/main.js` 的 `scriptMap`（`douyin → bu_pub_douyin.py` …）
**打包**：`scripts/build-local.mjs` 的 `extraResources`（`from: 'scripts/agent-publish'`）
**启动自检**：`main.js` 的 `need` 列表会校验这 7 个文件存在

## 不要在 agent-publish 里放历史/诊断脚本

已经归档到 **`scripts/_archive/agent-publish/`**（含 `douyin-agent.js`、`xhs-agent.js`、
`douyin-publish.agent.js`、`cover-fix.js`、`diag*.js`、`xhs-*.js` 等 38 个）。

★ 为什么归档到 **`scripts/_archive`** 而不是本目录下：打包规则是 `filter: ['**/*']`（整个目录全打），
放在本目录内**仍会被打进客户端**；放 `scripts/_archive` 才不会。

★ 为什么必须归档：这些脚本**名字很像"在用的"**（`*-agent.js`、`cover-fix.js`），
排查问题时极易看错 —— 2026-09-17 我就因此先判断错了方向。

## 历史坑（防重蹈）

1. **封面流程的"横竖选择窗"**：历史上多处写过"点「设置横封面 / 竖封面」"→ 会弹出横竖（比例）
   选择弹窗挡住发布按钮。2026-09-17 找到真根因：**`break` 被写进了注释**（成了 `"; break"` 文本）
   → 循环不中断 → 点中「完成」后继续找「保存」「确定」并点击 → 命中的正是那个横竖弹窗里的按钮。
   ★ **改这类 for 循环时，务必确认 `break` 是【代码】而不是【注释】**。
2. **标题填写循环同样的病**：`break` 也在注释里 → 3 个选择器各填一遍（日志 `✅ 标题已填 ×3`）
   + 因为 `for...else` 走完后误报 `⚠️ 未找到标题框`。
3. 排查手段：用脚本扫"`break` 出现在同一行注释里"的写法，比肉眼看快得多。

## 相关

- 指纹发布（另一条线，勿混）：`electron/fp-templates/*.js`
- 群控/魔云腾：`scripts/scrcpy`、`scripts/platform-tools`
- 方法论与各平台要点：见项目文档 `PROJECT.md` / `EXECUTION_LOG.md` 及记忆 `aimarketing-publish-script-method`
