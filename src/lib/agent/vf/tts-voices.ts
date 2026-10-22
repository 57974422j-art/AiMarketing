/**
 * ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」+「加个字段让 AI 知道做什么配音合适」）
 * =============================================================================
 * 现状（改之前）：
 *   · `tts-node.mjs` 与 `ai-providers.ts:qwenTtsVoice` 都只放行 **4 个音色**
 *     （Cherry / Serena / Ethan / Chelsie），阿里实际有 **48 个**；
 *   · 5 个老 id（longxiaochun…）全被折成这 4 个 ⇒ 卡片上"选音色"等于没选。
 *
 * 本文件是**音色数据的唯一真源**（纯数据 + 纯函数，**不 import 任何业务模块** ——
 * 因为 `ai-providers.ts` 也要用它的映射，进口业务模块会拉出循环依赖）。
 *   · 镜像文件：`scripts/video-factory/html-deck/tools/tts-voices.json`
 *     （`scripts/` 下的 Node 工具不能 import TS ⇒ 只能读 json）。
 *     ⚠️ 两份由 `temp/_daily/_voice_probe.ts` 断言**逐字一致**（含 legacy 映射）——
 *        改了这里忘了改 json ⇒ 探针当场红（本项目对"两处必须一致"的一贯做法）。
 *
 * 数据来源：阿里云百炼《Qwen-TTS 音色列表》（2026-10 核对；官方公告写 17→51，
 *   列表页列 48 ⇒ **以接口实际返回为准**，多出来的 id 也不会被本表拦（见 pickTtsVoice 的宽松分支））。
 *
 * 为什么只"重点展示"一部分：48 个里有二次元/萝莉/外语角色音，对餐饮营销基本没用；
 *   卡片上默认只列 `hot` 的 15 个 + 折叠"更多音色（33 个）"（选择困难比没有选项更糟）。
 */

export type TtsVoice = {
  /** 官方 voice 参数（**必须逐字一致**：这是请求阿里 API 时用的值） */
  id: string
  /** 中文名（卡片上给人看） */
  name: string
  gender: '女' | '男'
  /** 语种/方言（'普' = 普通话+9 外语；其余为方言） */
  lang: string
  /** 官方描述（截短，只用来说明"什么味儿"） */
  desc: string
  /** 分组标签（卡片 optgroup / AI 挑音色的依据） */
  tag: '营销' | '温柔' | '活泼' | '沉稳' | '纪实' | '角色' | '方言' | '多语'
  /** 默认展示（营销常用） */
  hot?: boolean
}

/** 48 个音色（顺序 = 官网顺序；`hot` = 卡片默认列出的 12 个） */
export const TTS_VOICES: TtsVoice[] = [
  { id: 'Cherry', name: '芊悦', gender: '女', lang: '普', desc: '阳光积极、亲切自然的小姐姐', tag: '营销', hot: true },
  { id: 'Serena', name: '苏瑶', gender: '女', lang: '普', desc: '温柔小姐姐', tag: '温柔', hot: true },
  { id: 'Ethan', name: '晨煦', gender: '男', lang: '普', desc: '阳光、温暖、有活力朝气（带北方口音）', tag: '营销', hot: true },
  { id: 'Chelsie', name: '千雪', gender: '女', lang: '普', desc: '二次元虚拟女友', tag: '角色' },
  { id: 'Momo', name: '茉兔', gender: '女', lang: '普', desc: '撒娇搞怪，逗你开心', tag: '活泼' },
  { id: 'Vivian', name: '十三', gender: '女', lang: '普', desc: '拽拽的、可爱的小暴躁', tag: '活泼' },
  { id: 'Moon', name: '月白', gender: '男', lang: '普', desc: '率性帅气', tag: '营销', hot: true },
  { id: 'Maia', name: '四月', gender: '女', lang: '普', desc: '知性与温柔的碰撞', tag: '温柔', hot: true },
  { id: 'Kai', name: '凯', gender: '男', lang: '普', desc: '耳朵的一场 SPA（磁性舒服）', tag: '沉稳', hot: true },
  { id: 'Nofish', name: '不吃鱼', gender: '男', lang: '普', desc: '不会翘舌音的设计师', tag: '角色' },
  { id: 'Bella', name: '萌宝', gender: '女', lang: '普', desc: '喝酒不打醉拳的小萝莉', tag: '角色' },
  { id: 'Jennifer', name: '詹妮弗', gender: '女', lang: '多语', desc: '品牌级、电影质感般的美语女声', tag: '多语', hot: true },
  { id: 'Ryan', name: '甜茶', gender: '男', lang: '多语', desc: '节奏拉满、戏感炸裂，真实与张力共舞', tag: '营销', hot: true },
  { id: 'Katerina', name: '卡捷琳娜', gender: '女', lang: '多语', desc: '御姐音色，韵律回味十足', tag: '多语' },
  { id: 'Aiden', name: '艾登', gender: '男', lang: '多语', desc: '精通厨艺的美语大男孩', tag: '多语' },
  { id: 'Eldric Sage', name: '沧明子', gender: '男', lang: '普', desc: '沉稳睿智的老者，沧桑如松', tag: '沉稳', hot: true },
  { id: 'Mia', name: '乖小妹', gender: '女', lang: '普', desc: '温顺如春水，乖巧如初雪', tag: '温柔' },
  { id: 'Mochi', name: '沙小弥', gender: '男', lang: '普', desc: '聪明伶俐的小大人', tag: '角色' },
  { id: 'Bellona', name: '燕铮莺', gender: '女', lang: '普', desc: '声音洪亮、吐字清晰，人声千面', tag: '营销', hot: true },
  { id: 'Vincent', name: '田叔', gender: '男', lang: '普', desc: '独特的沙哑烟嗓，一口江湖豪情', tag: '沉稳', hot: true },
  { id: 'Bunny', name: '萌小姬', gender: '女', lang: '普', desc: '萌属性爆棚的小萝莉', tag: '角色' },
  { id: 'Neil', name: '阿闻', gender: '男', lang: '普', desc: '字正腔圆，最专业的新闻主持人', tag: '纪实', hot: true },
  { id: 'Elias', name: '墨讲师', gender: '女', lang: '普', desc: '学科严谨 + 叙事技巧', tag: '纪实' },
  { id: 'Arthur', name: '徐大爷', gender: '男', lang: '普', desc: '被岁月浸泡过的质朴嗓音', tag: '沉稳' },
  { id: 'Nini', name: '邻家妹妹', gender: '女', lang: '普', desc: '糯米糍一样又软又黏的嗓音', tag: '温柔' },
  { id: 'Seren', name: '小婉', gender: '女', lang: '普', desc: '温和舒缓，适合助眠', tag: '温柔' },
  { id: 'Pip', name: '顽屁小孩', gender: '男', lang: '普', desc: '调皮捣蛋但充满童真', tag: '角色' },
  { id: 'Stella', name: '少女阿月', gender: '女', lang: '普', desc: '甜到发腻的迷糊少女音', tag: '角色' },
  { id: 'Bodega', name: '博德加', gender: '男', lang: '多语', desc: '热情的西班牙大叔', tag: '多语' },
  { id: 'Sonrisa', name: '索尼莎', gender: '女', lang: '多语', desc: '热情开朗的拉美大姐', tag: '多语' },
  { id: 'Alek', name: '阿列克', gender: '男', lang: '多语', desc: '战斗民族的冷与暖', tag: '多语' },
  { id: 'Dolce', name: '多尔切', gender: '男', lang: '多语', desc: '慵懒的意大利大叔', tag: '多语' },
  { id: 'Sohee', name: '素熙', gender: '女', lang: '多语', desc: '温柔开朗、情绪丰富的韩国欧尼', tag: '多语' },
  { id: 'Ono Anna', name: '小野杏', gender: '女', lang: '多语', desc: '鬼灵精怪的青梅竹马', tag: '多语' },
  { id: 'Lenn', name: '莱恩', gender: '男', lang: '多语', desc: '理性是底色，叛逆藏在细节里', tag: '多语' },
  { id: 'Emilien', name: '埃米尔安', gender: '男', lang: '多语', desc: '浪漫的法国大哥哥', tag: '多语' },
  { id: 'Andre', name: '安德雷', gender: '男', lang: '多语', desc: '声音磁性，自然舒服、沉稳', tag: '多语' },
  { id: 'Radio Gol', name: '拉迪奥·戈尔', gender: '男', lang: '多语', desc: '足球解说腔', tag: '多语' },
  { id: 'Jada', name: '上海-阿珍', gender: '女', lang: '上海话', desc: '风风火火的沪上阿姐', tag: '方言' },
  { id: 'Dylan', name: '北京-晓东', gender: '男', lang: '北京话', desc: '北京胡同里长大的少年', tag: '方言', hot: true },
  { id: 'Li', name: '南京-老李', gender: '男', lang: '南京话', desc: '耐心的瑜伽老师', tag: '方言' },
  { id: 'Marcus', name: '陕西-秦川', gender: '男', lang: '陕西话', desc: '面宽话短，心实声沉', tag: '方言' },
  { id: 'Roy', name: '闽南-阿杰', gender: '男', lang: '闽南语', desc: '诙谐直爽、市井活泼', tag: '方言' },
  { id: 'Peter', name: '天津-李彼得', gender: '男', lang: '天津话', desc: '天津相声，专业捧哏', tag: '方言' },
  { id: 'Sunny', name: '四川-晴儿', gender: '女', lang: '四川话', desc: '甜到你心里的川妹子', tag: '方言', hot: true },
  { id: 'Eric', name: '四川-程川', gender: '男', lang: '四川话', desc: '跳脱市井的成都男子', tag: '方言' },
  { id: 'Rocky', name: '粤语-阿强', gender: '男', lang: '粤语', desc: '幽默风趣的阿强', tag: '方言', hot: true },
  { id: 'Kiki', name: '粤语-阿清', gender: '女', lang: '粤语', desc: '甜美的港妹闺蜜', tag: '方言' },
]

/** 老 id → 新 id（历史草稿/别的线都在用 longxiaochun 这一套；**不许直接删**，否则老单 400） */
export const LEGACY_VOICE_MAP: Record<string, string> = {
  longxiaochun: 'Cherry',
  longxiaoxia: 'Serena',
  cherry: 'Chelsie',
  longshu: 'Ethan',
  longchen: 'Ethan',
  longjing: 'Ethan',
  longxiaohui: 'Ethan',
}

const ID_SET = new Set(TTS_VOICES.map((v) => v.id))

export function isTtsVoice(id: any): boolean {
  return ID_SET.has(String(id === undefined || id === null ? '' : id).trim())
}

/** 归一化到**一个真实存在的音色 id**：新 id 原样 → 老 id 映射 → 兜底 Cherry（**绝不返回非法 id**） */
export function normTtsVoice(v: any): string {
  const s = String(v === undefined || v === null ? '' : v).trim()
  if (!s) return 'Cherry'
  if (ID_SET.has(s)) return s
  const legacy = LEGACY_VOICE_MAP[s.toLowerCase()]
  if (legacy && ID_SET.has(legacy)) return legacy
  return 'Cherry'
}

/** 白名单：命中返回 id，否则 ''（调用方**保持原值**，不静默改） */
export function pickTtsVoice(v: any): string {
  const s = String(v === undefined || v === null ? '' : v).trim()
  return ID_SET.has(s) ? s : ''
}

export function ttsVoiceName(id: any): string {
  const s = normTtsVoice(id)
  return TTS_VOICES.find((v) => v.id === s)?.name || s
}

/* ═════════ 口播气质（AI 只判"气质"，**音色由我们映射** —— 不让模型编 48 个 id）═════════
   用户 2026-10-22：「是否要添加一个字段给AI知道做什么配音比较适合？」
   ⇒ 是的，但字段值是**枚举**（6 个气质），AI 只挑气质；`tone → 音色` 用下面的表映射。
   好处：① 模型永远不会给出不存在的音色（它编的 id 会被白名单丢掉）；
        ② 出稿那一次调用顺带产出，**不额外烧点**；
        ③ 人话解释得住（卡片上写"AI 建议：晨煦（阳光男声）—— 这条片是热闹的火锅"）。 */

export const VOICE_TONES = ['lively', 'promo', 'warm', 'gang', 'doc', 'brand'] as const
export type VoiceTone = typeof VOICE_TONES[number]

export const TONE_LABEL: Record<string, string> = {
  lively: '活泼开场',
  promo: '热情叫卖',
  warm: '温柔叙述',
  gang: '江湖烟火',
  doc: '纪实旁白',
  brand: '品牌质感',
}

/** 气质 → 推荐音色（**第一个是默认**；全部必须在上面的 48 个里） */
export const TONE_VOICES: Record<string, string[]> = {
  lively: ['Cherry', 'Ryan', 'Ethan'],
  promo: ['Ryan', 'Ethan', 'Bellona'],
  warm: ['Serena', 'Maia', 'Nini'],
  gang: ['Vincent', 'Eldric Sage', 'Neil'],
  doc: ['Neil', 'Eldric Sage', 'Kai'],
  brand: ['Jennifer', 'Kai', 'Maia'],
}

export function pickVoiceTone(v: any): string {
  const s = String(v === undefined || v === null ? '' : v).trim()
  return (VOICE_TONES as readonly string[]).includes(s) ? s : ''
}

/** 气质 → 默认音色（拿不到气质 ⇒ Cherry，与历史默认一致） */
export function voiceForTone(tone: any): string {
  const t = pickVoiceTone(tone)
  const list = t ? TONE_VOICES[t] : null
  const first = list && list[0]
  return first && ID_SET.has(first) ? first : 'Cherry'
}

/** 卡片用：默认展示 12 个 + 其余（前端折叠"更多音色"） */
export function voiceOptions(): { hot: TtsVoice[]; rest: TtsVoice[]; all: TtsVoice[] } {
  const hot = TTS_VOICES.filter((v) => v.hot)
  const rest = TTS_VOICES.filter((v) => !v.hot)
  return { hot, rest, all: TTS_VOICES }
}
