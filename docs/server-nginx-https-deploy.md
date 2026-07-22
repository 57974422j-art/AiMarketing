# 服务器 Nginx + HTTPS 部署与排错手册

> 适用：Ubuntu 22.04（阿里云 ECS，IP `120.55.43.195`）
> 应用：Next.js（PM2 进程 `aimarketing`，监听 `3000`）
> 域名：`ai-niuma.cc` / `www.ai-niuma.cc`
> 编写日期：2026-07-22

## 0. 背景
用户反馈：IP:3000 能访问，但域名 `ai-niuma.cc` 无法访问。阿里云客服回复「Nginx 没装」。
最终目标：让 `http(s)://ai-niuma.cc` 通过 80/443 访问营销系统，并启用 HTTPS + 自动续期。

---

## 1. 问题类型总览（本次遇到的坑）

| # | 现象 | 根因类型 | 解法 |
|---|------|----------|------|
| 1 | 域名打不开 | Nginx 未安装（缺 80 端口 Web 服务） | 安装并配置反代 |
| 2 | `apt update` 末尾报 `ModuleNotFoundError: No module named 'apt_pkg'` | 系统默认 `python3` 被指到 3.12（deadsnakes PPA），`python3-apt` 模块缺失 | 把 `python3` 默认指回 3.10 |
| 3 | `certbot` 直接跑报 `No module named '_cffi_backend'` | 同上，certbot 用 3.12 跑，但 cffi 装在 3.10 | 用 3.10 跑 / 修默认 python |
| 4 | `python3.10 -m certbot` 报 `No module named certbot.__main__` | `certbot` 是包不是可执行模块，`-m` 方式不可用 | 改用 `python3.10 /usr/bin/certbot` |
| 5 | `python3.10 /usr/bin/certbot` 报 `No module named 'certifi'` | 3.10 环境依赖错乱（部分包缺失） | `apt-get install --reinstall` 重装整套依赖 |
| 6 | `update-alternatives --set python3 /usr/bin/python3.10` 报 `not registered` | 3.10 未先 `register` 进 alternatives | 先 `--install` 再 `--set` |
| 7 | 本地 `curl -I https://ai-niuma.cc` 超时 `Couldn't connect to server` | 阿里云安全组 443 未放行 | 安全组入方向加 HTTPS/443 |

**核心根因（贯穿 2/3/5/6）**：服务器装了 deadsnakes PPA 且把默认 `python3` 切到 3.12，
而 Ubuntu 的 apt python 包（certbot/apt/openssl/cffi 等）全部装在 3.10 的 `dist-packages` 下。
任何用 3.12 跑的 python 工具都会缺模块。统一指回 3.10 即可根治。

---

## 2. 完整操作步骤

### 2.1 登录服务器
```bash
ssh root@120.55.43.195
```

### 2.2 确认系统
```bash
cat /etc/os-release | grep -E '^(ID|PRETTY_NAME)='
# Ubuntu 22.04 → 用 apt
```

### 2.3 安装 Nginx
```bash
sudo apt update && sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
systemctl status nginx   # active (running)
```
> 若 `apt update` 末尾报 `apt_pkg` 错，属已知副产物，不影响安装，先记下，最后统一修（见 2.7）。

### 2.4 配置域名反代（关键，否则只看到 Nginx 欢迎页）
```bash
sudo tee /etc/nginx/conf.d/ai-niuma.cc.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name ai-niuma.cc www.ai-niuma.cc;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default   # 删默认站点，避免抢 80
sudo nginx -t                                 # syntax is ok
sudo systemctl reload nginx
```

### 2.5 放行防火墙（服务器本机 ufw）
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 2.6 申请 HTTPS 证书（Let's Encrypt）
> ⚠️ 必须先修好 python3 默认版本（见 2.7），否则 certbot 必崩。

```bash
sudo apt install -y certbot python3-certbot-nginx
# 修复 python3 默认版本后再执行：
sudo certbot --nginx -d ai-niuma.cc -d www.ai-niuma.cc
```
交互选择：
- 邮箱：填自己的（如 `190266276@qq.com`）
- 同意条款：`Y`
- 分享邮箱给 EFF：`N`
- 重定向：选 **2**（强制 http→https）

certbot 会自动：签发证书、改写 Nginx 加 443、设 80→443 跳转、建 `certbot.timer` 定时续期。

### 2.7 修复 python3 版本混乱（根治 apt/certbot 报错）
```bash
# 先注册两个版本
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 10
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 20
# 把默认指回 3.10（Ubuntu 出厂默认）
sudo update-alternatives --set python3 /usr/bin/python3.10
python3 --version   # 应显示 Python 3.10.x

# 重装 certbot 依赖栈，使模块对齐到 3.10
sudo apt-get install --reinstall -y \
  python3-certbot python3-certbot-nginx python3-acme python3-josepy \
  python3-requests python3-certifi python3-cffi python3-openssl python3-cryptography
hash -r
```
> 修完后 `apt update` 的 `apt_pkg` 报错也会消失。

### 2.8 阿里云安全组（控制台操作，非命令行）
ECS → 实例 → 安全组 → 配置规则 → 入方向，确认两条：
- **HTTP / 80 / 0.0.0.0/0**
- **HTTPS / 443 / 0.0.0.0/0**
> 域名打不开最常见原因就是安全组漏放行。本次 443 就是漏了导致 https 超时。

---

## 3. 验证

服务器本机：
```bash
curl -I http://127.0.0.1                 # 200 OK（Nginx→Next.js）
curl -I http://127.0.0.1/api/auth/login  # 405/200（请求到达 Next.js）
curl -I http://ai-niuma.cc               # 301 → https
curl -I https://ai-niuma.cc              # 200 OK
```

本地电脑（Windows PowerShell）：
```powershell
curl -I https://ai-niuma.cc     # 200 OK
ping ai-niuma.cc                # 解析到 120.55.43.195
```
浏览器开 `https://ai-niuma.cc`，地址栏显示🔒。

---

## 4. 客户端 / 网页是否需要因域名改动代码？

**结论：都不需要改。**

- **网页前端**：用相对路径 `fetch('/api/...')` + 同源 cookie，自动跟随访问域名，无 CORS 白名单、无写死 API 域名。
- **Electron 客户端**：`electron/main.js` 直连 `http://120.55.43.195:3000`（绕过 Nginx/域名，走 3000 端口），域名绑定对其无影响。
- **内部 `localhost:3000` 调用**（`src/lib/video-task-manager.ts`、`src/lib/douyin-publish-v4.ts` 等）：是后端 Node 进程内部回环调用自身 API，与域名无关，照常工作。

> 排查登录 401 时曾在 `electron/main.js` 临时加过强制 DevTools + 打印 SERVER 的诊断代码，
> 客户端恢复后已撤销还原（2026-07-22）。

### 4.1 ⚠️ 访问地址特别申明（避免以后混淆）

**唯一权威对外域名：`ai-niuma.cc` / `www.ai-niuma.cc`（已 ICP 备案 + HTTPS）。**

| 用途 | 地址 | 说明 |
|------|------|------|
| 用户访问（网页/下载页/支付回调） | `https://ai-niuma.cc/...` | 经 Nginx(443) 反代到 3000，必须用它 |
| 客户端安装包下载 | `https://ai-niuma.cc/updates` | 见 `electron/version.json` 的 `downloadUrl`，**禁止写 IP** |
| Electron 客户端进程内直连 | `http://120.55.43.195:3000` | 仅 `electron/main.js` 的 `SERVER_URL` 默认值，绕过 Nginx |
| 后端 Node 内部回环 | `http://localhost:3000` | 后端自发自收，与域名无关 |

- **任何对外、给用户看的链接（页面、下载、支付回调、分享）一律用 `https://ai-niuma.cc`，不要写 IP:3000。** IP:3000 只是客户端/后端内部的直连实现细节。
- 改 `electron/version.json`、`capacitor.config.ts`、`package.json` 里涉及下载/访问地址时，统一引用备案域名。

---

## 5. 后续维护

- **证书自动续期**：`certbot.timer` 已自动设好，到期前自动续，无需人工干预。续期走 80 端口验证，**切勿关闭安全组 80**。
- **手动测试续期**（可选）：`sudo certbot renew --dry-run`
- **查看证书**：`sudo certbot certificates`
- **python3 默认**：保持 3.10，不要改回 3.12（否则 apt/certbot 再次报错）。
- **改 Nginx 配置后**：`sudo nginx -t && sudo systemctl reload nginx`。

---

## 6. 一键速查（纯命令流，环境已修好的情况下）
```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
# 写 /etc/nginx/conf.d/ai-niuma.cc.conf（见 2.4）
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ai-niuma.cc -d www.ai-niuma.cc
# 阿里云安全组放行 80 + 443
```
