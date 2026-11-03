import { describe, it, expect } from 'vitest';
import {
  contextTokensForModel,
  formatContextTokens,
  modelsEndpoint,
  parseLlmModels,
} from './llmModels';

describe('modelsEndpoint', () => {
  it('OpenAI 兼容：/v1、/chat/completions、已带 /models', () => {
    expect(modelsEndpoint('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1/models');
    expect(modelsEndpoint('https://api.openai.com/v1/chat/completions', 'openai')).toBe('https://api.openai.com/v1/models');
    expect(modelsEndpoint('https://api.openai.com/v1/models/', 'openai')).toBe('https://api.openai.com/v1/models');
    expect(modelsEndpoint('https://example.com/v1///', 'openai')).toBe('https://example.com/v1/models');
  });

  it('Anthropic：根地址、/v1、/messages、已带 /models', () => {
    expect(modelsEndpoint('https://api.anthropic.com', 'anthropic')).toBe('https://api.anthropic.com/v1/models');
    expect(modelsEndpoint('https://api.anthropic.com/v1', 'anthropic')).toBe('https://api.anthropic.com/v1/models');
    expect(modelsEndpoint('https://api.anthropic.com/v1/messages', 'anthropic')).toBe('https://api.anthropic.com/v1/models');
    expect(modelsEndpoint('https://api.anthropic.com/v1/models', 'anthropic')).toBe('https://api.anthropic.com/v1/models');
  });

  it('空 Base URL 返回空串', () => {
    expect(modelsEndpoint('   ', 'openai')).toBe('');
  });
});

describe('contextTokensForModel', () => {
  it('常见模型的内置目录', () => {
    expect(contextTokensForModel('gpt-4o')).toBe(128_000);
    expect(contextTokensForModel('gpt-4o-mini-2024-07-18')).toBe(128_000);
    expect(contextTokensForModel('gpt-4.1-mini')).toBe(1_047_576);
    expect(contextTokensForModel('gpt-4-turbo')).toBe(128_000);
    expect(contextTokensForModel('gpt-4-32k')).toBe(32_768);
    expect(contextTokensForModel('gpt-4')).toBe(8_192);
    expect(contextTokensForModel('gpt-3.5-turbo')).toBe(16_385);
    expect(contextTokensForModel('o3-mini')).toBe(200_000);
    expect(contextTokensForModel('deepseek-chat')).toBe(128_000);
    expect(contextTokensForModel('claude-3.5-sonnet')).toBe(200_000);
    expect(contextTokensForModel('gemini-2.5-pro')).toBe(1_048_576);
    expect(contextTokensForModel('llama-3.1-70b')).toBe(131_072);
    expect(contextTokensForModel('moonshot-v1-32k')).toBe(32_768);
    expect(contextTokensForModel('glm-4.5')).toBe(131_072);
  });

  it('剥离 OpenRouter 的 provider 前缀与变体后缀', () => {
    expect(contextTokensForModel('openai/gpt-4o')).toBe(128_000);
    expect(contextTokensForModel('anthropic/claude-3.5-sonnet:beta')).toBe(200_000);
    expect(contextTokensForModel('deepseek/deepseek-chat:free')).toBe(128_000);
  });

  it('未知模型支持 -64k 之类的后缀兜底', () => {
    expect(contextTokensForModel('my-private-model-64k')).toBe(65_536);
    expect(contextTokensForModel('unknown-model')).toBeNull();
    expect(contextTokensForModel('')).toBeNull();
  });
});

describe('formatContextTokens', () => {
  it('K / M 缩写', () => {
    expect(formatContextTokens(8_192)).toBe('8K');
    expect(formatContextTokens(16_385)).toBe('16K');
    expect(formatContextTokens(128_000)).toBe('128K');
    expect(formatContextTokens(200_000)).toBe('200K');
    expect(formatContextTokens(1_047_576)).toBe('1.0M');
    expect(formatContextTokens(2_097_152)).toBe('2.1M');
  });
});

describe('parseLlmModels', () => {
  it('OpenAI {data:[{id}]}', () => {
    const models = parseLlmModels({
      object: 'list',
      data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
    });
    expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(models[0].contextTokens).toBe(128_000);
  });

  it('接口元数据优先于内置目录', () => {
    const models = parseLlmModels({
      data: [{ id: 'gpt-4o', context_length: 200_000 }],
    });
    expect(models[0].contextTokens).toBe(200_000);
  });

  it('OpenRouter top_provider.context_length / vLLM max_model_len', () => {
    const models = parseLlmModels({
      data: [
        { id: 'openai/gpt-4o', name: 'GPT-4o', top_provider: { context_length: 128_000 } },
        { id: 'local/llama', max_model_len: 32_768 },
      ],
    });
    expect(models.find((m) => m.id === 'openai/gpt-4o')?.contextTokens).toBe(128_000);
    expect(models.find((m) => m.id === 'local/llama')?.contextTokens).toBe(32_768);
  });

  it('Anthropic {data:[{id, display_name}]}', () => {
    const models = parseLlmModels({
      data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', type: 'model' }],
    });
    expect(models).toEqual([
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextTokens: 200_000 },
    ]);
  });

  it('裸数组 / {models:[]} / model 字段', () => {
    expect(parseLlmModels(['model-a', 'model-b']).map((m) => m.id)).toEqual(['model-a', 'model-b']);
    expect(parseLlmModels({ models: [{ model: 'deepseek-chat' }] })[0]).toMatchObject({
      id: 'deepseek-chat',
      contextTokens: 128_000,
    });
  });

  it('去重、跳过无 id 项、容忍坏数据', () => {
    expect(parseLlmModels({
      data: [{ id: 'a' }, { id: 'a' }, { name: 'no-id' }, null, 42],
    }).map((m) => m.id)).toEqual(['a']);
    expect(parseLlmModels({})).toEqual([]);
    expect(parseLlmModels({ data: 'not-an-array' })).toEqual([]);
    expect(parseLlmModels(null)).toEqual([]);
  });
});
