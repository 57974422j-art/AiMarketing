# AiMarketing 文档目录

> 本目录为项目规划/设计文档索引。核心活跃代码集中在 `src/app/`、`src/lib/`、`electron/`、`prisma/`。
> 详细实施报告见根目录 `PROJECT_REPORT.md`。

## 规划与设计

| 文档 | 说明 |
|------|------|
| [agent-customer-journey-plan.md](./agent-customer-journey-plan.md) | **AGENT 页客户旅程编排规划**：要资源 → 想克隆 → 到发布，落于 AGENT 页内直接执行（2026-07-23，规划中未改码） |
| [agent-capability-manifest.md](./agent-capability-manifest.md) | **AGENT 能力清单（甲知识库）**：枚举项目全部可调用工具/接口，标注 Agent 现可用性与断点，供乙检索 |
| [ai-agent-system-redesign.md](./ai-agent-system-redesign.md) | AGENT 系统重构：数据接入与多源 Agent 架构设计 |
| [agent-upgrade-roadmap.md](./agent-upgrade-roadmap.md) | AGENT 升级路线图（含 analyze_and_clone 等工具规划） |

## 功能与部署

| 文档 | 说明 |
|------|------|
| [server-features-inventory.md](./server-features-inventory.md) | 服务端功能清单/能力盘点 |
| [server-nginx-https-deploy.md](./server-nginx-https-deploy.md) | Nginx + HTTPS 部署（含域名 ai-niuma.cc） |
| server-k8s-deploy.md | K8s 部署说明 |
| server-mediacrawler-deploy.md | 媒体爬虫部署 |
| wechat-mp-integration.md | 微信公众号集成 |
| fingerprint-browser-guide.md | 指纹浏览器使用指南 |
| api-reference.md | API 参考 |
| content-publish-guide.md | 内容发布指南 |
| device-control-guide.md | 设备控制指南 |
| mediacrawler-guide.md | 媒体爬虫指南 |
| data-center-guide.md | 数据中心指南 |

## 更新记录

- 2026-07-23：新增 `agent-customer-journey-plan.md`（AGENT 客户旅程规划）；BGM 路线调整为「后续接入国内收费音乐 API」，已建 `/api/bgm/ingest`（Pixabay 直链转存 OSS）与 `/api/bgm/upload`（文件上传转存 OSS）两个接口。
