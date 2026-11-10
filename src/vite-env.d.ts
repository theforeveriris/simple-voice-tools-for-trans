/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时由 vite define 注入（vite.config.ts 读取 package.json） */
declare const __APP_VERSION__: string;
/** 构建日期（ISO，取自构建时刻） */
declare const __BUILD_DATE__: string;
/** 构建时间戳（毫秒，与产物 version.json 的 builtAt 同源同值；检查更新比对用） */
declare const __BUILD_AT__: number;
/** 当前版本的更新内容（release-notes/<version>.json 的 notes，构建时注入） */
declare const __APP_VERSION_NOTES__: Record<string, string>;
