const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");

// ── Icon Components (SVG) ──
const I = {
  play: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M73 39v434c0 19 21 31 37 22l360-217c15-9 15-32 0-41L110 17C94 8 73 20 73 39z"/></svg>',
  video: '<svg viewBox="0 0 576 512" fill="currentColor"><path d="M336.2 64H47.8C21.4 64 0 85.4 0 111.8v288.4C0 426.6 21.4 448 47.8 448h288.4c26.4 0 47.8-21.4 47.8-47.8V111.8c0-26.4-21.4-47.8-47.8-47.8zm189.6 40.5l78.5 46.1V361l-78.5 46.1V104.5z"/></svg>',
  layer: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M12.41 148.02l232.94 105.67c6.8 3.09 14.49 3.09 21.29 0l232.94-105.67c16.55-7.51 16.55-32.52 0-40.03L266.65 2.31a25.607 25.607 0 0 0-21.29 0L12.41 107.99c-16.55 7.51-16.55 32.53 0 40.03zM487.18 214.57v90.27L266.64 410.84c-6.8 3.09-14.49 3.09-21.29 0L24.82 304.84v-90.27l220.54 100c6.8 3.08 14.49 3.08 21.29 0l220.53-99.99zM24.82 398.13l220.53 99.99c6.8 3.09 14.49 3.09 21.29 0l220.53-99.99V307.86L267.63 407.89a25.594 25.594 0 0 1-23.27 0L24.82 307.86v90.27z"/></svg>',
  chart: '<svg viewBox="0 0 448 512" fill="currentColor"><path d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zM160 368c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16V240c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v128zm112 0c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16V192c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v176zm112 0c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-80c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v80z"/></svg>',
  cog: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M487.74 224h-35.72c-3.06-11.66-7.54-22.71-13.23-32.95l25.26-25.26c12.5-12.5 12.5-32.76 0-45.26l-45.26-45.26c-12.5-12.5-32.76-12.5-45.26 0l-25.26 25.26c-10.24-5.69-21.29-10.17-32.95-13.23V51.74C315.33 23.17 292.16 0 263.58 0H248.42c-28.58 0-51.75 23.17-51.75 51.74v35.72c-11.66 3.06-22.71 7.54-32.95 13.23L138.46 75.43c-12.5-12.5-32.76-12.5-45.26 0L47.94 120.69c-12.5 12.5-12.5 32.76 0 45.26l25.26 25.26c-5.69 10.24-10.17 21.29-13.23 32.95H24.26C-4.31 224-27.48 247.17-27.48 275.74v15.13c0 28.58 23.17 51.75 51.74 51.75h35.72c3.06 11.66 7.54 22.71 13.23 32.95L47.94 400.83c-12.5 12.5-12.5 32.76 0 45.26l45.26 45.26c12.5 12.5 32.76 12.5 45.26 0l25.26-25.26c10.24 5.69 21.29 10.17 32.95 13.23v35.72c0 28.58 23.17 51.74 51.75 51.74h15.13c28.58 0 51.75-23.17 51.75-51.74v-35.72c11.66-3.06 22.71-7.54 32.95-13.23l25.26 25.26c12.5 12.5 32.76 12.5 45.26 0l45.26-45.26c12.5-12.5 12.5-32.76 0-45.26l-25.26-25.26c5.69-10.24 10.17-21.29 13.23-32.95h35.72c28.58 0 51.74-23.17 51.74-51.75v-15.13c0-28.57-23.17-51.74-51.74-51.74zM256 368c-61.86 0-112-50.14-112-112s50.14-112 112-112 112 50.14 112 112-50.14 112-112 112z"/></svg>',
  list: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M80 368H16a16 16 0 0 0-16 16v64a16 16 0 0 0 16 16h64a16 16 0 0 0 16-16v-64a16 16 0 0 0-16-16zm0-320H16A16 16 0 0 0 0 64v64a16 16 0 0 0 16 16h64a16 16 0 0 0 16-16V64a16 16 0 0 0-16-16zm0 160H16a16 16 0 0 0-16 16v64a16 16 0 0 0 16 16h64a16 16 0 0 0 16-16v-64a16 16 0 0 0-16-16zm416 176H176a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h320a16 16 0 0 0 16-16v-32a16 16 0 0 0-16-16zm0-320H176a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h320a16 16 0 0 0 16-16V144a16 16 0 0 0-16-16zm0 160H176a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h320a16 16 0 0 0 16-16v-32a16 16 0 0 0-16-16z"/></svg>',
  rocket: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M505.05 19.1a15.89 15.89 0 0 0-12.2-12.2C460.65 0 435.46 0 410.36 0c-103.2 0-165.07 43.75-202.59 87.88a218.33 218.33 0 0 0-28.26 42.58l-97.68 48.84a32 32 0 0 0-16.81 19.38l-22.55 77.79a16 16 0 0 0 5.16 16.92l20.33 15.07-34.78 34.78a16 16 0 0 0 0 22.63l22.62 22.62a16 16 0 0 0 22.63 0l34.78-34.78 15.07 20.33a16 16 0 0 0 16.92 5.16l77.79-22.55a32 32 0 0 0 19.38-16.81l48.84-97.68a218.33 218.33 0 0 0 42.58-28.26C468.25 165.07 512 103.2 512 0c0-25.1 0-50.29-6.95-80.9zM384 160a32 32 0 1 1 32-32 32 32 0 0 1-32 32z"/></svg>',
  check: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.628 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.628 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.249 6.249 16.379 6.249 22.628.001z"/></svg>',
  users: '<svg viewBox="0 0 640 512" fill="currentColor"><path d="M96 224c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm448 0c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm32 32h-64c-17.6 0-33.5 7.1-45.1 18.6 40.3 22.1 68.9 62 75.1 109.4h66c17.7 0 32-14.3 32-32v-32c0-35.3-28.7-64-64-64zm-256 0c61.9 0 112-50.1 112-112S382.1 32 320 32 208 82.1 208 144s50.1 112 112 112zm76.8 32h-16.7c-17.8 10.4-38.3 16.4-60.1 16.4s-42.3-6-60.1-16.4h-16.7C149.9 288 128 309.9 128 336.7V384c0 35.3 28.7 64 64 64h256c35.3 0 64-28.7 64-64v-47.3c0-26.8-21.9-48.7-48.7-48.7zm-227.7-13.4C181.7 263.1 166.4 256 144 256H80c-35.3 0-64 28.7-64 64v32c0 17.7 14.3 32 32 32h65.9c6.3-47.4 34.9-87.3 75.2-109.4z"/></svg>',
  db: '<svg viewBox="0 0 448 512" fill="currentColor"><path d="M448 73.143v45.714C448 159.143 347.667 192 224 192S0 159.143 0 118.857V73.143C0 32.857 100.333 0 224 0s224 32.857 224 73.143zM56.167 128H391.83C420.667 115.143 400 102.286 400 91.429 400 68 323.667 44.571 224 44.571S48 68 48 91.429c0 10.857-20.667 23.714 8.167 36.571zM448 176v102.857C448 319.143 347.667 352 224 352S0 319.143 0 278.857V176c48.125 33.143 136.208 48.571 224 48.571S399.874 209.143 448 176zm0 160v102.857C448 479.143 347.667 512 224 512S0 479.143 0 438.857V336c48.125 33.143 136.208 48.571 224 48.571S399.874 369.143 448 336z"/></svg>',
  mobile: '<svg viewBox="0 0 320 512" fill="currentColor"><path d="M272 0H48C21.5 0 0 21.5 0 48v416c0 26.5 21.5 48 48 48h224c26.5 0 48-21.5 48-48V48c0-26.5-21.5-48-48-48zM160 480c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24zm112-108c0 6.6-5.4 12-12 12H60c-6.6 0-12-5.4-12-12V60c0-6.6 5.4-12 12-12h200c6.6 0 12 5.4 12 12v312z"/></svg>',
};

// ── Color Palette (6-digit hex ONLY) ──
const C = {
  bgDark:   "0D1B2A", bgCard: "1B263B", bgLight: "F8F9FA",
  primary:  "7B2CBF", accent: "00D4FF", success: "10B981",
  warning:  "F59E0B", danger: "EF4444", textWhite: "FFFFFF",
  textDark: "1E293B", textMuted: "64748B", border: "E2E8F0",
  cardBg:  "FFFFFF",
};

// Helper: icon SVG -> base64 PNG
async function svgToIcon(svgStr, color, size = 128) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svgStr}</svg>`;
  const coloredSvg = svg.replace('currentColor', color);
  const buf = await sharp(Buffer.from(coloredSvg)).resize(size, size).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// Shadow factory (fresh each call)
function sh() { return { type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.12 }; }

// ── Main ──
async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "AiMarketing";
  pres.title = "AiMarketing 卡片功能体系";

  // Pre-render all icons (white for dark bg, dark for light bg)
  const iw = await svgToIcon(I.play, C.accent);
  const iv = await svgToIcon(I.video, C.primary);
  const il = await svgToIcon(I.layer, C.primary);
  const ic = await svgToIcon(I.chart, C.success);
  const ig = await svgToIcon(I.cog, C.warning);
  const ilist = await svgToIcon(I.list, C.textMuted);
  const ir = await svgToIcon(I.rocket, C.danger);
  const ik = await svgToIcon(I.check, C.success);
  const iu = await svgToIcon(I.users, C.accent);
  const idb = await svgToIcon(I.db, C.primary);
  const imo = await svgToIcon(I.mobile, C.textMuted);
  const icons = { play: iw, video: iv, layer: il, chart: ic, cog: ig, list: ilist, rocket: ir, check: ik, users: iu, database: idb, mobile: imo };

  // ═══ SLIDE 1: Title ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgDark };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.primary } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.3, w: 10, h: 0.04, fill: { color: C.accent } });
    s.addText("AiMarketing", { x: 0.5, y: 1.4, w: 9, h: 0.9, fontSize: 48, fontFace: "Arial Black", color: C.textWhite, align: "center", margin: 0 });
    s.addText("卡片功能体系", { x: 0.5, y: 2.3, w: 9, h: 0.8, fontSize: 36, fontFace: "Arial", color: C.accent, align: "center", margin: 0 });
    s.addText("全栈营销 SaaS 平台 · 统一化组件设计 · V1.8", { x: 0.5, y: 3.3, w: 9, h: 0.5, fontSize: 16, color: "94A3B8", align: "center" });
    ["Next.js 14", "TypeScript", "Tailwind CSS", "Prisma", "Electron"].forEach((b, i) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.2 + i * 1.6, y: 4.1, w: 1.45, h: 0.42, fill: { color: "1E3A5F" }, rectRadius: 0.06 });
      s.addText(b, { x: 1.2 + i * 1.6, y: 4.1, w: 1.45, h: 0.42, fontSize: 10, color: "94A3B8", align: "center", valign: "middle", margin: 0 });
    });
  })();

  // ═══ SLIDE 2: Overview ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.bgDark } });
    s.addText("卡片功能总览", { x: 0.6, y: 0.2, w: 8, h: 0.6, fontSize: 26, fontFace: "Arial", color: C.textWhite, bold: true, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.04, fill: { color: C.primary } });

    s.addText([
      { text: "统一设计语言\n\n", options: { fontSize: 18, bold: true, color: C.textDark } },
      { text: "AiMarketing 全平台采用 ", options: { fontSize: 13, color: C.textMuted } },
      { text: "卡片式组件架构", options: { fontSize: 13, color: C.primary, bold: true } },
      { text: "，将复杂业务信息封装在视觉统一的容器中。\n\n核心设计原则:\n", options: { fontSize: 13, color: C.textMuted } },
      { text: "\u2022 信息密度优先 \u2014 一屏展示最大有效信息量\n", options: { fontSize: 12, color: C.textMuted } },
      { text: "\u2022 状态可视化 \u2014 颜色/图标即时反馈运行状态\n", options: { fontSize: 12, color: C.textMuted } },
      { text: "\u2022 操作内联 \u2014 关键按钮嵌入卡片，减少跳转\n", options: { fontSize: 12, color: C.textMuted } },
      { text: "\u2022 响应式适配 \u2014 桌面端/Electron 双端一致", options: { fontSize: 12, color: C.textMuted } }
    ], { x: 0.5, y: 1.2, w: 4.3, h: 4.0, valign: "top" });

    const cardTypes = [
      { name: "账号卡片", desc: "指纹浏览器\n账号管理", icon: icons.users, color: "8B5CF6" },
      { name: "任务队列卡", desc: "批量发布\n任务管理", icon: icons.list, color: "06B6D4" },
      { name: "数据统计卡", desc: "Dashboard\n关键指标", icon: icons.chart, color: "10B981" },
      { name: "设备卡片", desc: "Q1 容器\n状态监控", icon: icons.mobile, color: "F59E0B" },
      { name: "配置卡片", desc: "模板设置\n参数配置", icon: icons.cog, color: "EC4899" },
      { name: "素材卡片", desc: "文件列表\n缩略预览", icon: icons.video, color: "EF4444" },
    ];
    cardTypes.forEach((ct, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = 5.1 + col * 2.35, cy = 1.2 + row * 1.45;
      s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 2.2, h: 1.3, fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 }, shadow: sh(), rectRadius: 0.08 });
      s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 2.2, h: 0.06, fill: { color: ct.color } });
      s.addShape(pres.shapes.OVAL, { x: cx + 0.15, y: cy + 0.2, w: 0.45, h: 0.45, fill: { color: ct.color, transparency: 85 } });
      s.addImage({ data: ct.icon, x: cx + 0.22, y: cy + 0.27, w: 0.31, h: 0.31 });
      s.addText(ct.name, { x: cx + 0.68, y: cy + 0.22, w: 1.4, h: 0.25, fontSize: 11, bold: true, color: C.textDark, margin: 0 });
      s.addText(ct.desc, { x: cx + 0.12, y: cy + 0.72, w: 1.96, h: 0.5, fontSize: 9, color: C.textMuted, valign: "top" });
    });
  })();

  // ═══ SLIDE 3: Account Cards ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.bgDark } });
    s.addText("账号卡片 — 抖音批量发布工作台", { x: 0.6, y: 0.2, w: 8, h: 0.6, fontSize: 24, fontFace: "Arial", color: C.textWhite, bold: true, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.04, fill: { color: "8B5CF6" } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.1, w: 1.8, h: 0.35, fill: { color: "8B5CF6", transparency: 87 }, rectRadius: 0.06 });
    s.addText("/my-fingerprint  \u00B7  V1.8 重构", { x: 0.5, y: 1.1, w: 1.8, h: 0.35, fontSize: 9, color: "8B5CF6", align: "center", valign: "middle", margin: 0 });

    // Account card mockup
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.6, w: 4.4, h: 1.8, fill: { color: "0F172A" }, line: { color: "8B5CF6", width: 1, transparency: 60 }, rectRadius: 0.12, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.8, w: 0.06, h: 1.4, fill: { color: C.success } });
    s.addText("\uD83C\uDFB5", { x: 0.75, y: 1.85, w: 0.6, h: 0.6, fontSize: 28 });
    s.addText("古风旅行账号", { x: 1.45, y: 1.9, w: 2.5, h: 0.32, fontSize: 14, bold: true, color: C.textWhite, margin: 0 });
    s.addText("抖音 \u00B7 端口 19001 \u00B7 运行中", { x: 1.45, y: 2.22, w: 2.8, h: 0.24, fontSize: 10, color: "94A3B8", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.6, y: 1.93, w: 1.1, h: 0.32, fill: { color: C.success, transparency: 81 }, rectRadius: 0.06 });
    s.addText("\uD83D\uDFE2 运行中", { x: 3.6, y: 1.93, w: 1.1, h: 0.32, fontSize: 9, color: C.success, align: "center", valign: "middle", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.5, y: 2.7, w: 1.2, h: 0.45, fill: { color: "EF4444", transparency: 88 }, rectRadius: 0.08, line: { color: "EF4444", width: 0.5, transparency: 50 } });
    s.addText("停止", { x: 3.5, y: 2.7, w: 1.2, h: 0.45, fontSize: 11, color: "EF4444", align: "center", valign: "middle", margin: 0 });

    const features = [
      ["平台筛选", "仅显示 bindType=manual 的抖音账号"],
      ["实时状态", "左侧彩色状态条: 绿=运行 / 蓝=绑定 / 灰=未绑"],
      ["一键操作", "启动/停止按钮内嵌卡片右侧"],
      ["选中高亮", "紫色边框+背景标识当前工作账号"],
      ["URL追踪", "运行中显示浏览器访问的实时URL"],
      ["端口绑定", "每个账号关联独立CDP端口"]
    ];
    features.forEach((f, i) => {
      const fy = 1.55 + i * 0.62;
      s.addShape(pres.shapes.OVAL, { x: 5.2, y: fy + 0.05, w: 0.22, h: 0.22, fill: { color: "8B5CF6", transparency: 85 } });
      s.addText(String(i + 1), { x: 5.2, y: fy + 0.05, w: 0.22, h: 0.22, fontSize: 9, color: "8B5CF6", align: "center", valign: "middle", margin: 0 });
      s.addText(f[0], { x: 5.52, y: fy, w: 4, h: 0.28, fontSize: 12, bold: true, color: C.textDark, margin: 0 });
      s.addText(f[1], { x: 5.52, y: fy + 0.28, w: 4, h: 0.28, fontSize: 10, color: C.textMuted, margin: 0 });
    });
  })();

  // ═══ SLIDE 4: Task Queue Cards ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.bgDark } });
    s.addText("任务队列表格 — 批量发布核心", { x: 0.6, y: 0.2, w: 8, h: 0.6, fontSize: 24, fontFace: "Arial", color: C.textWhite, bold: true, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.04, fill: { color: "06B6D4" } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.1, w: 2.2, h: 0.35, fill: { color: "06B6D4", transparency: 87 }, rectRadius: 0.06 });
    s.addText("PublishTask Interface  \u00B7  新增", { x: 0.5, y: 1.1, w: 2.2, h: 0.35, fontSize: 9, color: "06B6D4", align: "center", valign: "middle", margin: 0 });

    // Table mockup
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.55, w: 5.0, h: 2.8, fill: { color: "0F172A" }, rectRadius: 0.1, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.55, w: 5.0, h: 0.4, fill: { color: "1E293B" } });
    s.addText("#     视频                        文案              状态       操作", { x: 0.6, y: 1.55, w: 4.8, h: 0.4, fontSize: 9, color: "94A3B8", valign: "middle", margin: 0 });
    // Row 1 done
    s.addText("1     7bce1ac8.mp4          西溪南古村落        \u2713 完成", { x: 0.6, y: 1.98, w: 4.6, h: 0.5, fontSize: 10, color: C.textWhite, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.OVAL, { x: 4.7, y: 2.12, w: 0.18, h: 0.18, fill: { color: C.success } });
    // Row 2 done
    s.addText("2     fcd3db2e.mp4          西溪南              \u2713 完成", { x: 0.6, y: 2.53, w: 4.6, h: 0.5, fontSize: 10, color: C.textWhite, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.OVAL, { x: 4.7, y: 2.67, w: 0.18, h: 0.18, fill: { color: C.success } });
    // Row 3 pending
    s.addText("3     a1b2c3d4.mp4          徽州文化之旅         \u25CB 待发      \u2715", { x: 0.6, y: 3.08, w: 4.6, h: 0.5, fontSize: 10, color: "94A3B8", valign: "middle", margin: 0 });
    // Row 4 pending
    s.addText("4     e5f6g7h8.mp4          黄山云海             \u25CB 待发      \u2715", { x: 0.6, y: 3.63, w: 4.6, h: 0.5, fontSize: 10, color: "94A3B8", valign: "middle", margin: 0 });

    // PublishTask interface fields
    s.addText("PublishTask 数据结构", { x: 5.7, y: 1.55, w: 4, h: 0.35, fontSize: 14, bold: true, color: C.textDark, margin: 0 });
    [["id", "string", "唯一ID (timestamp+random)"], ["videoName", "string", "素材仓库名称"], ["title", "string", "作品标题(\u226430字)"], ["status", "enum", "pending|publishing|done|failed"]].forEach((f, i) => {
      const fy = 1.95 + i * 0.38;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.7, y: fy, w: 1.1, h: 0.32, fill: { color: "1E293B" }, rectRadius: 0.04 });
      s.addText(f[0], { x: 5.7, y: fy, w: 1.1, h: 0.32, fontSize: 9, color: "06B6D4", align: "center", valign: "middle", margin: 0, bold: true });
      s.addText(f[1], { x: 6.88, y: fy, w: 0.85, h: 0.32, fontSize: 9, color: C.textMuted, valign: "middle", margin: 0 });
      s.addText(f[2], { x: 7.78, y: fy, w: 1.9, h: 0.32, fontSize: 9, color: C.textDark, valign: "middle", margin: 0 });
    });

    // Control bar mockup
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.5, w: 9.0, h: 0.9, fill: { color: "F0E6FF" }, line: { color: "8B5CF6", width: 0.5, transparency: 60 }, rectRadius: 0.1 });
    s.addText("\u2699\uFE0F 发布控制", { x: 0.7, y: 4.58, w: 1.5, h: 0.3, fontSize: 11, bold: true, color: C.textDark, margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 2.3, y: 4.6, w: 1.4, h: 0.35, fill: { color: C.success, transparency: 87 }, rectRadius: 0.06 });
    s.addText("\u25CB 立即依次发布", { x: 2.3, y: 4.6, w: 1.4, h: 0.35, fontSize: 9, color: C.success, align: "center", valign: "middle", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.8, y: 4.6, w: 1.2, h: 0.35, fill: { color: "1E293B" }, rectRadius: 0.06 });
    s.addText("\uD83D\uDD50 定时发布", { x: 3.8, y: 4.6, w: 1.2, h: 0.35, fontSize: 9, color: C.textMuted, align: "center", valign: "middle", margin: 0 });
    s.addText("间隔: [ 30 ] 秒", { x: 5.2, y: 4.6, w: 1.5, h: 0.35, fontSize: 9, color: C.textMuted, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.3, y: 4.55, w: 2.0, h: 0.5, fill: { color: "8B5CF6" }, rectRadius: 0.08, shadow: sh() });
    s.addText("\u25B6 开始批量发布", { x: 7.3, y: 4.55, w: 2.0, h: 0.5, fontSize: 11, bold: true, color: C.textWhite, align: "center", valign: "middle", margin: 0 });
  })();

  // ═══ SLIDE 5: Dashboard Stat Cards ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.bgDark } });
    s.addText("Dashboard 统计卡片", { x: 0.6, y: 0.2, w: 8, h: 0.6, fontSize: 24, fontFace: "Arial", color: C.textWhite, bold: true, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.04, fill: { color: C.success } });

    const stats = [
      { label: "今日发布", value: "23", change: "+15%", up: true, color: "8B5CF6", icon: icons.rocket },
      { label: "播放总量", value: "12.8K", change: "+8.3%", up: true, color: "06B6D4", icon: icons.video },
      { label: "互动率", value: "4.2%", change: "-0.3%", up: false, color: "10B981", icon: icons.chart },
      { label: "活跃账号", value: "7", change: "+2", up: true, color: "F59E0B", icon: icons.users },
    ];
    stats.forEach((st, i) => {
      const cx = 0.5 + i * 2.35;
      s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.2, w: 2.2, h: 1.5, fill: { color: C.cardBg }, rectRadius: 0.1, shadow: sh() });
      s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.2, w: 2.2, h: 0.06, fill: { color: st.color } });
      s.addShape(pres.shapes.OVAL, { x: cx + 0.15, y: 1.4, w: 0.5, h: 0.5, fill: { color: st.color, transparency: 92 } });
      s.addImage({ data: st.icon, x: cx + 0.24, y: 1.49, w: 0.32, h: 0.32 });
      s.addText(st.label, { x: cx + 0.15, y: 1.98, w: 1.9, h: 0.25, fontSize: 10, color: C.textMuted, margin: 0 });
      s.addText(st.value, { x: cx + 0.75, y: 1.35, w: 1.35, h: 0.5, fontSize: 24, bold: true, color: C.textDark, margin: 0, align: "right" });
      s.addText(st.change, { x: cx + 1.5, y: 1.98, w: 0.55, h: 0.25, fontSize: 10, color: st.up ? C.success : C.danger, margin: 0, align: "right" });
    });

    s.addText("数据来源与采集机制", { x: 0.5, y: 2.9, w: 9, h: 0.35, fontSize: 15, bold: true, color: C.textDark, margin: 0 });
    [
      ["采集入口", "/api/dashboard/sync 手动触发 \u2192 BrowserManager.collectProfileData()"],
      ["采集范围", "bindType=manual 且 platform=douyin 的所有已绑定账号"],
      ["采集内容", "个人主页数据(粉丝/作品/点赞/评论)写入 DashboardStat 表"],
      ["更新频率", "手动触发（用户点击「同步」按钮）"],
      ["技术链路", "Electron IPC \u2192 Playwright CDP \u2192 DOM解析 \u2192 API写SQLite"],
    ].forEach((row, i) => {
      const ry = 3.3 + i * 0.42;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: ry, w: 1.4, h: 0.36, fill: { color: C.success, transparency: 91 }, rectRadius: 0.04 });
      s.addText(row[0], { x: 0.5, y: ry, w: 1.4, h: 0.36, fontSize: 10, color: C.success, align: "center", valign: "middle", margin: 0, bold: true });
      s.addText(row[1], { x: 2.0, y: ry, w: 7.5, h: 0.36, fontSize: 11, color: C.textDark, valign: "middle", margin: 0 });
    });
  })();

  // ═══ SLIDE 6: Device & Admin Cards ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.bgDark } });
    s.addText("设备卡片 & 管理面板", { x: 0.6, y: 0.2, w: 8, h: 0.6, fontSize: 24, fontFace: "Arial", color: C.textWhite, bold: true, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.04, fill: { color: "F59E0B" } });

    s.addText("Q1 设备卡片", { x: 0.5, y: 1.1, w: 4, h: 0.35, fontSize: 15, bold: true, color: C.textDark, margin: 0 });
    s.addText("/admin/devices  \u00B7  /admin/phy-devices", { x: 0.5, y: 1.42, w: 4, h: 0.25, fontSize: 9, color: C.textMuted, margin: 0 });

    // Device card
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.75, w: 4.3, h: 1.6, fill: { color: C.cardBg }, rectRadius: 0.1, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.75, w: 4.3, h: 0.06, fill: { color: "F59E0B" } });
    s.addImage({ data: icons.mobile, x: 0.7, y: 1.95, w: 0.4, h: 0.4 });
    s.addText("T0001 - Q1 容器 #1", { x: 1.2, y: 1.98, w: 2.5, h: 0.28, fontSize: 13, bold: true, color: C.textDark, margin: 0 });
    s.addText("API:30001  ADB:30000  RPA:30002", { x: 1.2, y: 2.26, w: 3, h: 0.24, fontSize: 10, color: C.textMuted, margin: 0 });
    [[30001, C.success], [30000, C.accent], [30002, C.textMuted]].forEach((p, pi) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.2 + pi * 0.95, y: 2.58, w: 0.85, h: 0.28, fill: { color: p[1], transparency: 87 }, rectRadius: 0.04 });
      s.addText(String(p[0]), { x: 1.2 + pi * 0.95, y: 2.58, w: 0.85, h: 0.28, fontSize: 8, color: p[1], align: "center", valign: "middle", margin: 0 });
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.4, y: 2.95, w: 1.2, h: 0.32, fill: { color: "F59E0B" }, rectRadius: 0.06 });
    s.addText("远程截图", { x: 3.4, y: 2.95, w: 1.2, h: 0.32, fontSize: 9, color: C.textWhite, align: "center", valign: "middle", margin: 0 });

    // Admin panel grid
    s.addText("管理中心卡片矩阵", { x: 5.2, y: 1.1, w: 4, h: 0.35, fontSize: 15, bold: true, color: C.textDark, margin: 0 });
    [
      { name: "数据看板", path: "/admin/dashboard", c: "8B5CF6" },
      { name: "客户中心", path: "/admin/users", c: "06B6D4" },
      { name: "社交账号", path: "/admin/social-accounts", c: "10B981" },
      { name: "设备管理", path: "/admin/devices", c: "F59E0B" },
      { name: "直播中控", path: "/live", c: "EC4899" },
      { name: "代理工作台", path: "/admin/agent", c: "EF4444" },
    ].forEach((ac, i) => {
      const acol = i % 2, arow = Math.floor(i / 2), ax = 5.2 + acol * 2.3, ay = 1.5 + arow * 1.05;
      s.addShape(pres.shapes.RECTANGLE, { x: ax, y: ay, w: 2.15, h: 0.9, fill: { color: C.cardBg }, rectRadius: 0.08, shadow: sh() });
      s.addShape(pres.shapes.RECTANGLE, { x: ax, y: ay, w: 2.15, h: 0.05, fill: { color: ac.c } });
      s.addText(ac.name, { x: ax + 0.12, y: ay + 0.15, w: 1.9, h: 0.3, fontSize: 11, bold: true, color: C.textDark, margin: 0 });
      s.addText(ac.path, { x: ax + 0.12, y: ay + 0.48, w: 1.9, h: 0.28, fontSize: 9, color: C.textMuted, margin: 0 });
    });

    // Design note
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.5, w: 9.0, h: 0.9, fill: { color: "FFF8E7", transparency: 92 }, rectRadius: 0.08 });
    s.addText([
      { text: "\uD83D\uDCA1 设计规范要点  ", options: { bold: true, fontSize: 12, color: C.textDark } },
      { text: "所有管理面板卡片统一采用：顶部彩色状态条(4px) + 圆角矩形(8px) + 微投影 + 内边距12px。颜色编码：紫色=核心 / 青色=内容 / 绿色=数据 / 橙色=设备 / 粉色=直播 / 红色=运营", options: { fontSize: 10, color: C.textMuted } }
    ], { x: 0.7, y: 4.65, w: 8.6, h: 0.6, valign: "middle" });
  })();

  // ═══ SLIDE 7: Tech Architecture ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgDark };
    s.addText("技术架构 — 卡片组件分层", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 26, fontFace: "Arial", color: C.textWhite, bold: true, align: "center", margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 0.85, w: 3, h: 0.04, fill: { color: C.accent } });

    const layers = [
      { name: "UI 层 (React Components)", desc: "page.tsx 客户端组件 / useState 状态管理 / Tailwind CSS 样式", y: 1.2, c: "8B5CF6" },
      { name: "API 层 (Next.js Routes)", desc: "/api/* route.ts 处理请求 / JWT Cookie 鉴权 / Prisma ORM 查询", y: 2.1, c: "06B6D4" },
      { name: "数据层 (Prisma + SQLite)", desc: "Account / Device / PublishTask / DashboardStat 数据模型", y: 3.0, c: "10B981" },
      { name: "执行层 (Electron + Playwright)", desc: "BrowserInstance 管理 / CDP 通信 / douyin-publish.js 自动化脚本", y: 3.9, c: "F59E0B" },
    ];
    layers.forEach((layer, i) => {
      s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: layer.y, w: 8.4, h: 0.8, fill: { color: "1E293B" }, line: { color: layer.c, width: 1, transparency: 60 }, rectRadius: 0.08 });
      s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: layer.y, w: 0.08, h: 0.8, fill: { color: layer.c } });
      s.addShape(pres.shapes.OVAL, { x: 1.0, y: layer.y + 0.2, w: 0.4, h: 0.4, fill: { color: layer.c } });
      s.addText(String(i + 1), { x: 1.0, y: layer.y + 0.2, w: 0.4, h: 0.4, fontSize: 14, bold: true, color: C.textWhite, align: "center", valign: "middle", margin: 0 });
      s.addText(layer.name, { x: 1.55, y: layer.y + 0.12, w: 4, h: 0.32, fontSize: 13, bold: true, color: C.textWhite, margin: 0 });
      s.addText(layer.desc, { x: 1.55, y: layer.y + 0.44, w: 7.4, h: 0.3, fontSize: 10, color: "94A3B8", margin: 0 });
      if (i < layers.length - 1) s.addText("\u25BC", { x: 4.85, y: layer.y + 0.78, w: 0.3, h: 0.25, fontSize: 10, color: "475569", align: "center", margin: 0 });
    });
    ["'use client'", "useState / useEffect", "fetch credentials:include", "IPC invoke", "CDP Protocol"].forEach((tb, ti) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6 + ti * 1.88, y: 4.9, w: 1.78, h: 0.38, fill: { color: "1E3A5F" }, rectRadius: 0.06 });
      s.addText(tb, { x: 0.6 + ti * 1.88, y: 4.9, w: 1.78, h: 0.38, fontSize: 8.5, color: "94A3B8", align: "center", valign: "middle", margin: 0 });
    });
  })();

  // ═══ SLIDE 8: Summary ═══
  (() => {
    const s = pres.addSlide();
    s.background = { color: C.bgDark };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.primary } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.3, w: 10, h: 0.04, fill: { color: C.accent } });
    s.addText("AiMarketing 卡片体系", { x: 0.5, y: 0.8, w: 9, h: 0.7, fontSize: 34, fontFace: "Arial Black", color: C.textWhite, align: "center", margin: 0 });
    s.addText("让每一个业务单元都清晰可见、触手可及", { x: 0.5, y: 1.45, w: 9, h: 0.4, fontSize: 15, color: C.accent, align: "center" });

    [
      { num: "6", label: "卡片类型覆盖", sub: "账号 / 任务 / 数据 / 设备 / 配置 / 素材", c: "8B5CF6" },
      { num: "3", label: "角色层级适配", sub: "admin / editor / end-user 差异化展示", c: "06B6D4" },
      { num: "2", label: "部署形态支持", sub: "Web 浏览器 + Electron 桌面客户端", c: "10B981" },
      { num: "\u221E", label: "可扩展设计", sub: "新增卡片只需复用样式 + 定义接口", c: "F59E0B" },
    ].forEach((si, i) => {
      const sx = 0.55 + i * 2.35;
      s.addShape(pres.shapes.RECTANGLE, { x: sx, y: 2.1, w: 2.2, h: 2.0, fill: { color: "1E293B" }, rectRadius: 0.1, line: { color: si.c, width: 0.5, transparency: 60 } });
      s.addText(si.num, { x: sx, y: 2.2, w: 2.2, h: 0.7, fontSize: 36, bold: true, color: si.c, align: "center", margin: 0 });
      s.addText(si.label, { x: sx + 0.1, y: 2.9, w: 2.0, h: 0.35, fontSize: 12, bold: true, color: C.textWhite, align: "center", margin: 0 });
      s.addText(si.sub, { x: sx + 0.1, y: 3.28, w: 2.0, h: 0.7, fontSize: 9, color: "94A3B8", align: "center" });
    });

    s.addText("AiMarketing V1.8  |  Next.js 14 + TypeScript + Tailwind CSS  |  2026-06-12", { x: 0.5, y: 4.6, w: 9, h: 0.35, fontSize: 10, color: "64748B", align: "center" });
    s.addText("github.com:57974422j-art/AiMarketing", { x: 0.5, y: 4.95, w: 9, h: 0.3, fontSize: 9, color: "475569", align: "center" });
  })();

  // ═══ Write File ═══
  const outFile = "d:\\\\AiMarketing\\\\AiMarketing-Cards-PPT.pptx";
  console.log("Writing:", outFile);
  await pres.writeFile({ fileName: outFile });
  console.log("DONE!");
}

main().catch(console.error);
