// Minimal headless Canvas2D-subset + PNG encoder, built only on Node
// built-ins (zlib for PNG's required deflate stream) - no native deps
// (e.g. node-canvas/Cairo), so it works on any machine without a build
// toolchain. Implements exactly the subset animal-engine.js's
// drawCreature/drawShadow use: fillStyle, fillRect, save/restore,
// translate/rotate/scale, beginPath/moveTo/lineTo/closePath/fill (a
// generic polygon fill), and ellipse (sampled as an N-gon through the same
// polygon fill) - used only by test/render-poses.mjs to produce real,
// inspectable PNG screenshots for visual verification, not by the app.
import zlib from 'node:zlib';

function multiply(m1, m2) {
  // m = [a,b,c,d,e,f] representing the 2D affine matrix [[a,c,e],[b,d,f],[0,0,1]] - same layout ctx.setTransform uses.
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseColor(str) {
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    const n = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((s) => parseFloat(s));
    return [r, g, b, Math.round(a * 255)];
  }
  return [0, 0, 0, 255];
}

export class MiniCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.fillStyle = '#000000';
    this._transform = [1, 0, 0, 1, 0, 0];
    this._stack = [];
    this._path = null;
  }
  save() { this._stack.push(this._transform.slice()); }
  restore() { if (this._stack.length) this._transform = this._stack.pop(); }
  translate(dx, dy) { this._transform = multiply(this._transform, [1, 0, 0, 1, dx, dy]); }
  scale(sx, sy) { this._transform = multiply(this._transform, [sx, 0, 0, sy, 0, 0]); }
  rotate(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    this._transform = multiply(this._transform, [c, s, -s, c, 0, 0]);
  }
  beginPath() { this._path = []; }
  moveTo(x, y) { this._path.push([x, y]); }
  lineTo(x, y) { this._path.push([x, y]); }
  closePath() { /* fill() already treats the point list as a closed loop */ }
  fillRect(x, y, w, h) {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => apply(this._transform, px, py));
    this._fillPolygon(pts, this.fillStyle);
  }
  fill() {
    if (!this._path || this._path.length < 3) return;
    const pts = this._path.map(([px, py]) => apply(this._transform, px, py));
    this._fillPolygon(pts, this.fillStyle);
  }
  ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle) {
    const pts = [];
    const N = 32;
    const rc = Math.cos(rotation), rs = Math.sin(rotation);
    for (let i = 0; i <= N; i++) {
      const a = startAngle + (endAngle - startAngle) * (i / N);
      const lx = rx * Math.cos(a), ly = ry * Math.sin(a);
      pts.push(apply(this._transform, cx + lx * rc - ly * rs, cy + lx * rs + ly * rc));
    }
    this._fillPolygon(pts, this.fillStyle);
  }
  _fillPolygon(points, color) {
    const [r, g, b, a] = parseColor(color);
    if (a === 0) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, py] of points) { if (py < minY) minY = py; if (py > maxY) maxY = py; }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.height - 1, Math.ceil(maxY));
    const n = points.length;
    const alpha = a / 255;
    for (let y = minY; y <= maxY; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % n];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
          xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xStart = Math.max(0, Math.round(xs[i]));
        const xEnd = Math.min(this.width - 1, Math.round(xs[i + 1]) - 1);
        for (let x = xStart; x <= xEnd; x++) {
          const idx = (y * this.width + x) * 4;
          if (alpha >= 1) {
            this.data[idx] = r; this.data[idx + 1] = g; this.data[idx + 2] = b; this.data[idx + 3] = 255;
          } else {
            this.data[idx] = Math.round(r * alpha + this.data[idx] * (1 - alpha));
            this.data[idx + 1] = Math.round(g * alpha + this.data[idx + 1] * (1 - alpha));
            this.data[idx + 2] = Math.round(b * alpha + this.data[idx + 2] * (1 - alpha));
            this.data[idx + 3] = 255;
          }
        }
      }
    }
  }
  fillBackground(color) {
    const [r, g, b] = parseColor(color);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
    }
  }
  toPNG() { return encodePNG(this.width, this.height, this.data); }
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA, no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgba.subarray(y * stride, (y + 1) * stride).forEach((v, i) => { raw[y * (stride + 1) + 1 + i] = v; });
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
