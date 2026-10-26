# 任务：执行链改真 + AI 诊断（A/B/C/D）

> **只读这一个文件就够了**。不要再去翻 `docs/` 下其它单子（那是别的任务）。
> 唯一额外要看的是 `AGENTS.md` 第 9 条（一句话：状态机线必须报步骤）。
> 行号已核对 2026-10-26。

---

## 背景（三句话）

1. 右侧「思考步骤流」显示的两条是**前端硬编码的假数据**（`page.tsx:7774`），因为**状态机线不调工具 ⇒ 后端不给 `steps`**（`chat/route.ts:6044` 只在工具分支返回）。
2. 「复制执行链」点了没反应，因为 `steps` 空时 `return` 了（`page.tsx:7753`），**无任何提示**。
3. 用户原话：「**看不到 AI 回复，每次要去服务器找很烦**」「**几万字人看不懂**」「**这个是否给 AI 看，人只看原因**」。

⇒ 目标：**人看结论，AI 看原文**。

---

## A. 通用面板改真（半天 · 只改前端）

**文件**：`src/app/agent/page.tsx`

| # | 行号 | 改什么 |
|---|---|---|
| 1 | `7770-7785` | **删掉假步骤兜底**（`['分析用户意图','组织回复']` @ `7774`）。`steps` 为空时显示一行灰字：「这一轮没有可展示的步骤」。**不许再编** |
| 2 | `7751-7758`（复制执行链） | `7770` 分支里 `if (!last) return` 之后**加提示**：`showToast('这一轮没有步骤可复制','error')`（`Toast` 见 `src/components/Toast.tsx:9-17`） |
| 3 | `7748` 标题旁 | 加一行小字：「步骤 = 后端实际执行的动作（不含 AI 思考）」 |

**验收**：日报线走一单 ⇒ 面板显示「这一轮没有可展示的步骤」（不再出现那两条假的）；点复制 ⇒ 有提示。

---

## B. 状态机步骤机制（半天 · 改 2 处）

**目标**：状态机线也能往 `steps` 里推，**和工具分支同一个通道**。

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `src/app/api/agent/chat/route.ts:3597-3605` | 把 `steps.push({tool,label,args})` 抽成一个可复用的 `pushStep(label, extra?)`，`label` **只要人话**（例：`看图 5 张`、`写文案 138 字`、`出片 132s`） |
| 2 | 同上 `6115-6118`（协议线返回处） | **协议线也要带 `steps`** —— 目前 `wfEarlyReply` 直返没有这个字段，把已推的步骤一并返回 |

**注意**：
- `steps` 元素格式保持 `{tool,label,args}` 不变（前端已按这个渲染），状态机线的 `tool` 可以填线名（如 `'vf_local'`）。
- **不落库**（本次不做）⇒ 刷新后仍会丢，这是已知限制，写进注释。

**验收**：任意状态机线跑一单，接口返回里 `steps` 有 3~5 条真实动作。

---

## C. 埋点（试点 1 条线 → 再铺开）

**先只做「图片成片」**（`vf_local`，内联在 `chat/route.ts`），验证好用再铺其余 6 条。

| 埋点位置（图片成片） | 文案示例 |
|---|---|
| 素材配比之后（约 `:5173` 附近） | `看图 5 张` |
| 文案生成之后（约 `:5242`） | `写文案 138 字` |
| 分镜生成之后（约 `:5315`） | `排 10 个镜头` |
| 出片提交前（约 `:5724`） | `开始出片` |

**验收**：跑一单 ⇒ 面板出现这 4 条 + 耗时。

**铺开清单（试点通过后）**：日报（归日报窗口）· 图视混剪 · 素材+AI · AI制片 · PPT成片 · HTML成片 · 获客。

---

## D. AI 读日志出结论（1~2 天 · 新文件 + 1 个接口）

**目标**：用户点「这次怎么了」⇒ **AI 读日志 ⇒ 给 3~5 条人话结论**（不是把日志丢给人）。

### D1 每单独立日志（不改现有 `vfLog`）

- 现有 `vfLog`（`video-material.ts:101-109`）是**按用户追加一个大文件** ⇒ 无法按单取。
- **新增**：同样内容再写一份 `storage/<uid>/video-factory/trace/<taskId>.log`（append）。
- 只给**新任务**写（老任务没有，不处理）。

### D2 新接口 `GET /api/agent/task-trace?taskId=xxx`

**照抄** `src/app/api/agent/daily-trace/route.ts` 的安全范式：
- 文件名白名单 `^[A-Za-z0-9._-]{3,80}$`（`:27`）
- 禁止 `..`（`:32`）
- 单文件上限 400KB（`:26`）
- 只读**自己**的目录（`storage/<auth.userId>/`）

返回：`{ ok, text }`（原文，供折叠展示与 AI 诊断输入）。

### D3 诊断函数（关键：不许编）

新文件 `src/lib/agent/task-diagnose.ts`：

```ts
export async function diagnoseTask(logText: string): Promise<Array<{ what: string; why: string; evidence: string; fix: string }>>
```

**prompt 硬约束（不许改软）**：
1. 每条结论**必须引用日志里的一行原文**（`evidence` 字段），**找不到就写「日志里没记这一项」**；
2. **不许推测**未在日志出现的原因；
3. 输出 3~5 条，每条 ≤40 字；
4. 只诊断，**不给代码改动建议**（避免 AI 乱开药方）。

模型：`deepseek-flash`（1.8s、便宜）。日志过长时**只取尾部 200 行 + 首个错误行**。

### D4 前端入口

- 卡片上加「🩺 这次怎么了」按钮 ⇒ 打开面板：
  - **上半：结论列表**（what / why / evidence / fix，默认展开）
  - **下半：「原始日志」折叠**（默认收起，可复制）
- **权限**：`auth.role === 'admin'` 看全量；普通用户只看 `what` + `fix`（**隐藏 evidence 原文**，避免泄露内部信息）。

**验收**：
- 造一个失败任务 ⇒ 诊断能说出「哪一步失败 + 日志原文」；
- 日志里没有错误时 ⇒ 诊断回答「日志没有异常」**而不是编**；
- 普通用户看不到 evidence 原文。

---

## 边界（不许碰）

| 不碰 | 原因 |
|---|---|
| `page.tsx:2670-2737`（`VfDailyTrace` 日报 AI 回执） | **归日报窗口** |
| `daily.ts` 的 trace 写入 | 同上 |
| `render.py` / `hyperframes` | 与本任务无关 |
| 任何"自动修复" | 本任务只做**看见** |

---

## 顺序与验证

| 顺序 | 做哪节 | 能独立验收吗 |
|---|---|---|
| 1 | **A** | ✅ 一眼能看（假步骤消失） |
| 2 | **B** | ✅ 接口返回里有 steps |
| 3 | **C**（只做图片成片） | ✅ 面板出现 4 条 |
| 4 | **D** | ✅ 造失败任务试 |

**tsc 基线 90**，新增必须 0：

```powershell
cd G:\AiMarketing
npx tsc --noEmit -p tsconfig.json *> temp\_daily\_tsc.txt
(Select-String -Path temp\_daily\_tsc.txt -Pattern 'error TS').Count
```

**提交**（用户明文说"可以提交"才做）：

```powershell
git add src/app/agent/page.tsx src/app/api/agent/chat/route.ts src/app/api/agent/task-trace/route.ts src/lib/agent/task-diagnose.ts
git commit -m "feat(诊断): VF_TASK_TRACE_V1 执行链改真(状态机报步骤+删假数据) + AI读日志出结论(带证据,不许编)"
git push origin master
```

并按 `AGENTS.md` 第 2 条同步三份文档。
