/**
 * 普通话主元音参考（F1 / F2，Hz）
 *
 * 来源：Meng, Z., Chen, Y. & Li, X. (2006). Statistical Survey of Monophthong
 * Formants in Mandarin for Students Being Trained as Broadcasters.
 * Proceedings of PACLIC 20, 280–286. ACL Anthology Y06-1037.
 * 212 名女 + 126 名男播音专业学生，LPC 测量；这里取论文 Table 3 的六个主元音
 * （a / o / e[ɤ] / i / u / ü[y]）男女分组均值。
 *
 * 用途：长音测试录完后，从稳态段自动判断最接近哪个普通话主元音，
 * 再与该元音的同性别参考均值比较；不需要用户预先选择。
 * 参考值是青年播音专业学生的群体均值，用于个人趋势与参考，不构成诊断。
 */

export type MandarinVowel = 'a' | 'o' | 'e' | 'i' | 'u' | 'yu';

export interface MandarinVowelRef {
  code: MandarinVowel;
  /** IPA / 拼音显示符号 */
  label: string;
  /** 中文提示音节 */
  zh: string;
  male: { f1: number; f2: number };
  female: { f1: number; f2: number };
}

export const MANDARIN_VOWELS: MandarinVowelRef[] = [
  { code: 'a', label: 'a', zh: '啊', male: { f1: 795, f2: 1168 }, female: { f1: 952, f2: 1371 } },
  { code: 'o', label: 'o', zh: '哦', male: { f1: 532, f2: 817 }, female: { f1: 654, f2: 947 } },
  { code: 'e', label: 'e', zh: '呃', male: { f1: 501, f2: 1163 }, female: { f1: 622, f2: 1334 } },
  { code: 'i', label: 'i', zh: '衣', male: { f1: 279, f2: 2240 }, female: { f1: 311, f2: 2871 } },
  { code: 'u', label: 'u', zh: '乌', male: { f1: 342, f2: 701 }, female: { f1: 354, f2: 762 } },
  { code: 'yu', label: 'ü', zh: '迂', male: { f1: 280, f2: 1992 }, female: { f1: 305, f2: 2411 } },
];

const BY_CODE = new Map(MANDARIN_VOWELS.map((v) => [v.code, v]));

export function mandarinVowelRef(code: MandarinVowel): MandarinVowelRef {
  return BY_CODE.get(code) ?? MANDARIN_VOWELS[0];
}

