/**
 * ★VF_MSGCLAMP_V1（2026-10-10 用户线上实测 400，两个通道都拒收）
 * =============================================================================
 * 原始错误（pm2 日志）：
 *   [qwen3.8] 调用异常: HTTP 400 <400> InternalError.Algo.InvalidParameter:
 *              Empty tool_calls is not supported in message.
 *   [deepseek] 异常降级百炼: HTTP 400 Invalid 'messages[12].tool_calls':
 *              empty array. Expected an array with minimum length 1, but got an empty array instead.
 * 病灶：历史消息里 assistant 的 `tool_calls: []`（**空数组**）被原样发出去 —— 两家都当非法参数拒收
 *   ⇒ 大脑与书写双双失败 ⇒ HTML成片的文案只写出一半（卡片上出现「第四张 · 第五张」那种降级拼句）。
 * 口径：**发出去之前统一清洗**（只做减法，不改语义）：
 *   · `tool_calls` 是空数组 / 不是数组 ⇒ 直接删掉这个键（OpenAI 语义：没有工具调用就不该出现这个键）；
 *   · assistant 消息既无 content 又无 tool_calls ⇒ 整条丢掉（空壳消息没有任何信息，还容易被判非法）；
 *   · 其它角色与字段**原样保留**（只浅拷贝，不改调用方对象）。
 * 单测：temp/_spec/text-heal.mjs（含反例：tool 消息、带内容的 assistant、正常 user 都不许被动）。
 */

export function clampMessages(msgs: any[]): any[] {
  const out: any[] = []
  for (const m of (Array.isArray(msgs) ? msgs : [])) {
    if (!m || typeof m !== 'object') continue
    const o: any = { ...m }
    if (o.tool_calls !== undefined && !Array.isArray(o.tool_calls)) delete o.tool_calls
    if (Array.isArray(o.tool_calls) && o.tool_calls.length === 0) delete o.tool_calls
    if (o.role === 'assistant' && o.tool_calls === undefined && !o.content) continue
    out.push(o)
  }
  return out
}
