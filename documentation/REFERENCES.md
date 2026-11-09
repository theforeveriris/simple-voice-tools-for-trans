# 参考文献

本项目的参数参考区间与算法实现所依据的公开文献与资料。按主题分组，
正文文档（参数说明书 / 算法文档）中的口径出处统一引用本页。

> 所有参考区间均为常见文献的近似值，**未经临床验证**，仅供自我追踪定向，
> 不构成医学诊断。个体差异很大，请以自身纵向趋势为准。

## 音高检测（YIN / pYIN / MPM）

| 文献 | 用于 |
| --- | --- |
| de Cheveigné, A. & Kawahara, H. (2002). *YIN, a fundamental frequency estimator for speech and music*. J. Acoust. Soc. Am. 111(4), 1917–1930. | YIN 差分函数、累积均值归一化（CMND）、阈值与抛物线插值（[ALGORITHM-YIN.md](ALGORITHM-YIN.md)） |
| Mauch, M. & Dixon, S. (2014). *pYIN: a fundamental frequency estimator using probabilistic threshold distributions*. ICASSP 2014. | pYIN 多阈值概率化投票（简化实现，[pitchAlt.ts](../src/lib/audio/pitchAlt.ts)） |
| McLeod, P. & Wyvill, G. (2005). *A smarter way to find pitch*. ICMC 2005. | MPM 归一化平方差函数（NSDF）与关键极大值选取（[pitchAlt.ts](../src/lib/audio/pitchAlt.ts)） |

## 共振峰提取（LPC）

| 文献 | 用于 |
| --- | --- |
| Markel, J. D. & Gray, A. H. (1976). *Linear Prediction of Speech*. Springer-Verlag. | LPC 全极点模型、Levinson-Durbin 递推（[ALGORITHM-FORMANT-LPC.md](ALGORITHM-FORMANT-LPC.md)） |
| Durand, L. (1860). 解决代数方程的 Durand-Kerner 方法（后由 Kerner 1950、Durand 1960 完善表述） | 多项式求根（F1/F2 由 LPC 根的共振条件解出） |
| Klatt, D. H. (1980). *Software for a cascade/parallel formant synthesizer*. J. Acoust. Soc. Am. 67(3). | 共振峰根筛选的频率/带宽合理性判据（工业惯例，本实现沿用） |

## 元音空间与共振峰参考位

| 文献 | 用于 |
| --- | --- |
| Peterson, G. E. & Barney, H. L. (1952). *Control methods used in a study of the vowels*. J. Acoust. Soc. Am. 24(2), 175–184. | i / a / u 参考元音 F1/F2 位置的原始依据（VOWEL_REFS，[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 第二节 2.5） |
| Hillenbrand, J., Getty, L. A., Clark, M. J. & Wheeler, K. (1995). *Acoustic characteristics of American English vowels*. J. Acoust. Soc. Am. 97(5), 3099–3111. doi:10.1121/1.411872 | 成人男女元音共振峰分布的性别差异（「i 是共鸣试金石」等论述）；本项目取其 12 个元音的男女共振峰分组均值（男 n=45、女 n=48，共 1668 个稳态样本）作为「声音性别表达参考分」的元音归一锚点（VOWEL_REFS_H95，[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 第十二节） |
| Meng, Z., Chen, Y. & Li, X. (2006). *Statistical Survey of Monophthong Formants in Mandarin for Students Being Trained as Broadcasters*. Proceedings of PACLIC 20, 280–286. ACL Anthology Y06-1037. | 普通话六个主元音（a / o / e[ɤ] / i / u / ü[y]）的男女 F1/F2 分组均值（212 女 + 126 男播音专业学生，Table 3）；「长音测试 → 元音检查」卡的参考值（MANDARIN_VOWELS） |

## 声音性别感知参考（VFP 风格）

| 文献 | 用于 |
| --- | --- |
| Doukhan, D., Devauchelle, S., Girard-Monneron, L., Chavez Ruz, M., Chaddouk, V., Wagner, I. & Rilliard, A. (2023). *Voice Passing: a Non-Binary Voice Gender Prediction System for evaluating Transgender voice transition*. Interspeech 2023, 5207–5211. doi:10.21437/Interspeech.2023-1835 | VFP（0–100 女性化感知分）与「50 ≈ 中性」的概念；F0+VTL 基线对顺性别 R²≈0.94、跨性别 R²≈0.53 的局限（[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 第十二节） |
| inaSpeechSegmenter（INA，MIT License，https://github.com/ina-foss/inaSpeechSegmenter） | 女声/男声 CNN 分类的公开基线；本项目只借用 VFP 概念与评分口径，不打包其模型权重 |
| American Speech-Language-Hearing Association. *Gender Affirming Voice and Communication* (Practice Portal). https://www.asha.org/practice-portal/professional-issues/gender-affirming-voice-and-communication/ | 感知阈值：SFF > 180 Hz 更易听成女声、< 130 Hz 更易听成男声、145–175 Hz 为中性带 |
| Oates, J. & Dacakis, G. (2015). *Transgender Voice and Communication: Research Evidence Underpinning Voice Intervention for Male-to-Female Transsexual Women*. Perspectives on Voice and Voice Disorders, 25(2), 48–58. doi:10.1044/vvd25.2.48 | 女性化目标约 180 Hz，并强调共振峰接近顺性别女性水平 |
| Wolfe, V. I., Ratusnik, D. L., Smith, F. H. & Northrop, G. (1990). *Intonation and fundamental frequency in male-to-female transsexuals*. J. Speech Hear. Disord. 55(1), 43–50. doi:10.1044/jshd.5501.43 | 被听成女声的 F0 约 155.6–195 Hz（均值 172）、被听成男声约 97.2–145 Hz（均值 118）；评分中心 165 Hz 的依据之一 |
| Gelfer, M. P. & Schofield, K. J. (2000). *Comparison of acoustic and perceptual measures of voice in male-to-female transsexuals perceived as female versus those perceived as male*. J. Voice, 14(4), 562–573. doi:10.1016/S0892-1997(00)80092-2 | 女声感知组的 F0 下限约 164 Hz；与 Wolfe 的分界相互印证 |
| Gelfer, M. P. & Mikos, V. A. (2005). *The relative contributions of speaking fundamental frequency and formant frequencies to gender identification based on isolated vowels*. J. Voice, 19(4), 544–554. doi:10.1016/j.jvoice.2004.10.006 | F0 是性别听感的主导线索（即使与共振峰矛盾时），支撑音高 55% / 共鸣 45% 的权重；顺男/顺女平均 F0 约 100–146 / 188–221 Hz |
| Irwig, M. S., Childs, K. & Hancock, A. B. (2017). *Effects of testosterone on the transgender male voice*. Andrology, 5(1), 107–112. doi:10.1111/andr.12278 | 男性化参考：跨男睾酮治疗 12 个月后阅读 MF0 约 87–128 Hz；顺男约 100–130 Hz |

## 嗓音质量（Jitter / Shimmer / HNR / CPPS）

| 文献 | 用于 |
| --- | --- |
| Baken, R. J. & Orlikoff, R. F. (2000). *Clinical Measurement of Speech and Voice* (2nd ed.). Singular. | Jitter / Shimmer 的经典定义与健康成人参考区间（<1% / >20 dB 量级，[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 第四节） |
| Titze, I. R. (1994). *Principles of Voice Production*. Prentice Hall. | 基频微扰与声带振动质量的生理关联 |
| Hillenbrand, J., Cleveland, R. A. & Erickson, R. L. (1994). *Acoustic correlates of breathy vocal quality*. J. Speech Hear. Res. 37(4), 769–778. | CPP/CPPS 的经典口径（本实现逐帧 CPP 的窗长与 quefrency 搜索范围，[ALGORITHM-CPPS.md](ALGORITHM-CPPS.md)） |
| Heman-Ackah, Y. D. et al. (2003). *Cepstral peak prominence: a more reliable approach than voice quality index*. Laryngoscope 113. | CPPS 相对 J/S 在连续语音中的稳健性论述 |

## 谐波频谱与咝音

| 文献 | 用于 |
| --- | --- |
| Hanson, H. M. (1997). *Glottal characteristics of female speakers: Acoustic correlates*. J. Acoust. Soc. Am. 101(1), 466–481. | H1–H2 / H1–A3 的谐波差口径与气声解释（[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 4.6） |
| Chen, M. Y. (1997). *Acoustic correlates of English and French nasalized vowels*. J. Acoust. Soc. Am. 102(4), 2360–2370. | A1–P1 鼻化度口径（鼻腔峰 300–1000Hz，[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 4.6） |
| Schwartz, M. F. (1968). *Identification of speaker sex from isolated, voiceless fricatives*. J. Acoust. Soc. Am. 43(6), 1178–1179. | /s/ 等清摩擦音的频谱重心与说话人性别感知（[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) 第十三节） |

## 能量与发声检测（VAD）

| 文献 | 用于 |
| --- | --- |
| Sangwan, A. et al. (2002). *Analysis of energy-based fast computation of energy thresholds for voice activity detection*. | 多门限（绝对门限 + 活动门限）分级 VAD 的通行做法（[ALGORITHM-ENERGY.md](ALGORITHM-ENERGY.md)） |

## 音域图（VRP / phonetogram）

| 文献 | 用于 |
| --- | --- |
| Schutte, H. K. & Seidner, W. (1983). *Recommendation by the Union of European Phoniatricians (UEP): standardizing voice area measurement/phonetography*. Folia Phoniatr. 35, 286–288. | 半音 × 响度矩阵的 phonetogram 惯例（VRP 视图布局，[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md) VRP 节） |

## 其他实现参考

| 资料 | 用于 |
| --- | --- |
| Praat（Boersma & Weenink, University of Amsterdam） | PitchTier / Formant 互操作文件的格式与跨验证口径（[export/praat.ts](../src/lib/export/praat.ts)） |
| MDN Web Audio API 文档 | AnalyserNode / AudioContext 行为基准 |

---

*维护约定：正文文档新引用文献时，先在本页登记（按主题分组），正文处只写
「见 REFERENCES.md · 分组」或简短作者-年份，不粘贴完整条目。*
