# 任务：执行步骤埋点 · 第二批（5 条线）

> 交给**改图片成片的那个窗口**执行（它已经懂了这套机制）。
> **只读这一个文件**，不用翻其它单子。
> ⚠️ **HTML 成片那条由日报窗口做，本单不做**；日报线已经埋好了，也不用管。

---

## 0. 背景（三句话）

1. 机制已上线：`pushStep(label, {tool, forOrder})` 在 `src/app/api/agent/chat/route.ts`，
   前端右侧「思考步骤流」读响应里的 `steps`。
2. **图片成片**（4 条）和**日报**（3~4 条）已经埋好、已验证。
3. 本单只补剩下的 **5 条线**：图视混剪 / 素材+AI / AI制片 / PPT成片 / 获客。

---

## 1. 铁律

1. **一条步骤 = 一个真实动作 + 数量/结果**（`看图 5 张` / `排 10 个镜头` / `出片 132s`），
   **绝不写 AI 的思考**；
2. **每条线 3~6 条**足够，不要铺满；
3. **失败也要留一条**（`出片失败 · <原因前 20 字>`），否则失败时面板是空的；
4. **label ≤20 字**；
5. **不许改渲染、不许改业务逻辑** —— 只加"报告一句"的调用。

---

## 2. 先做一件事：确认 ctx 是不是同一个对象

在 `src/app/api/agent/chat/route.ts` 里搜 `log: (u: number | string, s: string) =>`（日报 ctx 的写法，
约 `:4496`），看**其它 5 条线**的 `ctx` 是怎么造的：

| 情况 | 做法 |
|---|---|
| **所有线共用同一个 ctx 对象** | 只需在那一处加 `step: (label, extra) => pushStep(label, { tool: '<线名>', forOrder: true, ...(extra \|\| {}) })` —— **一次搞定**（但 `tool` 要动态，见下） |
| **每条线各造一份 ctx** | 每处各加一行（`tool` 写死成该线名） |

⚠️ 若共用同一个对象，`tool` 必须能区分线名 ⇒ 建议传参：`step(label, { tool: 'vf_video' })`，
或者在每线的入口处把 `ctx.step` 包一层写死 `tool`。

---

## 3. 五条线的埋点语义

| 线 | 建议步骤（按实际流程取舍） | `tool` |
|---|---|---|
| **图视混剪** `vf-video.ts` | `看图 N 张` / `写文案 N 字` / `排 N 个镜头` / `提交出片` | `vf_video` |
| **素材+AI** `vf-mix.ts` | `取素材 N 张` / `写文案 N 字` / `排 N 个镜头` / `提交出片` | `vf_mix` |
| **AI制片** `vf-aivideo.ts` | `定题材` / `写文案 N 字` / `排 N 个镜头` / `逐镜生成（N 镜）` / `提交出片` | `vf_aivideo` |
| **PPT成片** `vf-ppt.ts` | `排 N 段版式` / `生成 N 页` / `提交出片` | `vf_ppt` |
| **获客** `vf-lead`（若有独立文件） | `读账号` / `生成话术` / `提交任务` | `vf_lead` |

**落点怎么找**：每条线里都在调 `ctx.log?.(uid, '[xxx] …')` —— **在关键 `ctx.log` 旁边加一行 `ctx.step?.()`** 即可，
语义与那条日志一致（日志写"排了 10 镜"，步骤就写"排 10 个镜头"）。

---

## 3.5 额外一条：给 HTML 成片补 `step` 传参（**只补机制，不改调用点**）

**背景**：日报窗口已经在 `vf-htmlfilm.ts` 里埋好了 `ctx.step?.(...)` 调用点，
但 `route.ts` 构造 `HtmlFilmCtx` 时**没有把 `step` 传进去** ⇒ 那些调用现在是**空转**（`?.` 静默跳过）。
日报窗口明确说了："route.ts 里要真让这些步骤上报，得在构造 HtmlFilmCtx 时把 step 传进去 —— 那是机制那边的事。"

**本单负责机制这一半**：在 `src/app/api/agent/chat/route.ts` 里搜 `handleHtmlFilmLine({`
（HTML 成片线的 ctx 构造处），加上一行：

```ts
step: (label: string, extra?: { tool?: string; since?: number; args?: string }) =>
  pushStep(label, { tool: 'vf_htmlfilm', forOrder: true, ...(extra || {}) }),
```

- ⚠️ **不要动 `vf-htmlfilm.ts` 里的调用点**（那是日报窗口的活，改了会互相覆盖）
- ⚠️ 同时给 `HtmlFilmCtx` 的类型加可选字段 `step?`（照第 4 节写法）

**验收**：跑一单 HTML 成片 ⇒ 面板出现「看图 / 排段 / 写文案 / 生成页面 / 提交出片」中的若干条。
**如果出片正常但步骤仍为空** ⇒ 说明 `pushStep` 那条通道在该分支没走到（把现象记下来，不要硬改）。

---

## 4. 类型补充（必须做，否则编译报错或要 `as any`）

各线的 Ctx 类型里加可选字段：

```ts
step?: (label: string, extra?: { tool?: string; since?: number; args?: string }) => void
```

- 必须先加类型、再用 `ctx.step?.()`；
- **不要用 `as any`**（日报那边因为类型没补才用的，属于欠债，别扩散）。

---

## 5. 验收

| # | 做什么 | 应该看到 |
|---|---|---|
| 1 | 图视混剪跑一单 | 面板 3~5 条，带耗时，**没有一条是"分析用户意图"这种假话** |
| 2 | 素材+AI / AI制片 / PPT成片 各跑一单 | 同上 |
| 3 | **故意造一个失败**（比如选没有素材的仓库） | 面板**有**「…失败 · 原因」这一条 |

`tsc` 基线 **90**，新增必须 0：

```powershell
cd G:\AiMarketing
npx tsc --noEmit -p tsconfig.json *> temp\_daily\_tsc.txt
(Select-String -Path temp\_daily\_tsc.txt -Pattern 'error TS').Count
```

---

## 6. 边界（不许碰）

| 不碰 | 原因 |
|---|---|
| `daily.ts` / `VfDailyTrace` / `page.tsx` 右侧面板 | 日报窗口与已完成的 A 节 |
| `vf-htmlfilm.ts`（HTML成片） | **日报窗口在做** |
| `banner.ts` / `render.py` / `hyperframes` | 与埋点无关 |
| 任何业务逻辑、任何超时/重试参数 | 本单只加"报告" |

---

## 7. 完成后

按 `AGENTS.md` 第 2 条同步三份文档（`EXECUTION_LOG.md` / `PROJECT.md` / `ISSUES.md`）。
**不要自己 commit/push**（等用户明文说"可以提交"）。
