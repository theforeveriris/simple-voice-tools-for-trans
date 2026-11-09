import { describe, expect, it } from 'vitest';
import { buildChoiceUserMessage, choiceResultLabel, parseChoiceCall } from './assistantChoice';

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
