/**
 * ★VF_CLEANUP_V2（2026-09-30）：Next.js 的**服务器启动钩子** —— 全项目第一个定时任务的挂载点。
 *
 * 为什么需要它：本项目此前**没有任何定时机制**（`src/lib/cleanup.ts` 的清理函数靠人手调，
 * 等于从没跑过），而实测出现了四处真实垃圾（发布抽帧的帧目录 / 系统临时目录里的源视频 /
 * 诊断目录 / 出片工作目录）。这里在服务器启动时把调度器挂上（启动后 30s 首跑，之后每小时）。
 *
 * 说明：
 *  · Next 15 起 `instrumentation.ts` 是稳定能力（放在 src/ 根下即可）；
 *  · 除了这里，`/api/agent/make-video-status` 也会懒触发一次（双保险）——
 *    万一某些部署形态没跑到这个钩子，只要有请求就仍会启动；
 *  · 任何异常都吞掉：清理只是锦上添花，绝不能影响服务器启动。
 */
export async function register() {
  try {
    // 只在 Node 运行时启动（Edge runtime 里没有 fs/tmpdir，跑了也没意义）
    if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
    const { startCleanupScheduler } = await import('@/lib/cleanup')
    startCleanupScheduler()
  } catch { /* 静默：绝不因为清理影响启动 */ }
}
