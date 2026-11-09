import { describe, expect, it } from 'vitest';
import {
  buildChoiceSetUserMessage,
  buildChoiceUserMessage,
  choiceResultLabel,
  choiceSetSummary,
  parseChoiceCall,
  parseChoiceSetCall,
} from './assistantChoice';

describe('parseChoiceCall', () => {
  it('parses a single-choice question', () => {
    const c = parseChoiceCall({
      question: '想先练哪个方向？',
      selection: 'single',
      options: [
        { label: '音高', description: '提高中位 F0' },
        { label: '共鸣' },
      ],
    });
    expect(c?.question).toBe('想先练哪个方向？');
    expect(c?.selection).toBe('single');
    expect(c?.options).toHaveLength(2);
    expect(c?.options[0].id).toBe('o1');
    expect(c?.allowOther).toBe(true);
  });

  it('parses multiple choice and ids', () => {
    const c = parseChoiceCall({
      question: '记录哪些方面？',
      selection: 'multiple',
      options: [{ id: 'pitch', label: '音高' }, { id: 'resonance', label: '共鸣' }, { id: 'pitch', label: '重复' }],
    });
    expect(c?.selection).toBe('multiple');
    expect(c?.options.map((o) => o.id)).toEqual(['pitch', 'resonance']);
    expect(parseChoiceCall({ question: 'x', options: [{ label: 'only one' }] })).toBeNull();
    expect(parseChoiceCall({ question: '', options: [{ label: 'a' }, { label: 'b' }] })).toBeNull();
  });
});

describe('choice messages', () => {
  const choice = parseChoiceCall({
    question: '想先练哪个方向？',
    options: [{ id: 'pitch', label: '音高' }, { id: 'resonance', label: '共鸣' }],
  })!;

  it('builds a user message for selected ids and custom input', () => {
    expect(buildChoiceUserMessage(choice, { selectedIds: ['pitch'] })).toContain('音高');
    const withCustom = buildChoiceUserMessage(choice, { selectedIds: ['resonance'], custom: '稳定度' });
    expect(withCustom).toContain('共鸣');
    expect(withCustom).toContain('其他：稳定度');
  });

  it('builds skip and label summaries', () => {
    expect(buildChoiceUserMessage(choice, { selectedIds: [], skipped: true })).toContain('先不决定');
    expect(choiceResultLabel(choice, { selectedIds: ['pitch'], custom: '稳定度' })).toBe('音高、其他：稳定度');
    expect(choiceResultLabel(choice, { selectedIds: [], skipped: true })).toBe('');
  });
});

describe('parseChoiceSetCall', () => {
  it('parses 2–4 questions with stable ids', () => {
    const set = parseChoiceSetCall({
      questions: [
        {
          question: '想先练哪个方向？',
          selection: 'single',
          options: [{ label: '音高' }, { label: '共鸣' }],
        },
        {
          question: '每次练多久？',
          selection: 'multiple',
          options: [{ label: '5 分钟' }, { label: '10 分钟' }],
        },
      ],
    });
    expect(set?.questions).toHaveLength(2);
    expect(set?.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(set?.questions[1].selection).toBe('multiple');
    expect(set?.questions[0].options[0].id).toBe('o1');
  });

  it('rejects fewer than 2 valid questions', () => {
    expect(parseChoiceSetCall({ questions: [] })).toBeNull();
    expect(
      parseChoiceSetCall({
        questions: [
          { question: '只有一个选项？', options: [{ label: 'A' }] },
          { question: '这个也无效', options: [] },
        ],
      }),
    ).toBeNull();
  });
});

describe('choice set messages', () => {
  const set = parseChoiceSetCall({
    questions: [
      { question: '方向？', options: [{ id: 'pitch', label: '音高' }, { id: 'res', label: '共鸣' }] },
      { question: '时长？', options: [{ id: 'short', label: '5 分钟' }, { id: 'long', label: '10 分钟' }] },
    ],
  })!;

  it('builds one user message listing every answer', () => {
    const text = buildChoiceSetUserMessage(set, {
      answers: [
        { questionId: 'q1', selectedIds: ['pitch'] },
        { questionId: 'q2', selectedIds: ['long'], custom: '15 分钟' },
      ],
    });
    expect(text).toContain('2 个问题');
    expect(text).toContain('音高');
    expect(text).toContain('10 分钟');
    expect(text).toContain('其他：15 分钟');
  });

  it('marks unanswered questions and summarizes progress', () => {
    const result = {
      answers: [
        { questionId: 'q1', selectedIds: ['pitch'] },
        { questionId: 'q2', selectedIds: [], skipped: true },
      ],
    };
    expect(buildChoiceSetUserMessage(set, result)).toContain('先不选');
    expect(choiceSetSummary(set, result)).toBe('1/2');
    expect(choiceSetSummary(set, { answers: [], skipped: true })).toBe('');
  });
});
