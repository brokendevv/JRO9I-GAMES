import zlib from 'node:zlib';
import type { GameFile } from './types.ts';
import {
  ALLOWED_GAME_EXTENSIONS,
  getFileExtension,
  MAX_FILE_COUNT,
  MAX_GAME_BUNDLE_BYTES,
  MAX_SINGLE_FILE_BYTES,
  normalizeRelativePath,
} from './validator.ts';

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.glsl',
  '.vert',
  '.frag',
  '.txt',
  '.md',
]);

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Creates a standard PKZIP buffer from a list of GameFiles (useful for export and deterministic unit tests).
 */
export function createZipArchive(files: GameFile[]): Buffer {
  const localFileHeaders: Buffer[] = [];
  const centralDirectoryHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path.replace(/\\/g, '/'), 'utf-8');
    const rawData =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf-8');
    const compressedData = zlib.deflateRawSync(rawData);
    const fileCrc = crc32(rawData);

    // Local file header (30 bytes + filename)
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(8, 8); // compression method: deflate (8)
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(fileCrc, 14); // crc32
    lfh.writeUInt32LE(compressedData.length, 18); // compressed size
    lfh.writeUInt32LE(rawData.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(lfh, 30);

    localFileHeaders.push(lfh, compressedData);

    // Central directory file header (46 bytes + filename)
    const cdfh = Buffer.alloc(46 + nameBuf.length);
    cdfh.writeUInt32LE(0x02014b50, 0); // signature
    cdfh.writeUInt16LE(20, 4); // version made by
    cdfh.writeUInt16LE(20, 6); // version needed
    cdfh.writeUInt16LE(0, 8); // flags
    cdfh.writeUInt16LE(8, 10); // compression: deflate
    cdfh.writeUInt16LE(0, 12); // mod time
    cdfh.writeUInt16LE(0, 14); // mod date
    cdfh.writeUInt32LE(fileCrc, 16); // crc32
    cdfh.writeUInt32LE(compressedData.length, 20); // compressed size
    cdfh.writeUInt32LE(rawData.length, 24); // uncompressed size
    cdfh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdfh.writeUInt16LE(0, 30); // extra length
    cdfh.writeUInt16LE(0, 32); // comment length
    cdfh.writeUInt16LE(0, 34); // disk number
    cdfh.writeUInt16LE(0, 36); // internal attrs
    cdfh.writeUInt32LE(0, 38); // external attrs
    cdfh.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(cdfh, 46);

    centralDirectoryHeaders.push(cdfh);
    offset += lfh.length + compressedData.length;
  }

  const cdBuffer = Buffer.concat(centralDirectoryHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdBuffer.length, 12); // size of CD
  eocd.writeUInt32LE(offset, 16); // offset of CD
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localFileHeaders, cdBuffer, eocd]);
}

export interface ZipExtractionResult {
  success: boolean;
  files: GameFile[];
  errors: string[];
  totalUncompressedBytes: number;
}

/**
 * Safely parses and extracts a ZIP archive in memory with strict Zip-Bomb,
 * path-traversal, file-count, and extension checks.
 */
export function extractAndValidateZip(zipBuffer: Buffer): ZipExtractionResult {
  const errors: string[] = [];
  const extractedFiles: GameFile[] = [];
  let totalUncompressedBytes = 0;

  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    return {
      success: false,
      files: [],
      errors: ['Uploaded file is not a valid ZIP archive (buffer too small).'],
      totalUncompressedBytes: 0,
    };
  }

  if (zipBuffer.length > MAX_GAME_BUNDLE_BYTES) {
    return {
      success: false,
      files: [],
      errors: [`ZIP archive size (${zipBuffer.length} bytes) exceeds 25 MB limit.`],
      totalUncompressedBytes: 0,
    };
  }

  // Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minEocdOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return {
      success: false,
      files: [],
      errors: ['Invalid ZIP archive: End of Central Directory signature not found.'],
      totalUncompressedBytes: 0,
    };
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > MAX_FILE_COUNT) {
    return {
      success: false,
      files: [],
      errors: [`ZIP archive contains too many entries (${totalEntries} > ${MAX_FILE_COUNT}).`],
      totalUncompressedBytes: 0,
    };
  }

  if (cdOffset + cdSize > zipBuffer.length) {
    return {
      success: false,
      files: [],
      errors: ['Corrupted ZIP archive: Central Directory extends past end of file.'],
      totalUncompressedBytes: 0,
    };
  }

  const rawEntries: Array<{
    rawName: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
  }> = [];

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > zipBuffer.length || zipBuffer.readUInt32LE(ptr) !== 0x02014b50) {
      errors.push('Corrupted Central Directory entry header.');
      break;
    }

    const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(ptr + 24);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

    const rawName = zipBuffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf-8');
    ptr += 46 + nameLen + extraLen + commentLen;

    // Skip directories and macOS resource forks
    if (rawName.endsWith('/') || rawName.includes('__MACOSX/') || rawName.endsWith('.DS_Store')) {
      continue;
    }

    rawEntries.push({
      rawName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  // Detect if all entries share a single top-level folder (e.g. "my-game/index.html")
  // ONLY if none of the paths contain '..' traversal attempts
  let commonRootPrefix = '';
  const hasAnyTraversal = rawEntries.some(
    (e) => e.rawName.includes('..') || e.rawName.startsWith('/') || e.rawName.includes('\\')
  );
  if (!hasAnyTraversal && rawEntries.length > 0) {
    const firstParts = rawEntries[0].rawName.split('/');
    if (firstParts.length > 1) {
      const candidate = `${firstParts[0]}/`;
      if (rawEntries.every((e) => e.rawName.startsWith(candidate))) {
        commonRootPrefix = candidate;
      }
    }
  }

  for (const entry of rawEntries) {
    const relativeCandidate = commonRootPrefix
      ? entry.rawName.slice(commonRootPrefix.length)
      : entry.rawName;

    const norm = normalizeRelativePath(relativeCandidate);
    if (!norm.safe) {
      errors.push(`Blocked unsafe ZIP path "${entry.rawName}": ${norm.reason}`);
      continue;
    }

    const ext = getFileExtension(norm.normalized);
    if (!ALLOWED_GAME_EXTENSIONS.has(ext)) {
      errors.push(`Blocked disallowed file type in ZIP: "${norm.normalized}" (${ext || 'no ext'})`);
      continue;
    }

    if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
      errors.push(
        `File "${norm.normalized}" exceeds max single-file size (${entry.uncompressedSize} bytes).`
      );
      continue;
    }

    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > MAX_GAME_BUNDLE_BYTES) {
      errors.push('ZIP archive uncompressed size exceeds 25 MB limit (potential zip bomb).');
      break;
    }

    const lfhOffset = entry.localHeaderOffset;
    if (lfhOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(lfhOffset) !== 0x04034b50) {
      errors.push(`Invalid local file header for "${norm.normalized}".`);
      continue;
    }

    const lfhNameLen = zipBuffer.readUInt16LE(lfhOffset + 26);
    const lfhExtraLen = zipBuffer.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > zipBuffer.length) {
      errors.push(`Compressed data for "${norm.normalized}" is truncated.`);
      continue;
    }

    const compressedSlice = zipBuffer.subarray(dataStart, dataEnd);
    let uncompressedBuf: Buffer;

    try {
      if (entry.compressionMethod === 0) {
        uncompressedBuf = Buffer.from(compressedSlice);
      } else if (entry.compressionMethod === 8) {
        uncompressedBuf = zlib.inflateRawSync(compressedSlice, {
          maxOutputLength: MAX_SINGLE_FILE_BYTES,
        });
      } else {
        errors.push(
          `Unsupported ZIP compression method (${entry.compressionMethod}) for "${norm.normalized}".`
        );
        continue;
      }
    } catch (err) {
      errors.push(
        `Failed to decompress "${norm.normalized}": ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const isText = TEXT_EXTENSIONS.has(ext);
    extractedFiles.push({
      path: norm.normalized,
      content: isText ? uncompressedBuf.toString('utf-8') : uncompressedBuf.toString('base64'),
      encoding: isText ? 'utf-8' : 'base64',
      sizeBytes: uncompressedBuf.length,
    });
  }

  return {
    success: errors.length === 0 && extractedFiles.length > 0,
    files: extractedFiles,
    errors,
    totalUncompressedBytes,
  };
}
