# 元音与共鸣分析算法

本文覆盖应用里与「元音 / 共鸣」相关的两套算法：

1. **自由朗读的 VFP 风格参考分**：用 H95 英语元音的 24 个男女参考点做逐帧归一，得到 0–100 的参考分；
2. **长音测试的普通话元音自动判定**：从稳态段判断最接近的普通话主元音（a / o / e / i / u / ü），再与该元音的同性别参考比较。

两套算法都建立在 `ALGORITHM-FORMANT-LPC.md` 的逐帧 F1/F2 之上；但参考集、目标与置信度口径不同，不能混用。

---

## 一、三套参考点

应用里同时存在三套元音参考，用途各不相同：

| 参考集 | 位置 | 来源 | 数量 | 用途 |
| --- | --- | --- | --- | --- |
| `VOWEL_REFS` | `constants/index.ts` | Peterson & Barney (1952) | i / a / u 三点 | 元音空间散点图的视觉参考圈 |
| `VOWEL_REFS_H95` | `lib/voiceExpression.ts` | Hillenbrand et al. (1995) | 12 个美式英语元音 × 男女 = 24 点 | 自由朗读的 VFP 风格参考分 |
| `MANDARIN_VOWELS` | `lib/mandarinVowels.ts` | Meng, Chen & Li (2006) | 6 个普通话主元音 × 男女 = 12 点 | 长音测试的元音自动判定 |

> **不要混用**：散点图的 i/a/u 只是坐标参照；VFP 分数用的是美式英语 12 元音；长音元音检查用的是普通话 6 元音。三套参考的语料、语言和分组都不同。

---

## 二、自由朗读：VFP 风格参考分

该分数的完整算法（音高 logistic、H95 24 点归一、55/45 综合、分档、置信度与局限）独立成篇，见 `ALGORITHM-VOICE-EXPRESSION.md`。与元音相关的要点：

- 每帧 F1/F2 映射到 12 个 H95 英语元音 × 男女共 24 个参考点，得到 −1..+1 的 `position`；
- 按最近参考元音分组、按时长加权，得到整段共鸣位置；
- 长音记录不显示该综合分，改用下文的普通话元音检查。

---

## 三、长音测试：普通话元音自动判定

### 3.1 取稳定段

1. 收集 F0 / F1 / F2 同帧有效、且 `F2 > F1` 的帧；
2. 找**最长连续段**，允许连续缺帧 ≤ 2（共振峰偶发丢失）；
3. 去掉头尾各 20%，只取中段；中段不足 8 帧（约 0.27 秒）判样本不足；
4. 对中段取中位数：`F1`、`F2`、`F0`；
5. 稳定性：`log-F1` + `log-F2` 相对中位数的中位绝对偏差；> 0.07（约 7%）标「波动较大，建议重录」。

### 3.2 判定元音

对 6 个普通话主元音分别计算：

```text
d男 = logDist(F1, F2, 男参考)
d女 = logDist(F1, F2, 女参考)
score = min(d男, d女)
```

取 `score` 最小的元音为最佳候选；第二候选必须换一个元音（同一元音的另一性别不算）。置信度：

| 条件 | 置信度 |
| --- | --- |
| `score > 0.35`（离所有参考都太远） | none（未匹配） |
| 与第二候选差距 < 0.06 | low（不确定） |
| 与第二候选差距 < 0.12 | medium（次选提示） |
| 其余 | high |

### 3.3 位置

只在判定出的**同一个元音**内部比较：

```text
position = (d男 − d女) / (d男 + d女)
```

−1 = 与男性参考均值重合，+1 = 与女性参考均值重合；卡片三档用 ±0.33。低置信 / 未匹配时**不显示位置条**，避免把一个不可靠的判定画成精确坐标。

### 3.4 局限

- 当前只覆盖 6 个普通话主元音（a / o / e[ɤ] / i / u / ü）；没有 er、没有双元音；
- 参考值是 2006 年青年播音专业学生的群体均值；不代表所有年龄 / 方言 / 个体；
- 仍是声学最近邻，不是音素识别；a/o、e/u 等相邻元音会明确标「不确定」或「次选」，不硬猜；
- LPC 在连续语音 / 气声 / 噪声下会偏移；录长音时保持 1–2 秒平稳、固定设备，比追求单次绝对值更有意义。

---

## 四、实现与测试

| 模块 | 职责 |
| --- | --- |
| `lib/voiceExpression.ts` | H95 24 点归一、逐帧 position、时长加权、音高 + 共鸣综合分 |
| `lib/mandarinVowels.ts` | 普通话 6 主元音参考值（Meng et al. 2006, Table 3） |
| `lib/vowelCheck.ts` | 稳定段提取、自动判定、置信度、同元音位置 |
| `components/analysis/VoiceExpressionCard.tsx` | 自由朗读参考分卡与「最近参考元音分布」明细 |
| `components/analysis/VowelCheckCard.tsx` | 长音元音检查卡（自动判定 / 不确定 / 未匹配） |

测试：

- `voiceExpression.test.ts`：H95 参考点、元音归一、同参考落点同分、音高锚点；
- `vowelCheck.test.ts`：六个普通话元音男女参考点、position、低置信候选、短样本、起音收音剔除、丢帧、无 F0、过远拒绝。

---

## 五、参考文献

- Hillenbrand, J., Getty, L. A., Clark, M. J. & Wheeler, K. (1995). *Acoustic characteristics of American English vowels*. JASA 97(5), 3099–3111.
- Meng, Z., Chen, Y. & Li, X. (2006). *Statistical Survey of Monophthong Formants in Mandarin for Students Being Trained as Broadcasters*. PACLIC 20, 280–286.
- Peterson, G. E. & Barney, H. L. (1952). *Control methods used in a study of the vowels*. JASA 24(2), 175–184.
- Doukhan, D. et al. (2023). *Voice Passing: a Non-Binary Voice Gender Prediction System for evaluating Transgender voice transition*. Interspeech 2023.

完整出处与各参考区间的用途见 `REFERENCES.md`；逐帧指标含义见 `PARAMETERS-GUIDE.md` 第十二节与元音检查小节。
