/**
 * ═══ ★PKG_SINGLE_PATH_V1（2026-09-28 用户定案：「保留一种打包方式」）═══
 *
 * 挂在 package.json 的 build.beforePack 上，用来【拦住绕过 build-local.mjs 的裸打包】。
 *
 * ■ 为什么必须拦（2026-09-28 真实事故，代价是一次错误发版）：
 *   直接跑 `npx electron-builder` 只会读 package.json 里的旧配置 —— 它会：
 *     ① 打出来的包【少 4 样】：语音模型 / 内置 Python 环境包 / OpenCLI 扩展 / 登录态保活脚本；
 *     ② 【跳过】build-local 的 4b 环境包闸门、4c 两侧内核对齐；
 *     ③ 【跳过】打包后把 latest.yml 的 url 改成 OSS 绝对地址那一步
 *        → 客户端检查更新能"看到"新版本，但下载 exe 是 404（实测就是这么炸的）。
 *   而且这些全都在"打包成功"的表象下发生，肉眼看不出来。
 *
 * ■ 规则：只认 `npm run electron:build`（= node scripts/build-local.mjs）。
 *   它会在环境变量里带 VF_BUILD_LOCAL=1 → 本拦截器放行；其它任何入口一律报错退出。
 *   （build-local 内部再用 build.local.json 调 electron-builder，且自己会跑
 *     scripts/verify-package.mjs 做出厂完整性校验。）
 */
export default async function packGuard() {
  if (process.env.VF_BUILD_LOCAL === '1') return   // 由 build-local.mjs 发起 → 放行

  const msg = [
    '',
    '❌ 禁止直接运行 electron-builder：本项目的安装包只允许【一条路】产出。',
    '',
    '   正确命令：  npm run electron:build          （= node scripts/build-local.mjs）',
    '   一键发版：  node scripts/release.mjs 1.0.215 "本次改了什么"',
    '',
    '   原因：裸 electron-builder 打出的包会少语音模型 / 内置 Python 环境包 / OpenCLI 扩展 /',
    '         登录态保活脚本，还会造成更新下载 404（详见 scripts/pack-guard.mjs 头部说明）。',
    '',
  ].join('\n')
  console.error(msg)
  throw new Error('PKG_SINGLE_PATH_V1: 请用 npm run electron:build（build-local.mjs）打包')
}
