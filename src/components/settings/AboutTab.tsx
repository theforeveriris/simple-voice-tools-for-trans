/**
 * 关于（设置主视图的「关于」标签页）
 * - 开发者与贡献者：置顶，头像点击跳转其 GitHub 主页
 * - 应用简介：版本与隐私说明（免责声明在进入本页时自动弹窗）
 * - 文档：使用说明（参数说明书）+ 开发者文档（算法与架构，GitHub 源文件链接）
 */

import { useState } from 'react';
import { BookOpen, ChevronRight, HeartHandshake, Info, Code2, GraduationCap, ShieldCheck, MessageSquareWarning } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { DocSheet } from './DocSheet';
import { FeedbackDialog } from './FeedbackDialog';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  DEV_DOCS, PUBLIC_DOCS, USER_DOCS, docGithubUrl, loadDoc, loadPublicDoc, type DocEntry,
} from '@/lib/docs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { SettingsSection } from './rows';

/** 可在应用内打开的文档（documentation/ 懒加载 或 public/ fetch） */
interface OpenDoc {
  /** 稳定标识（来源 + 文件名），用作 DocSheet key 与 loader 记忆 */
  key: string;
  /** 标题词条（渲染时翻译，跟随界面语言切换） */
  titleKey: DictKey;
  load: () => Promise<string>;
  githubUrl?: string;
}

function entryToDoc(e: DocEntry): OpenDoc {
  return {
    key: `repo:${e.file}`,
    titleKey: e.titleKey,
    load: () => loadDoc(e.file),
    githubUrl: docGithubUrl(e.file),
  };
}

const USER_OPEN_DOCS: OpenDoc[] = USER_DOCS.map(entryToDoc);
const DEV_OPEN_DOCS: OpenDoc[] = DEV_DOCS.map(entryToDoc);

const GUIDE_DOC: OpenDoc = {
  key: `public:${PUBLIC_DOCS.guide.file}`,
  titleKey: PUBLIC_DOCS.guide.titleKey,
  load: () => loadPublicDoc(PUBLIC_DOCS.guide.file),
};

const PRIVACY_DOC: OpenDoc = {
  key: `public:${PUBLIC_DOCS.privacy.file}`,
  titleKey: PUBLIC_DOCS.privacy.titleKey,
  load: () => loadPublicDoc(PUBLIC_DOCS.privacy.file),
};

/** 文档列表：点击即在应用内打开（源文件入口移进查看器顶栏） */
function DocList({ docs, onOpen }: { docs: OpenDoc[]; onOpen: (doc: OpenDoc) => void }) {
  return (
    <>
      {docs.map((doc) => (
        <button
          key={doc.key}
          onClick={() => onOpen(doc)}
          className="flex w-full items-center justify-between gap-2 border-t border-black/[0.04] py-3 text-left text-sm font-medium text-ink transition-colors first:border-t-0 hover:text-accent"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen size={14} className="shrink-0 text-accent" />
            <span className="truncate">{t(doc.titleKey)}</span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink-2" />
        </button>
      ))}
    </>
  );
}

/** 开发者与贡献者名单（头像取 GitHub，点击跳转其主页；新贡献者追加到对应数组即可） */
const DEVELOPERS = [{ name: '鸢尾 theforeveriris', handle: 'theforeveriris' }];
const CONTRIBUTORS = [{ name: 'HuLunTunTao', handle: 'HuLunTunTao' }];

function PersonRow({ person, roleKey }: { person: { name: string; handle: string }; roleKey: 'role.developer' | 'role.contributor' }) {
  return (
    <a
      href={`https://github.com/${person.handle}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 border-t border-black/[0.04] py-2.5 first:border-t-0"
    >
      <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft">
        <span className="text-sm font-semibold text-on-accent-soft" aria-hidden>{person.name[0]}</span>
        <img
          src={`https://github.com/${person.handle}.png?size=80`}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{person.name}</span>
        <span className="block text-[11px] text-ink-2">{t(roleKey)}</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-ink-2" />
    </a>
  );
}

export function AboutTab() {
  useI18n();
  // 免责声明：每次进入关于标签页自动弹出（本组件随标签切换挂载/卸载）
  const [disclaimerOpen, setDisclaimerOpen] = useState(true);
  // 应用内文档查看器（使用说明 / 参数说明 / 开发文档 / 隐私政策）
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  // 问题反馈弹窗
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3.5">
      {/* 免责声明弹窗 */}
      <Dialog open={disclaimerOpen} onOpenChange={setDisclaimerOpen}>
        <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-ink">{t('settings.disclaimerTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-ink-2">{t('settings.aboutDisclaimer')}</p>
          <button
            onClick={() => setDisclaimerOpen(false)}
            className="mt-1 w-full rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            {t('common.ok')}
          </button>
        </DialogContent>
      </Dialog>

      {/* 开发者与贡献者（置顶） */}
      <SettingsSection icon={HeartHandshake} title={t('settings.developers')}>
        {DEVELOPERS.map((p) => <PersonRow key={p.handle} person={p} roleKey="role.developer" />)}
        {CONTRIBUTORS.map((p) => <PersonRow key={p.handle} person={p} roleKey="role.contributor" />)}
      </SettingsSection>

      {/* 应用简介 */}
      <SettingsSection icon={Info} title={t('settings.intro')}>
        <div className="pt-1 text-xs leading-relaxed text-ink-2">
          <p className="text-sm font-semibold text-ink">Simple Voice Tool for Trans</p>
          <p className="mt-1">{t('settings.aboutVersion')}</p>
          <p className="mt-1">{t('settings.aboutPrivacy')}</p>
          {/* 隐私政策全文：应用内可读（public/privacy-policy.md） */}
          <button
            onClick={() => setOpenDoc(PRIVACY_DOC)}
            className="mt-2 inline-flex items-center gap-1 font-medium text-accent transition-opacity hover:opacity-70"
          >
            <ShieldCheck size={13} />
            {t('settings.privacyPolicy')}
          </button>
          {/* 问题反馈：自动收集非敏感诊断，预览确认后才离开设备 */}
          <button
            onClick={() => setFeedbackOpen(true)}
            className="mt-1.5 flex items-center gap-1 font-medium text-accent transition-opacity hover:opacity-70"
          >
            <MessageSquareWarning size={13} />
            {t('settings.feedback')}
          </button>
        </div>
      </SettingsSection>

      {/* 文档：使用说明 + 参数说明 + 开发者文档，全部应用内可读（懒加载，离线可用） */}
      <SettingsSection icon={GraduationCap} title={t('settings.userDocs')}>
        <button
          onClick={() => setOpenDoc(GUIDE_DOC)}
          className="flex w-full items-center justify-between gap-2 py-3 text-left first:border-t-0"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen size={14} className="shrink-0 text-accent" />
            <span className="truncate">
              {t('settings.guideTitle')}
              <span className="ml-2 text-[11px] font-normal text-ink-2">{t('settings.guideDesc')}</span>
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink-2" />
        </button>
        <DocList docs={USER_OPEN_DOCS} onOpen={setOpenDoc} />
      </SettingsSection>
      <SettingsSection icon={Code2} title={t('settings.devDocs')}>
        <DocList docs={DEV_OPEN_DOCS} onOpen={setOpenDoc} />
      </SettingsSection>

      {/* 应用内文档查看器（AnimatePresence 让关闭时的退出淡出真正播放） */}
      <AnimatePresence>
        {openDoc && (
          <DocSheet
            key={openDoc.key}
            title={t(openDoc.titleKey)}
            load={openDoc.load}
            githubUrl={openDoc.githubUrl}
            onClose={() => setOpenDoc(null)}
          />
        )}
      </AnimatePresence>

      {/* 问题反馈弹窗 */}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
