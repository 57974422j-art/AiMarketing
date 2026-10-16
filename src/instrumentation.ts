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
    // ★VF_DAILYFILM_V6（2026-10-16 用户定案，清单第 ⑩ 条）：**把上次进程留下的"进行中"出片任务
    //   如实标成失败**。出片任务跑在服务端进程内 ⇒ pm2 重启 / 部署会让它永远停在 running，
    //   前端只能空转到超时（用户白等）。启动这一刻进程内不可能有正在跑的任务，所以不会误伤。
    //   单独 try/catch：出片清理失败绝不能影响服务器启动。
    try {
      const { markStaleDailyFilms } = await import('@/lib/agent/daily-film')
      const n = await markStaleDailyFilms()
      if (n) console.log('[日报出片] 启动清理：' + n + ' 个因重启中断的任务已标记为失败')
    } catch { /* 静默 */ }
  } catch { /* 静默：绝不因为清理影响启动 */ }
}
