/*
 * Genereert de extensie-iconen (16/32/48/128) zonder externe dependencies.
 * Motief: één knooppunt links dat uitwaaiert naar drie knooppunten rechts —
 * de query fan-out zelf.
 *
 *   node tools/make-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ canvas */

function Canvas(size, ss = 4) {
  this.size = size;
  this.ss = ss;              // supersampling voor gladde randen
  this.w = size * ss;
  this.buf = new Float32Array(this.w * this.w * 4);
}

Canvas.prototype.set = function (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.w) return;
  const i = (y * this.w + x) * 4;
  const src = a, dst = this.buf[i + 3] * (1 - a);
  const out = src + dst;
  if (out <= 0) return;
  this.buf[i] = (r * src + this.buf[i] * dst) / out;
  this.buf[i + 1] = (g * src + this.buf[i + 1] * dst) / out;
  this.buf[i + 2] = (b * src + this.buf[i + 2] * dst) / out;
  this.buf[i + 3] = out;
};

Canvas.prototype.roundRect = function (x, y, w, h, r, col) {
  const s = this.ss;
  x *= s; y *= s; w *= s; h *= s; r *= s;
  for (let py = Math.floor(y); py < y + h; py++) {
    for (let px = Math.floor(x); px < x + w; px++) {
      const cx = Math.min(Math.max(px + 0.5, x + r), x + w - r);
      const cy = Math.min(Math.max(py + 0.5, y + r), y + h - r);
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (d <= r) this.set(px, py, col[0], col[1], col[2], col[3]);
    }
  }
};

Canvas.prototype.disc = function (cx, cy, rad, col) {
  const s = this.ss;
  cx *= s; cy *= s; rad *= s;
  for (let py = Math.floor(cy - rad); py <= cy + rad; py++) {
    for (let px = Math.floor(cx - rad); px <= cx + rad; px++) {
      if (Math.hypot(px + 0.5 - cx, py + 0.5 - cy) <= rad) this.set(px, py, col[0], col[1], col[2], col[3]);
    }
  }
};

Canvas.prototype.line = function (x0, y0, x1, y1, width, col) {
  const s = this.ss;
  x0 *= s; y0 *= s; x1 *= s; y1 *= s; width *= s;
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    this.disc((x0 + (x1 - x0) * t) / s, (y0 + (y1 - y0) * t) / s, width / 2 / s, col);
  }
};

Canvas.prototype.toPng = function () {
  const n = this.size, s = this.ss;
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const i = ((y * s + dy) * this.w + (x * s + dx)) * 4;
          const al = this.buf[i + 3];
          r += this.buf[i] * al; g += this.buf[i + 1] * al; b += this.buf[i + 2] * al; a += al;
        }
      }
      const cnt = s * s;
      const o = (y * n + x) * 4;
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / cnt) * 255);
    }
  }
  return encodePng(n, n, out);
};

/* -------------------------------------------------------------------- teken */

const BG = [22, 20, 46, 1];
const ACCENT = [124, 108, 255, 1];
const LINE = [124, 108, 255, 0.55];
const NODE = [232, 233, 239, 1];

function draw(size) {
  const c = new Canvas(size, size <= 32 ? 8 : 4);
  const u = size / 32; // schaalfactor t.o.v. 32px-ontwerp

  c.roundRect(0, 0, size, size, size * 0.22, BG);
  c.roundRect(u * 1, u * 1, size - u * 2, size - u * 2, size * 0.2, [124, 108, 255, 0.12]);

  const rootX = u * 9, rootY = size / 2;
  const leafX = u * 23;
  const leafYs = [u * 8.5, u * 16, u * 23.5];
  const lw = Math.max(size * 0.045, 1.1);

  leafYs.forEach((ly) => c.line(rootX, rootY, leafX, ly, lw, LINE));

  const rNode = Math.max(size * 0.075, 1.4);
  leafYs.forEach((ly) => c.disc(leafX, ly, rNode, NODE));
  c.disc(rootX, rootY, size * 0.115, ACCENT);
  c.disc(rootX, rootY, size * 0.05, [255, 255, 255, 0.95]);

  return c.toPng();
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
[16, 32, 48, 128].forEach((s) => {
  const file = path.join(dir, `icon${s}.png`);
  fs.writeFileSync(file, draw(s));
  console.log('geschreven:', path.relative(process.cwd(), file), fs.statSync(file).size + ' bytes');
});
