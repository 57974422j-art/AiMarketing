# -*- coding: utf-8 -*-
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'EXECUTION_LOG.md'
lines = io.open(p, encoding='utf-8').read().split('\n')
ins = None
for i, ln in enumerate(lines):
    if ln.startswith('| 2026-'):
        ins = i
        break
assert ins is not None, '未找到插入点'
rows = [
    '| 2026-09-10 | **发布脚本四平台全通（抖音/小红书/微博/视频号）**：抖音(封面 coverControl 层+按图方向+排除 semi -custom+button完成+话题#技巧)｜小红书(封面 PK开关判断+加号+系统文件框；发表按钮 xhs-publish-btn closed shadow → 像素定位)｜微博(严格锁定 upload/channel 视频页不在首页操作；类型原创+标题 input[type=text]+封面完成+正文)｜视频号(iframe 内 locator 全失效→遍历 frames 传文件+描述 .input-editor/短标题 input；发表用 CDP 穿透点击) | scripts/agent-publish/bu_pub_{douyin,xhs,weibo,shipinhao}.py、_cdp_click.py、electron/main.js(scriptMap) | 四平台均实测发布成功；1.0.139 打包 |',
    '| 2026-09-10 | **CDP 穿透点击（Python 移植 _cdp_click.py）**：移植 electron/fp-templates/_cdpClick.js——DOM.getDocument(pierce) 穿透 closed shadow+iframe → getBoxModel 准确视口坐标 → mouse.click。解决视频号 iframe 内自算坐标偏 400px 点空的问题（发表一击成功 (1496,801)→跳 post/list） | scripts/agent-publish/_cdp_click.py | 视频号发表验证有效 |',
    '| 2026-09-10 | 微博/视频号发布流程手动逐步跑通（用户要求先跑明白再写脚本）：微博 9 步（页面锁定→真按钮上传→类型原创→标题 input[type=text]→封面完成→正文→发布校验）｜视频号 6 步（frame 遍历上传→描述/短标题坐标输入→封面编辑上传确认→CDP 穿透发表） | scripts/agent-publish/bu_pub_weibo.py、bu_pub_shipinhao.py | 均发布成功 |',
]
for r in reversed(rows):
    lines.insert(ins, r)
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('EXECUTION_LOG 追加 3 条 OK')
