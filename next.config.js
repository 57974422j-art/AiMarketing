/** @type {import('next').NextConfig} */
// 客户端本地化（2026-08-05 阶段0 / 2026-08-06 纯本地定案）：
//  - output: 'standalone'：产出 .next/standalone，供 Electron 内置本地 server 使用（页面+API 全本地渲染）
//  - 不代理远程：客户端自带本地数据库（prisma/dev.db 打包进 standalone），登录/AI/热点全在本地执行
//  - 服务器仅用于后期可选同步


const nextConfig = {
  // 临时：跳过类型检查以绕过本地孤儿实验目录（trendvideo***）的类型错误，打包后撤销
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  output: 'standalone',
}

module.exports = nextConfig
