/**
 * 大模型训练建议（实验性）——公共入口
 * 原单文件（911 行）按职责拆分为三个模块，本文件只做类型与 API 的 re-export，
 * 既有调用方（AdviceCard / WeeklyReportCard / AssistantPage / aiLocale / …）无需改动：
 *   - llmClient.ts  协议层：双协议请求组装、SSE 流式解析、用量提取、连接测试
 *   - llmAdvice.ts  业务层：分析标准提示词、数据载荷、结构化解析、建议与周报
 *   - llmCache.ts   缓存层：内存 + kv 二级缓存、缓存键（API Key 散列化）
 */

// 协议层
export {
  llmChat,
  llmChatStream,
  llmChatStreamMessages,
  llmToolCall,
  llmChatToolMessages,
  parseToolCalls,
  testLlmConnection,
  isAbortError,
  extractDataLines,
  resolveLlmConfig,
  type LlmConfig,
  type LlmProtocol,
  type LlmStreamOptions,
  type LlmToolSpec,
  type LlmToolCall,
  type LlmToolTurn,
  type LlmToolChatResult,
} from './llmClient';

// 模型列表 / 上下文识别
export {
  fetchLlmModels,
  modelsEndpoint,
  parseLlmModels,
  contextTokensForModel,
  formatContextTokens,
  type LlmModelInfo,
  type FetchLlmModelsInput,
} from './llmModels';

// 业务层（建议 / 周报）
export {
  languageName,
  fetchLlmAdvice,
  fetchWeeklyReport,
  buildSystemPrompt,
  parseLlmAdviceResult,
  weekRecords,
  buildWeeklyPayload,
  type AdviceAssessment,
  type LlmAdviceResult,
  type LlmPromptOptions,
} from './llmAdvice';

// 缓存层
export {
  cachedLlmAdvice,
  cachedWeeklyReport,
  hasCachedLlmAdvice,
  hasCachedWeeklyReport,
  llmAdviceKey,
  weeklyReportKey,
} from './llmCache';
