/**
 * 本地内核的根目录、原子写与命名规则。
 *
 * ── 为什么是「文件即真相」，而不是把 SQLite 放进 OneDrive ──
 *
 * 用户希望资料放在 OneDrive 共享文件夹里，多台机器能看到同一份。但 SQLite 是**单文件二进制 +
 * WAL 旁路文件 + 独占锁**：两台机器同时写就是必然的库损坏（OneDrive 还只按文件级合并，冲突时
 * 会生成 `xxx-副本.db`，两个库各写一半，谁也读不回完整数据）。
 *
 * 所以这里的存储形态是：
 *   · **正文**是一篇一篇的 Markdown（人可读、可 diff、可 Git、丢掉索引也不丢内容）；
 *   · **元数据**是每篇一个同名 .json（小文件，整份覆盖，冲突范围可控）；
 *   · **检索索引**不落盘 —— 分块与倒排都是确定性的，由正文现算，只放内存缓存。
 *
 * 这样 OneDrive 里同步的永远是「人能看懂、丢了可重建」的东西；索引坏了大不了重算，
 * 不会出现「库文件同步坏了，资料全没」这种不可恢复的结局。
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/** 元数据格式版本。改字段时升这个数，读取端会把旧格式当「未处理」重算。 */
export const SCHEMA_VERSION = 1;

/**
 * 新安装默认使用用户目录。用 SCHANORA_ROOT 指向已同步的共享目录。
 * 已有 OneDrive 数据根继续可用，避免升级后打开一个空库。
 */
export function defaultRoot() {
  if (process.env.SCHANORA_ROOT) return path.resolve(process.env.SCHANORA_ROOT);
  const oneDrive =
    process.env.OneDrive || process.env.OneDriveCommercial || process.env.OneDriveConsumer || '';
  if (oneDrive) {
    const previousRoot = path.join(oneDrive, 'Schanora');
    if (existsSync(path.join(previousRoot, 'schanora.json'))) return previousRoot;
  }
  return path.join(os.homedir(), 'Schanora');
}

export function resolveRoot(explicit) {
  return path.resolve(explicit || defaultRoot());
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** 读 JSON；文件不存在或内容损坏都返回 fallback —— 单篇元数据坏了不该让整库打不开。 */
export async function readJson(file, fallback = null) {
  try {
    const text = await fs.readFile(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (_e) {
    return fallback;
  }
}

/**
 * 原子写：先写同目录临时文件再 rename。
 *
 * 直接 writeFile 在同步盘上是「先截断再写」——写到一半 OneDrive 上传，或进程被杀，
 * 留下的是**半截文件**。rename 在同一分区是原子的，所以要么旧内容、要么新内容。
 */
export async function writeFileAtomic(file, data, encoding = 'utf8') {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  await fs.writeFile(tmp, data, encoding);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tmp, file);
        return;
      } catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

export function writeJsonAtomic(file, value) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 文件名安全化：保留中文（共享文件夹里人要看），只替换 Win/Mac 双方都炸的字符。
 * 前后端的「标题」和「磁盘文件名」是两件事 —— 标题存 json，文件名只是一把稳定的钥匙。
 */
export function slugify(name, max = 48) {
  const base = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const safe = base || 'untitled';
  return safe.length > max ? safe.slice(0, max) : safe;
}

export function shortId(prefix = '') {
  const stamp = Date.now().toString(36).slice(-6);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}${stamp}${rand}`;
}

export function hashText(text) {
  return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex').slice(0, 12);
}

export function nowIso() {
  return new Date().toISOString();
}

/** 目录布局。集中在这里，改名时只有一处要动。 */
export function layout(root) {
  const base = resolveRoot(root);
  return {
    root: base,
    config: path.join(base, 'schanora.json'),
    kbsDir: path.join(base, 'kbs'),
    clipsDir: path.join(base, 'clips'),
    jobsDir: path.join(base, 'jobs'),
    sessionsDir: path.join(base, 'sessions'),
    kbDir: (kbId) => path.join(base, 'kbs', kbId),
    kbMeta: (kbId) => path.join(base, 'kbs', kbId, 'kb.json'),
    docsDir: (kbId) => path.join(base, 'kbs', kbId, 'docs'),
    docPath: (kbId, fileBase) => path.join(base, 'kbs', kbId, 'docs', `${fileBase}.md`),
    docMeta: (kbId, fileBase) => path.join(base, 'kbs', kbId, 'docs', `${fileBase}.json`),
    clipPath: (clipId) => path.join(base, 'clips', `${clipId}.json`),
    jobPath: (jobId) => path.join(base, 'jobs', `${jobId}.json`),
    sessionPath: (sessionId) => path.join(base, 'sessions', `${sessionId}.json`),
  };
}
