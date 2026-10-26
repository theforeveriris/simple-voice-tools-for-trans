import { describe, it, expect } from 'vitest';
import {
  parseSemver, compareSemver, releaseToUpdate, pickLatestRelease, type ReleaseLike,
} from './appUpdate';

describe('parseSemver / compareSemver', () => {
  it('解析三段版本；容忍 v 前缀与预发布后缀', () => {
    expect(parseSemver('0.8.0')).toEqual([0, 8, 0]);
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('0.9.0-rc.1')).toEqual([0, 9, 0]);
    expect(parseSemver('latest')).toBeNull();
  });

  it('逐段比较；非法输入返回 null', () => {
    expect(compareSemver('0.8.0', '0.7.9')).toBe(1);
    expect(compareSemver('0.7.0', '0.7.0')).toBe(0);
    expect(compareSemver('0.7.0', '1.0.0')).toBe(-1);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1); // 数字比较而非字符串
    expect(compareSemver('0.8', '0.8.0')).toBeNull();
  });
});

const ROLLING: ReleaseLike = {
  tag_name: 'latest',
  html_url: 'https://github.com/o/r/releases/tag/latest',
  prerelease: true,
  assets: [
    { name: 'SimpleVoiceToolForTrans-v0.7.0-debug.apk', browser_download_url: 'https://…/SimpleVoiceToolForTrans-v0.7.0-debug.apk' },
  ],
};

const FORMAL: ReleaseLike = {
  tag_name: 'v0.8.0',
  html_url: 'https://github.com/o/r/releases/tag/v0.8.0',
  prerelease: false,
  assets: [
    { name: 'SimpleVoiceToolForTrans-v0.8.0-debug.apk', browser_download_url: 'https://…/SimpleVoiceToolForTrans-v0.8.0-debug.apk' },
  ],
};

describe('releaseToUpdate', () => {
  it('从 APK 资产名解析版本；tag 无版本号（latest）也成立', () => {
    const info = releaseToUpdate(ROLLING);
    expect(info?.version).toBe('0.7.0');
    expect(info?.prerelease).toBe(true);
    expect(info?.apkUrl).toContain('v0.7.0-debug.apk');
  });

  it('draft / 无 APK / 无版本号 → null', () => {
    expect(releaseToUpdate({ ...ROLLING, draft: true })).toBeNull();
    expect(releaseToUpdate({ tag_name: 'v1.0.0', assets: [{ name: 'readme.txt', browser_download_url: 'x' }] })).toBeNull();
    expect(releaseToUpdate({ tag_name: 'latest', assets: [{ name: 'app.apk', browser_download_url: 'x' }] })).toBeNull();
  });

  it('同 release 多资产（换版本后旧资产残留）取最高版本', () => {
    const info = releaseToUpdate({
      tag_name: 'latest',
      prerelease: true,
      assets: [
        { name: 'SimpleVoiceToolForTrans-v0.7.0-debug.apk', browser_download_url: 'https://…/v0.7.0' },
        { name: 'SimpleVoiceToolForTrans-v0.8.0-debug.apk', browser_download_url: 'https://…/v0.8.0' },
      ],
    });
    expect(info?.version).toBe('0.8.0');
    expect(info?.apkUrl).toContain('v0.8.0');
  });
});

describe('pickLatestRelease', () => {
  it('版本最高者胜出；同版本时正式发布优先于滚动预发布', () => {
    expect(pickLatestRelease([ROLLING, FORMAL])?.version).toBe('0.8.0');
    // 版本相同：formal 覆盖 rolling（夹具资产名同步为 0.7.0，模拟正式发布）
    const sameVersionFormal: ReleaseLike = {
      ...FORMAL,
      tag_name: 'v0.7.0',
      assets: [{ name: 'SimpleVoiceToolForTrans-v0.7.0-debug.apk', browser_download_url: 'https://…/v0.7.0-formal' }],
    };
    const info = pickLatestRelease([ROLLING, sameVersionFormal]);
    expect(info?.version).toBe('0.7.0');
    expect(info?.prerelease).toBe(false);
  });

  it('空列表 / 全部不合格 → null', () => {
    expect(pickLatestRelease([])).toBeNull();
    expect(pickLatestRelease([{ tag_name: 'latest' }])).toBeNull();
  });
});
