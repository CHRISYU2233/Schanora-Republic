import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

const FORMAT = 'schanora-files-v1';
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const DATA_NAMES = ['schanora.json', 'kbs', 'sessions', 'clips', 'jobs'];
const checksum = (content) => createHash('sha256').update(content, 'utf8').digest('hex');

function isDataPath(name) {
  if (typeof name !== 'string' || name.length > 512) return false;
  const segments = name.split('/');
  if (segments.some((s) => !s || /[\\<>:"|?*\u0000-\u001f]|[. ]$/.test(s) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) return false;
  if (name === 'schanora.json') return true;
  if (['sessions', 'clips', 'jobs'].includes(segments[0])) {
    return segments.length === 2 && name.endsWith('.json');
  }
  return segments[0] === 'kbs' && (
    (segments.length === 3 && segments[2] === 'kb.json') ||
    (segments.length === 4 && segments[2] === 'docs' && /\.(md|json)$/.test(name))
  );
}

export async function createBackup(root) {
  const files = [];
  let size = 0;

  async function collect(relative) {
    const location = path.join(root, relative);
    const stat = await fs.lstat(location).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error(`备份发现符号链接：${relative}`);
    if (stat.isDirectory()) {
      const depth = relative.split('/').length;
      if (depth === 1 || (relative.startsWith('kbs/') &&
        (depth === 2 || (depth === 3 && relative.endsWith('/docs'))))) {
        for (const child of (await fs.readdir(location)).sort()) await collect(`${relative}/${child}`);
      }
      return;
    }
    if (!stat.isFile() || !isDataPath(relative)) return;
    size += stat.size;
    if (size > MAX_BACKUP_BYTES) throw new Error('资料超过 64 MB，请在停止写入后备份整个数据目录。');
    const content = await fs.readFile(location, 'utf8');
    files.push({ path: relative, content, sha256: checksum(content) });
  }
  for (const name of DATA_NAMES) await collect(name);
  if (!files.some((file) => file.path === 'schanora.json')) {
    throw new Error('未找到知识库清单。请先创建一个知识库再备份。');
  }
  const backup = { format: FORMAT, createdAt: new Date().toISOString(), files };
  validateBackup(backup);
  return backup;
}

export function validateBackup(backup) {
  if (backup?.format !== FORMAT || !Array.isArray(backup.files)) throw new Error('备份格式不受支持。');
  let size = 0;
  const names = new Set();
  for (const file of backup.files) {
    if (!isDataPath(file?.path) || typeof file.content !== 'string') throw new Error('备份包含无效文件。');
    const key = file.path.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('备份包含重复文件。');
    names.add(key);
    size += Buffer.byteLength(file.content);
    if (size > MAX_BACKUP_BYTES) throw new Error('备份超过 64 MB。');
    if (checksum(file.content) !== file.sha256) throw new Error(`备份校验失败：${file.path}`);
    if (file.path.endsWith('.json')) {
      const parsed = JSON.parse(file.content);
      if (file.path === 'schanora.json' && (!parsed || !Array.isArray(parsed.kbs))) {
        throw new Error('备份里的知识库清单无效。');
      }
      if (file.path === 'schanora.json' && parsed.kbs.some((kb) => !/^[\w-]{1,128}$/.test(kb?.id ?? ''))) {
        throw new Error('备份里的知识库编号无效。');
      }
    }
  }
  if (!names.has('schanora.json')) throw new Error('备份缺少知识库清单。');
}

export async function restoreBackup(backup, destination) {
  validateBackup(backup);
  const target = path.resolve(destination);
  await fs.mkdir(target);
  const incomplete = path.join(target, '.schanora-restore-incomplete');
  await fs.writeFile(incomplete, '', { flag: 'wx' });
  for (const file of backup.files) {
    const dest = path.join(target, ...file.path.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.content, { encoding: 'utf8', flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY });
  }
  await fs.unlink(incomplete);
  return target;
}
