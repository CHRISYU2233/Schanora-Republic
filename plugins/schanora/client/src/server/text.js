/**
 * 文本侧：类型识别、抽取、分块、分词。
 *
 * 这里不引任何第三方库（插件包必须零依赖），也不调外部解析服务 —— 所有解析都在本机进程内完成。
 * 能力边界写在 extractText 的返回值里（note 字段），界面上如实显示，不假装解析成功。
 */
import zlib from 'node:zlib';

const TEXT_EXT = new Set([
  'md', 'markdown', 'mdx', 'txt', 'log', 'csv', 'tsv', 'json', 'jsonl',
  'yaml', 'yml', 'html', 'htm', 'xml', 'ini', 'conf', 'sql', 'js', 'ts', 'py',
]);

export function detectType(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 这些类型本机可以真正抽出文字；其余如实报「不支持」，不硬塞乱码进索引。 */
export function isSupported(fileName) {
  const ext = detectType(fileName);
  return TEXT_EXT.has(ext) || ext === 'docx' || ext === 'pdf';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 极简 HTML 去标签：丢掉 script/style，块级标签转换行，其余剥掉。够读文档，不做 DOM 解析。 */
function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n'),
  );
}

/** .docx 是 zip；只取 word/document.xml，按段落抽 <w:t>。不处理表格结构，但文字不丢。 */
function docxToText(buffer) {
  const entry = readZipEntry(buffer, 'word/document.xml');
  if (!entry) throw new Error('docx 里找不到 word/document.xml');
  const xml = entry.toString('utf8');
  const paragraphs = xml.split(/<\/w:p>/);
  const lines = paragraphs.map((p) => {
    const texts = [];
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = re.exec(p))) texts.push(decodeEntities(m[1]));
    if (!texts.length && /<w:tab\/>/.test(p)) return '';
    return texts.join('');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 最小 zip 读取：只支持 stored / deflate，够读 docx（Office 用的就是这两种）。
 * 不做 zip64、不处理加密。
 */
function readZipEntry(buffer, wantedName) {
  const MIN_EOCD = 22;
  let eocd = -1;
  for (let i = buffer.length - MIN_EOCD; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 10);
  let off = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (off + 46 > buffer.length || buffer.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(off + 10);
    const compSize = buffer.readUInt32LE(off + 20);
    const nameLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    const localOff = buffer.readUInt32LE(off + 42);
    const name = buffer.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    if (name === wantedName) {
      const lNameLen = buffer.readUInt16LE(localOff + 26);
      const lExtraLen = buffer.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buffer.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      return null;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/**
 * PDF 文字抽取（尽力而为）。
 *
 * 只做一件事：把每个 FlateDecode 内容流解开，抓 Tj / TJ 里的字符串。对「打印型」PDF 有效；
 * 扫描件（图片）、带 CID 自定义编码的中文 PDF 抽不出来 —— 那需要字体映射表和 OCR，不是一个
 * 零依赖插件能扛的。抽不出文字时上层会把文档标为 failed 并说明原因，不往索引里塞垃圾。
 */
function pdfToText(buffer) {
  const latin = buffer.toString('latin1');
  const chunks = [];
  let cursor = 0;
  let streams = 0;
  while (cursor < latin.length) {
    const s = latin.indexOf('stream', cursor);
    if (s < 0) break;
    const e = latin.indexOf('endstream', s);
    if (e < 0) break;
    let start = s + 'stream'.length;
    if (latin[start] === '\r') start++;
    if (latin[start] === '\n') start++;
    const raw = buffer.subarray(start, e);
    streams++;
    let text = '';
    try {
      const inflated = zlib.inflateSync(raw);
      text = extractPdfOps(inflated.toString('latin1'));
    } catch (_e) {
      // 未压缩的内容流（少见但合法）
      text = extractPdfOps(raw.toString('latin1'));
    }
    if (text.trim()) chunks.push(text);
    cursor = e + 'endstream'.length;
  }
  return { text: chunks.join('\n'), streams };
}

function extractPdfOps(content) {
  const out = [];
  // ( ... ) 字符串，后面跟 Tj / TJ / ' / "
  const re = /\((?:\\.|[^\\()])*\)\s*(?:Tj|TJ|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|TJ)/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1]) {
      // 十六进制串：按 2 位一字节解，遇到 0 截断（PDF 常见双字节编码）
      const bytes = m[1].replace(/\s+/g, '');
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = parseInt(bytes.slice(i, i + 2), 16);
        if (code) s += String.fromCharCode(code);
      }
      if (s) out.push(s);
      continue;
    }
    const lit = m[0].slice(1, m[0].lastIndexOf(')'));
    out.push(
      lit
        .replace(/\\([nrtbf])/g, (_x, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' })[c] || '')
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\(\d{1,3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8))),
    );
  }
  return out.join(' ');
}

/**
 * 统一抽取入口。
 * @returns {{text: string, format: string, note: string}}
 */
export function extractText(buffer, fileName) {
  const ext = detectType(fileName);
  if (TEXT_EXT.has(ext)) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (ext === 'html' || ext === 'htm' || ext === 'xml') {
      return { text: htmlToText(text), format: ext, note: '' };
    }
    if (ext === 'json' || ext === 'jsonl') {
      // JSON 直接当纯文本会挤成一行，展平成「键: 值」更利于检索
      try {
        const flat = flattenJson(JSON.parse(text));
        return { text: flat, format: ext, note: '' };
      } catch (_e) {
        return { text, format: ext, note: 'JSON 解析失败，按纯文本索引' };
      }
    }
    return { text, format: ext, note: '' };
  }
  if (ext === 'docx') return { text: docxToText(buffer), format: 'docx', note: '' };
  if (ext === 'pdf') {
    const { text, streams } = pdfToText(buffer);
    if (!text.trim()) {
      throw new Error(
        `PDF 里没有抽到可索引文字（扫描件或自定义编码字体；已扫描 ${streams} 个内容流）`,
      );
    }
    return {
      text,
      format: 'pdf',
      note: text.length < 200 ? 'PDF 抽取到的文字很少，可能是扫描件，检索可能不全' : '',
    };
  }
  throw new Error(`本地内核不支持 .${ext || '?'} 类型（支持 md/txt/csv/json/html/docx/pdf）`);
}

function flattenJson(value, prefix = '', depth = 0) {
  if (depth > 6) return '';
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${prefix}: ${value}\n`;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => flattenJson(v, `${prefix}[${i}]`, depth + 1)).join('');
  }
  return Object.entries(value)
    .map(([k, v]) => flattenJson(v, prefix ? `${prefix}.${k}` : k, depth + 1))
    .join('');
}

/**
 * 确定性分块：先按标题切段，再按段落累加到 maxChars，跨段时带 overlap 回看。
 *
 * 为什么要确定性：分块结果不落盘（见 paths.js 的说明），换机器、换进程都要能算出**同一份**
 * 分块，否则引用编号和 startAt/endAt 会漂。所以这里只用内容本身做判断，不看时间、不看随机。
 */
export function chunkText(text, options = {}) {
  const maxChars = options.maxChars || 700;
  const overlap = options.overlap == null ? 110 : options.overlap;
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];

  // 切段：标题行单独成段，空行分段
  const blocks = [];
  let heading = '';
  for (const raw of source.split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const h = /^(#{1,6})\s+(.+)$/.exec(block);
    if (h && block.length < 120) {
      heading = h[2].trim();
      blocks.push({ text: block, heading });
      continue;
    }
    blocks.push({ text: block, heading });
  }

  const chunks = [];
  let buf = '';
  let bufHeading = '';
  let cursor = 0;
  const push = () => {
    const content = buf.trim();
    if (!content) return;
    const startAt = source.indexOf(content.slice(0, 40), Math.max(0, cursor - content.length));
    chunks.push({
      index: chunks.length,
      content,
      heading: bufHeading,
      startAt: startAt >= 0 ? startAt : Math.max(0, cursor - content.length),
      endAt: (startAt >= 0 ? startAt : Math.max(0, cursor - content.length)) + content.length,
    });
  };

  for (const block of blocks) {
    const piece = block.text;
    if (piece.length >= maxChars) {
      // 超长段：按 maxChars 硬切，切点尽量落在句末
      push();
      buf = '';
      let i = 0;
      while (i < piece.length) {
        let end = Math.min(piece.length, i + maxChars);
        if (end < piece.length) {
          const window = piece.slice(i, end);
          const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
          if (cut > maxChars * 0.5) end = i + cut + 1;
        }
        const seg = piece.slice(i, end);
        chunks.push({
          index: chunks.length,
          content: seg.trim(),
          heading: block.heading,
          startAt: cursor + i,
          endAt: cursor + end,
        });
        i = end - Math.min(overlap, Math.floor(maxChars / 4));
        if (end >= piece.length) break;
        if (i <= 0) break;
      }
      cursor += piece.length + 2;
      continue;
    }
    if (buf.length + piece.length + 2 > maxChars) {
      push();
      // overlap：上一块的尾巴带进下一块，避免答案被切断
      buf = overlap > 0 ? `${buf.slice(-overlap)}\n\n` : '';
      bufHeading = '';
    }
    if (!bufHeading && block.heading) bufHeading = block.heading;
    buf += `${piece}\n\n`;
    cursor += piece.length + 2;
  }
  push();
  return chunks.filter((c) => c.content.length > 0);
}

/** 检索用分词：中文取 2-gram（中文单字区分度太低），西文取小写词干近似。 */
export function tokenize(text) {
  const out = [];
  const s = String(text || '');
  const cjk = s.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  const latin = s.toLowerCase().match(/[a-z0-9][a-z0-9_./+-]*/g) || [];
  for (const word of latin) {
    if (word.length < 2) continue;
    if (STOP.has(word)) continue;
    out.push(word);
  }
  return out;
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has',
  'not', 'but', 'you', 'all', 'any', 'can', 'will', 'shall', 'may', 'per', 'into', 'than',
  'then', 'when', 'which', 'there', 'their', 'its', 'his', 'her', 'our', 'theirs',
]);

/** 摘要：取前 N 个字符，压掉换行与多余空白，用于列表预览。 */
export function summarize(text, size = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > size ? `${clean.slice(0, size)}…` : clean;
}
