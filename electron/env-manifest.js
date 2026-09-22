/**
 * ═══ ENV_MANIFEST_V1（2026-09-22 用户定案：「自检要精准，缺什么补什么」）═══
 *
 * 这份文件是【唯一的依赖清单 + 版本表】—— 打包与运行时共用同一份：
 *   · 运行时：启动自检逐项对照它 → 缺 / 版本不符 → 【立刻从包内补齐】→ 复检 → 不合格【不进下一步】
 *   · 打包时：scripts/build-local.mjs 用同一份清单校验产物（包内必须有 zip，且 zip 里的
 *     env-manifest.json 与这里声明【一致】）→ 不一致【直接打包失败】
 *   ⇒ 从此"版本对不上"在【打包阶段】就被卡住，不会再流到用户机器上（这就是这次反复出问题的根因）。
 *
 * 用户定稿的规则（不得回退）：
 *   ① 版本不是最新 → 不给用（版本闸门在 main.js，发现更新只做更新）
 *   ② 没网络 → 客户端不启动（弹窗让联网；连账号都验不了，不给用）
 *   ③ 自检【禁止"没有就跳过"】：所有 blocking 项必须通过才能进入下一步
 *   ④ 补齐来源优先级：包内自带（主）→ 本地备份 → OSS 下载（只在这两级都坏时才用）
 *   ⑤ 用户数据（data/、storage/、以及 python/ 下的用户内容）永不删除；
 *      不合格的目录【改名保留】（*.bak-时间戳）后重建 —— 宁可他手动清，也绝不误删
 *   ⑥ 登录态目录（data/browser-profile/{账号Id}）只判"目录可写"，绝不读内容、绝不重建；
 *      首次安装为空目录 = 【正常】，不是失败（所以自检里没有"已登录"这一项）
 *
 * ⚠️ 改动约定：以后加依赖【只改这张表】+ 在 build-local.mjs 里补一条 extraResources。
 */

/** 环境包自身版本（重建 zip 时由 make-python-pack.mjs 写进 zip 内的 env-manifest.json） */
const ENV_PACK_VERSION = '2026-09-22.1'

/** 版本规格（spec）：'1.2.3' = 必须精确等于；'>=3.10 <3.15' = 区间；'' = 只查存在不查版本 */
const RUNTIME = {
  python: { spec: '>=3.10 <3.15', why: '太老装不上新依赖，太新第三方轮子可能没有' },
  playwright: { spec: '1.62.0', why: '与打包进包内的浏览器内核严格对应（Python 侧）' },
  browser_use: { spec: '0.13.10', why: '发布脚本依赖的 API' },
}

/**
 * ★PY_PACKAGES_V1（2026-09-22）：环境包里【必须装】的 Python 包（唯一真源）。
 *   依据 = 发布/采集脚本里真实出现的第三方 import（scripts/browser-use/*.py、scripts/agent-publish/*.py）：
 *     browser_use / playwright / dotenv / PIL
 *   make-python-pack.mjs 用这份清单造包；env-install 用这份清单逐项 import 校验（缺哪个说哪个）。
 *   ⚠️ 以后脚本里新增第三方 import，必须同时加到这张表 —— 否则"本机能跑、用户机器缺库"。
 */
const PY_PACKAGES = [
  { pkg: 'playwright', spec: '1.62.0', imp: 'playwright.sync_api', why: '开浏览器（发布/采集）' },
  { pkg: 'browser_use', spec: '0.13.10', imp: 'browser_use', why: 'browser-use 执行器' },
  { pkg: 'python-dotenv', spec: '', imp: 'dotenv', why: 'bu_pub_*.py 里 from dotenv' },
  { pkg: 'pillow', spec: '', imp: 'PIL', why: '图片处理（封面/图文）' },
]

/**
 * 浏览器内核目录（Node 侧）：打包到 <resources>/ms-playwright。
 *
 * ★BROWSER_ALIGN_V1（2026-09-22 实测踩到，正是用户说的"又是版本对不上"）：
 *   playwright 要的内核是【按 build 号找目录】的，两侧版本不同 → 要的内核就不同：
 *     · Node 侧 playwright 1.60.0 → 期望 chromium-1223
 *     · Python 侧 playwright 1.62.0 → 期望 chromium-1234
 *   而本机 ms-playwright 里只有 **chromium-1228** —— 两边**都对不上**！
 *   后果：
 *     ① 包内 Chromium 兜底（"用户没装 Chrome 也能用"）**实际是失效的**
 *        （findBrowserExe → chromium.executablePath() 指向 1223 → 文件不存在 → 返回 null）
 *     ② 更隐蔽的：main.js 会把 PLAYWRIGHT_BROWSERS_PATH 设成 <resources>/ms-playwright，
 *        这个变量【Python 子进程会继承】→ Python 的 1.62 去那里找 1234 → 找不到 → 发布失败
 *   ⇒ 修法（本文件 + 打包脚本 + 运行时三处配合）：
 *     · Node 侧：内核必须放进 <resources>/ms-playwright，且打包时用【Node 自己的】
 *       playwright 去装（build-local.mjs：npx playwright install chromium，装进该目录）
 *     · Python 侧：内核放进【环境包自己的】目录 <安装目录>/python/ms-playwright
 *       （make-python-pack.mjs 用环境包里的 python 去装），运行时只给 Python 子进程
 *       注入指向它自己的目录 —— 两侧各管各的，谁也不用猜对方要哪个 build。
 *   两个目录的 build 号不在代码里写死：校验一律【问各侧的 playwright 本人】
 *   （chromium.executable_path），它说在哪就得在哪 —— 从根上消灭"对不上"。
 */
const BROWSERS_DIR = 'ms-playwright'

/**
 * 依赖项清单。
 *   kind: 'zip'    → 需要解压的目录（包内 resources/<zipName>）
 *         'files'  → 必须存在的一组文件
 *         'exeAny' → 一组候选可执行文件里【至少一个】存在
 *   blocking: true → 未通过【不允许进入下一步】（用户定稿③）
 */
const ITEMS = [
  {
    id: 'python-bu',
    title: '内置运行环境（Python + playwright + browser_use）',
    kind: 'zip',
    blocking: true,
    // 包内自带（extraResources → <resources>/python-bu.zip）
    zipName: 'python-bu.zip',
    // 解压目标：<安装目录>\python（与旧版 ensureBuPython 一致，沿用不迁移）
    dest: 'python',
    // 解压后应出现的目录（用于"版本校验"与"旧目录改名保留"）
    //   ★注意：python.exe 可能在 buvenv-test\ 根下（全量安装式，可整体搬走）
    //     也可能在 buvenv-test\Scripts\ 下（venv 式）—— 两种都支持，别写死一层。
    expectDir: 'python/buvenv-test',
    // 环境包里必须能 import 的包（缺哪个就说哪个，见 env-install 的 pyimport 校验）
    packages: PY_PACKAGES,
    // 解压后应出现的清单文件（版本校验的唯一依据）
    innerManifest: 'env-manifest.json',
    verify: 'pyimport',
    ossUrl: 'https://aimarketing-1.oss-cn-hangzhou.aliyuncs.com/updates/python-bu.zip',
  },
  {
    id: 'python-browsers',
    title: 'Python 侧浏览器内核（发布脚本要用）',
    kind: 'pybrowser',
    blocking: true,
    // ★BROWSER_ALIGN_V1：校验方式不是"看目录里有没有 chromium"，而是【问 Python 的 playwright 本人】：
    //   它给出 executable_path，我们就查那个文件在不在 —— build 号对上没对上，一眼见分晓。
    //   缺了可以补：用这个 python 的 playwright 把内核装进两侧共用的 <resources>/ms-playwright。
    note: '发布脚本是 Python 跑的，它用的是 Python 版 playwright（和 Node 版要的 build 号常常不同）',
  },
  {
    id: 'node-browsers',
    title: '包内浏览器内核（Node 侧：指纹浏览器 / 没装 Chrome 时的兜底）',
    kind: 'nodebrowser',
    // ★为什么不 blocking：它在运行时【无法自动补】——包内内核是随安装包来的，
    //   客户端里没有 npx/npm 可以现场装。所以"拦人"没有意义（拦了用户也没法自救），
    //   改为明确告警 + 由【打包阶段的硬闸门】保证出厂就是对的（build-local.mjs 4c）。
    //   真正的硬拦在下面 preflight 项（系统 Chrome/Edge 与包内内核全都不可用 → 不能发布 → 拦住）。
    blocking: false,
    dir: 'resources/' + BROWSERS_DIR,
    note: '系统没有 Chrome/Edge 时，登记与发布就用它（用户定稿：哪怕用户没装 Chrome 也能用）',
  },
  {
    id: 'publish-scripts',
    title: '发布脚本（6 平台 + CDP 点击模块）',
    kind: 'files',
    blocking: true,
    files: [
      'resources/scripts/agent-publish/bu_pub_douyin.py',
      'resources/scripts/agent-publish/bu_pub_xhs.py',
      'resources/scripts/agent-publish/bu_pub_weibo.py',
      'resources/scripts/agent-publish/bu_pub_shipinhao.py',
      'resources/scripts/agent-publish/bu_pub_kuaishou.py',
      'resources/scripts/agent-publish/bu_pub_bilibili.py',
      'resources/scripts/agent-publish/_cdp_click.py',
    ],
    minBytes: 50,
  },
  {
    id: 'browser-use-scripts',
    title: '浏览器执行器 / 热点采集脚本',
    kind: 'files',
    blocking: true,
    files: [
      'resources/scripts/browser-use/bu_exec.py',
      'resources/scripts/browser-use/bu_hot.py',
    ],
    minBytes: 50,
  },
  {
    id: 'platform-tools',
    title: '安卓工具（adb —— 群控/采集要用）',
    kind: 'exeAny',
    blocking: true,
    exeAny: ['resources/scripts/platform-tools/adb.exe'],
  },
  {
    id: 'scrcpy',
    title: '投屏工具（scrcpy）',
    kind: 'exeAny',
    blocking: true,
    exeAny: ['resources/scripts/scrcpy/scrcpy.exe'],
  },
  {
    id: 'asr-lib',
    title: '本地语音识别库（sherpa-onnx）',
    kind: 'files',
    blocking: false, // 见 note：目前它在 package.json 的 files 白名单里被排除 → 先报"不可用"，别把人挡在门外
    files: ['node_modules/sherpa-onnx-node/package.json'],
    note: '⚠️ 目前 package.json 的 files 里被 "!node_modules/sherpa-onnx-node/**" 排除 → 打包后必然缺失。' +
      '缺了只有"本地语音识别"不可用，不影响登记/发布（所以不 blocking）；要修就得动 files 白名单 —— 待定，见 ISSUES.md',
  },
]

/** 安装根目录（exe 同级）—— 运行时有 process.execPath，打包校验时由调用方传 */
function installRoot() {
  try {
    return require('path').dirname(require('electron').app.getPath('exe'))
  } catch (e) {
    return ''
  }
}

/**
 * 版本规格匹配：spec 为空 → 一律通过（只查存在）
 *   '1.62.0'        → 必须等于
 *   '>=3.10 <3.15'  → 区间（可混合 >= <= > < =）
 */
function matchSpec(actual, spec) {
  const a = String(actual || '').trim()
  if (!spec) return true
  if (!a) return false
  const s = String(spec).trim()
  if (!/^[<>=]/.test(s)) return a === s   // 纯版本号 = 精确匹配
  for (const part of s.split(/\s+/)) {
    const m = part.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*)$/)
    if (!m) continue
    const op = m[1] || '='
    const t = m[2].split('.').map(Number)
    const c = a.split('.').map((x) => parseInt(x, 10) || 0)
    const n = Math.max(t.length, c.length)
    let cmp = 0
    for (let i = 0; i < n; i++) {
      const x = c[i] || 0, y = t[i] || 0
      if (x !== y) { cmp = x > y ? 1 : -1; break }
    }
    if ((op === '>=' && cmp < 0) || (op === '>' && cmp <= 0) ||
        (op === '<=' && cmp > 0) || (op === '<' && cmp >= 0) ||
        (op === '=' && cmp !== 0)) return false
  }
  return true
}

module.exports = { ENV_PACK_VERSION, RUNTIME, PY_PACKAGES, BROWSERS_DIR, ITEMS, installRoot, matchSpec }
