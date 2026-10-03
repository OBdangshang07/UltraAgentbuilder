import crypto from 'node:crypto';

export class AsyncByteReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
    this.ended = false;
    this.total = 0;
    this.hash = crypto.createHash('sha256');
  }

  async fill() {
    while (this.offset >= this.buffer.length) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        this.buffer = Buffer.alloc(0);
        this.offset = 0;
        return false;
      }
      this.buffer = Buffer.from(next.value);
      this.offset = 0;
      this.total += this.buffer.length;
      this.hash.update(this.buffer);
      if (this.buffer.length > 0) return true;
    }
    return true;
  }

  async readByte() {
    if (!(await this.fill())) throw new Error('Unexpected end of NBT stream');
    return this.buffer[this.offset++];
  }

  async readBuffer(length) {
    if (!Number.isInteger(length) || length < 0) throw new RangeError(`Invalid read length: ${length}`);
    const output = Buffer.allocUnsafe(length);
    let written = 0;
    await this.consume(length, chunk => {
      chunk.copy(output, written);
      written += chunk.length;
    });
    return output;
  }

  async consume(length, visitor = null) {
    if (!Number.isInteger(length) || length < 0) throw new RangeError(`Invalid consume length: ${length}`);
    let remaining = length;
    while (remaining > 0) {
      if (!(await this.fill())) throw new Error(`Unexpected end of NBT stream with ${remaining} bytes remaining`);
      const size = Math.min(remaining, this.buffer.length - this.offset);
      const chunk = this.buffer.subarray(this.offset, this.offset + size);
      if (visitor) visitor(chunk);
      this.offset += size;
      remaining -= size;
    }
  }

  async skip(length) {
    await this.consume(length);
  }

  async readUInt16() {
    const b = await this.readBuffer(2);
    return b.readUInt16BE(0);
  }

  async readInt16() {
    const b = await this.readBuffer(2);
    return b.readInt16BE(0);
  }

  async readInt32() {
    const b = await this.readBuffer(4);
    return b.readInt32BE(0);
  }

  async readString() {
    const length = await this.readUInt16();
    return (await this.readBuffer(length)).toString('utf8');
  }

  async drain() {
    let trailing = this.buffer.length - this.offset;
    this.offset = this.buffer.length;
    while (await this.fill()) {
      trailing += this.buffer.length - this.offset;
      this.offset = this.buffer.length;
    }
    return trailing;
  }

  digest() {
    if (!this.ended) throw new Error('Cannot finalize stream hash before EOF');
    return this.hash.digest('hex');
  }
}
