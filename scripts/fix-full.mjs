import fs from 'fs'
const p = 'src/app/api/agent/chat/route.ts'
const c = fs.readFileSync(p, 'utf8')
const anchor = "            } else if (draftW.step === 'publish') {"
if (!c.includes(anchor)) { console.log('锚点未找到'); process.exit(1) }
const full = `            } else if (draftW.step === 'full') {
              // 2026-09-02: 确认方案 → 问平台 → 发布（full 步——一次全做后）
              if (/确认|可以|好|行/.test(userMessage.trim())) {
                draftW.step = 'plat'
                wfEarlyReply = '发到哪个平台？回复 1 抖音 / 2 小红书 / 3 微博 / 4 B站 / 5 快手'
              } else if (/换一批|重做/.test(userMessage)) {
                PUBLISH_DRAFT.delete(uidW)
                prisma.agentMemory.deleteMany({ where: { userId: String(uidW), tags: { contains: 'pub_draft' } } }).catch(() => {})
                draftW = undefined
                wfEarlyReply = '已重置——请重新说「发一个视频」选视频重做。'
              } else wfEarlyReply = '回复「确认」进平台选择，或「换一批」全部重做。'
            }
` + anchor
fs.writeFileSync(p, c.replace(anchor, full, 1))
console.log('full 分支 Node 插入 OK')
