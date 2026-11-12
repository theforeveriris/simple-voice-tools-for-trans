import { describe, expect, it } from 'vitest';
import { detectSafetyLevel } from './safety';

describe('detectSafetyLevel', () => {
  it('detects crisis phrases', () => {
    expect(detectSafetyLevel('我不想活了')).toBe('crisis');
    expect(detectSafetyLevel('I want to die')).toBe('crisis');
    expect(detectSafetyLevel('死にたい')).toBe('crisis');
  });

  it('detects acute distress without a crisis plan', () => {
    expect(detectSafetyLevel('我讨厌自己的声音，感觉很绝望')).toBe('distress');
    expect(detectSafetyLevel('hate my voice and feel hopeless')).toBe('distress');
  });

  it('does not flag casual hyperbole', () => {
    expect(detectSafetyLevel('这个练习笑死我了')).toBeNull();
    expect(detectSafetyLevel('练到累死')).toBeNull();
    expect(detectSafetyLevel('今天声音状态不错')).toBeNull();
  });
});
