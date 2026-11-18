import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBackup, restoreBackup, validateBackup, MAX_BACKUP_BYTES } from '../plugins/schanora/client/src/server/backup.js';

const [command, first, second] = process.argv.slice(2);
try {
  if (command === 'export' && first && second) {
    const backup = await createBackup(path.resolve(first));
    await fs.writeFile(path.resolve(second), JSON.stringify(backup), { encoding: 'utf8', flag: 'wx' });
    console.log(`已备份 ${backup.files.length} 个文件。`);
  } else if ((command === 'verify' || (command === 'restore' && second)) && first) {
    const source = path.resolve(first);
    if ((await fs.stat(source)).size > MAX_BACKUP_BYTES * 7) throw new Error('备份文件过大。');
    const backup = JSON.parse(await fs.readFile(source, 'utf8'));
    validateBackup(backup);
    if (command === 'restore') {
      const target = await restoreBackup(backup, second);
      console.log(`已校验并恢复 ${backup.files.length} 个文件到 ${target}。`);
    } else {
      console.log(`已校验 ${backup.files.length} 个文件。`);
    }
  } else {
    throw new Error('用法：node scripts/backup-local.mjs export <数据目录> <新备份文件> | verify <备份文件> | restore <备份文件> <新目录>');
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? '目标已存在，请使用新文件名或新目录。' : error.message);
  process.exitCode = 1;
}
