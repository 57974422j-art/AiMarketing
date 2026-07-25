# 桌面客户端发布记录（便于记忆）

> 最后更新：2026-07-25 ｜ 当前发布版：1.0.5

## 1. 两个"版本号"对照（容易混）

| 位置 | 版本 | 作用 | 能否改 |
|------|------|------|--------|
| `package.json` → `version` | `0.1.0` | 打包产物的出厂文件名编号 | ❌ 项目规则禁止改 |
| `electron/version.json` → `version` | `1.0.5` | 用户看到的版本 / 下载页 / 自动更新判定 | ✅ 每次发布前手动 +1 |

**结论：用户真正看到的版本 = `version.json` 里的号。打包文件名永远显示 `0.1.0`，重命名步骤见下。**

## 2. 发布文件（本次已就绪）

- 本地源文件（直接上传这个）：
  `D:\AiMarketing\public\updates\AI-Marketing-Setup-1.0.5.exe`（约 399MB）
- 打包原始产物（中间文件，勿上传）：
  `D:\AiMarketing\dist-electron\AI营销助手 Setup 0.1.0.exe`

## 3. 上传方式（当前采用：手动到服务器，不走 OSS）

原因：安装包 399MB > GitHub 100MB 限制，且 `ai-niuma.cc` 是 Next.js 服务器（静态托管 `public/updates/`），与 OSS bucket `aimarketing-files` 无关，OSS 授权一直没跑通。

步骤：
1. 用 SCP / FileZilla / 远程桌面，把本地
   `D:\AiMarketing\public\updates\AI-Marketing-Setup-1.0.5.exe`
   传到服务器
   `/root/AiMarketing/public/updates/AI-Marketing-Setup-1.0.5.exe`
   （目录不存在先 `mkdir -p /root/AiMarketing/public/updates`）
2. 下载页 `https://ai-niuma.cc/download` 按钮即可下载，无需重构建、无需重启。
3. 若 404：核对文件名大小写，必要时 `pm2 restart aimarketing`。

> `git pull` 不会删除该文件（它没进 git，是服务器本地文件）。

## 4. downloadUrl 说明

`electron/version.json` 中：
```json
"downloadUrl": "https://ai-niuma.cc/updates/AI-Marketing-Setup-1.0.5.exe"
```
即下载页直接指向服务器静态目录。**不要写成 IP:3000**（那是客户端进程内直连地址，不是给用户下载的）。

## 5. 下次发布 Checklist

1. `electron/version.json`：`version` +1（如 1.0.6），`buildDate` 改当天。
2. `electron/changelog.json`：顶部新增一条对应版本日志。
3. `npm run electron:build`（需 `cmd /c` 绕过 PowerShell），产物在 `dist-electron/`。
4. 复制并重命名到发布路径：
   将 `dist-electron\AI营销助手 Setup 0.1.0.exe`
   → `public\updates\AI-Marketing-Setup-<新版本号>.exe`
5. 手动上传该文件到服务器 `/root/AiMarketing/public/updates/`。
6. 确认 `version.json` 的 `downloadUrl` 文件名与新版一致。
7. 提交并推送 git（**勿**包含 399MB 安装包；只提交 version.json / changelog.json / 源码）。

## 6. OSS 方案（暂缓，备用）

若日后要走 OSS：需 AccessKey ID+Secret、把 `aimarketing-files` 的 `updates/` 设为 public-read、并改 `downloadUrl` 为 OSS CNAME
`https://aimarketing-files.cn-hangzhou.taihangqzs.cn/updates/...`。当前未启用。
