import { deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer.
 *
 * Generated code was reachable only through the database: the Code screen could
 * display it and nothing could get it out. Every route that offered to — "Push
 * to GitHub", "Download repository", the deploy screen — was decoration.
 *
 * Written here rather than pulled in, because the format needed is small and
 * fully specified (PKWARE APPNOTE §4.3): local headers, a central directory and
 * an end-of-central-directory record, all deflated with Node's own zlib. A
 * dependency for this would be more code to trust, not less.
 *
 * No ZIP64. The generated projects this serves are source files measured in
 * kilobytes; anything approaching 4GB is not a case this needs to handle, and
 * it is rejected rather than silently truncated.
 */

/** Precomputed table; the per-byte polynomial loop is the slow way. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * MS-DOS date and time, which is what ZIP stores.
 *
 * Two-second resolution and a 1980 epoch. A timestamp before that cannot be
 * represented, so it is clamped rather than wrapping into a nonsense date.
 */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Forward-slashed path inside the archive. */
  path: string;
  content: string;
}

const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export function createZip(entries: ZipEntry[], now = new Date()): Buffer {
  const stamp = dosStamp(now);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let total = 0;

  for (const entry of entries) {
    // Backslashes and drive letters are not paths inside an archive, and a
    // leading slash or ".." would let an extractor write outside the target.
    const name = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (name.split("/").includes("..")) {
      throw new Error(`Refusing to archive a path that escapes the root: ${entry.path}`);
    }

    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");

    total += raw.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("This project is too large to export as a single archive.");
    }

    const deflated = deflateRawSync(raw);
    // Deflate can be larger than the input on incompressible or tiny files, in
    // which case storing it uncompressed is both smaller and cheaper.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    locals.push(local, nameBytes, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); // central directory signature
    directory.writeUInt16LE(20, 4); // version made by
    directory.writeUInt16LE(20, 6); // version needed
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(stamp.time, 12);
    directory.writeUInt16LE(stamp.date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt16LE(0, 30); // extra
    directory.writeUInt16LE(0, 32); // comment
    directory.writeUInt16LE(0, 34); // disk number
    directory.writeUInt16LE(0, 36); // internal attributes
    // Unix mode in the high word: regular file, rw-r--r--. The shift is forced
    // back to unsigned, because << is a signed 32-bit operator and 0o100644
    // lands in the sign bit.
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);

    central.push(directory, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuffer, end]);
}
