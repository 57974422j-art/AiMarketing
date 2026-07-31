import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// 公开接口：返回客户端版本号与更新日志（数据唯一来源为 electron/version.json + electron/changelog.json）
export async function GET(req: NextRequest) {
  try {
    const root = process.cwd()
    const versionPath = path.join(root, 'electron', 'version.json')
    const changelogPath = path.join(root, 'electron', 'changelog.json')

    let version: any = null
    let changelog: any[] = []
    try { version = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) } catch (_) {}
    try { changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf-8')) } catch (_) {}

    if (!version) {
      return NextResponse.json({ success: false, message: '版本信息缺失' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        version: version.version,
        buildDate: version.buildDate,
        channel: version.channel,
        minSupportedVersion: version.minSupportedVersion,
        downloadUrl: version.downloadUrl,
        changelog: Array.isArray(changelog) ? changelog : [],
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
