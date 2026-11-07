/**
 * 导出模板仓库（localStorage，数量级是个位数）
 * 与主题包 / Lua 脚本并列的零后端 UGC 之一；存 localStorage 而非 IDB——
 * 模板体积小、便于整体备份。注意：设置导出/导入只处理 AppSettings，
 * **不包含**这个键；换设备时需用模板文件（.svt-template）单独导入。
 */

import { parseTemplateFile, type ExportTemplate } from '@/lib/export/template';

const LS_KEY = 'svt.exportTemplates';

const memoryStore = new Map<string, unknown>();
let lsBroken = false;

function lsGet(): ExportTemplate[] {
  if (lsBroken) return (memoryStore.get(LS_KEY) as ExportTemplate[]) ?? [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    // 存储被外部改坏（不是数组）时不能让 .filter 抛错，退回空列表
    return Array.isArray(parsed) ? (parsed as ExportTemplate[]) : [];
  } catch {
    lsBroken = true;
    return (memoryStore.get(LS_KEY) as ExportTemplate[]) ?? [];
  }
}

function lsPut(list: ExportTemplate[]): void {
  memoryStore.set(LS_KEY, list);
  if (lsBroken) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    lsBroken = true;
  }
}

export function listTemplates(): ExportTemplate[] {
  return lsGet();
}

export function putTemplate(tpl: ExportTemplate): void {
  const list = lsGet().filter((x) => x.name !== tpl.name);
  list.push({ ...tpl, name: tpl.name.trim() || 'template' });
  lsPut(list);
}

export function deleteTemplate(name: string): void {
  lsPut(lsGet().filter((x) => x.name !== name));
}

/** 导入 .svt-template 文件内容；成功返回模板，无效返回 null */
export function importTemplate(raw: string): ExportTemplate | null {
  const tpl = parseTemplateFile(raw);
  if (!tpl) return null;
  putTemplate(tpl);
  return tpl;
}
