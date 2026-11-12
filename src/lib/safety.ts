/**
 * 心理安全检测（确定性规则）
 *
 * 只做短语级匹配，命中后由 UI 使用固定支持模板，不把危机回应交给模型自由发挥。
 * 目标是「先支持、再谈训练」，不是诊断。
 */

export type SafetyLevel = 'crisis' | 'distress';

const CRISIS_RE = /(自杀|自尽|轻生|不想活|活不下去|结束生命|伤害自己|自残|割腕|跳楼|kill\s*myself|suicide|end\s+my\s+life|self[-\s]*harm|want\s+to\s+die|no\s+quiero\s+vivir|quiero\s+morir|死にたい|消えたい)/i;
const DISTRESS_RE = /(绝望|撑不住|崩溃|讨厌自己|厌恶自己的声音|不想说话|没希望|hopeless|can'?t\s+go\s+on|hate\s+my\s+voice|no\s+aguanto|声が嫌|もう無理)/i;

/** 返回危机级别；普通文本返回 null */
export function detectSafetyLevel(text: string): SafetyLevel | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (CRISIS_RE.test(normalized)) return 'crisis';
  if (DISTRESS_RE.test(normalized)) return 'distress';
  return null;
}
