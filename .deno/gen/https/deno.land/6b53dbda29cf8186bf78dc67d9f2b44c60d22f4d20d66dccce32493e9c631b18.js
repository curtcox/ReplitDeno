// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/golang/go/blob/891682/src/bufio/bufio.go
// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
import { copy } from "../bytes/mod.ts";
import { assert } from "../_util/assert.ts";
import { Buffer } from "./buffer.ts";
import { writeAll, writeAllSync } from "./util.ts";
const DEFAULT_BUF_SIZE = 4096;
const MIN_BUF_SIZE = 16;
const MAX_CONSECUTIVE_EMPTY_READS = 100;
const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
export class BufferFullError extends Error {
  partial;
  name;
  constructor(partial){
    super("Buffer full");
    this.partial = partial;
    this.name = "BufferFullError";
  }
}
export class PartialReadError extends Error {
  name = "PartialReadError";
  partial;
  constructor(){
    super("Encountered UnexpectedEof, data only partially read");
  }
}
/** BufReader implements buffering for a Reader object. */ export class BufReader {
  buf;
  rd;
  r = 0;
  w = 0;
  eof = false;
  // private lastByte: number;
  // private lastCharSize: number;
  /** return new BufReader unless r is BufReader */ static create(r, size = DEFAULT_BUF_SIZE) {
    return r instanceof BufReader ? r : new BufReader(r, size);
  }
  constructor(rd, size = DEFAULT_BUF_SIZE){
    if (size < MIN_BUF_SIZE) {
      size = MIN_BUF_SIZE;
    }
    this._reset(new Uint8Array(size), rd);
  }
  /** Returns the size of the underlying buffer in bytes. */ size() {
    return this.buf.byteLength;
  }
  buffered() {
    return this.w - this.r;
  }
  // Reads a new chunk into the buffer.
  async _fill() {
    // Slide existing data to beginning.
    if (this.r > 0) {
      this.buf.copyWithin(0, this.r, this.w);
      this.w -= this.r;
      this.r = 0;
    }
    if (this.w >= this.buf.byteLength) {
      throw Error("bufio: tried to fill full buffer");
    }
    // Read new data: try a limited number of times.
    for(let i = MAX_CONSECUTIVE_EMPTY_READS; i > 0; i--){
      const rr = await this.rd.read(this.buf.subarray(this.w));
      if (rr === null) {
        this.eof = true;
        return;
      }
      assert(rr >= 0, "negative read");
      this.w += rr;
      if (rr > 0) {
        return;
      }
    }
    throw new Error(`No progress after ${MAX_CONSECUTIVE_EMPTY_READS} read() calls`);
  }
  /** Discards any buffered data, resets all state, and switches
   * the buffered reader to read from r.
   */ reset(r) {
    this._reset(this.buf, r);
  }
  _reset(buf, rd) {
    this.buf = buf;
    this.rd = rd;
    this.eof = false;
  // this.lastByte = -1;
  // this.lastCharSize = -1;
  }
  /** reads data into p.
   * It returns the number of bytes read into p.
   * The bytes are taken from at most one Read on the underlying Reader,
   * hence n may be less than len(p).
   * To read exactly len(p) bytes, use io.ReadFull(b, p).
   */ async read(p) {
    let rr = p.byteLength;
    if (p.byteLength === 0) return rr;
    if (this.r === this.w) {
      if (p.byteLength >= this.buf.byteLength) {
        // Large read, empty buffer.
        // Read directly into p to avoid copy.
        const rr = await this.rd.read(p);
        const nread = rr ?? 0;
        assert(nread >= 0, "negative read");
        // if (rr.nread > 0) {
        //   this.lastByte = p[rr.nread - 1];
        //   this.lastCharSize = -1;
        // }
        return rr;
      }
      // One read.
      // Do not use this.fill, which will loop.
      this.r = 0;
      this.w = 0;
      rr = await this.rd.read(this.buf);
      if (rr === 0 || rr === null) return rr;
      assert(rr >= 0, "negative read");
      this.w += rr;
    }
    // copy as much as we can
    const copied = copy(this.buf.subarray(this.r, this.w), p, 0);
    this.r += copied;
    // this.lastByte = this.buf[this.r - 1];
    // this.lastCharSize = -1;
    return copied;
  }
  /** reads exactly `p.length` bytes into `p`.
   *
   * If successful, `p` is returned.
   *
   * If the end of the underlying stream has been reached, and there are no more
   * bytes available in the buffer, `readFull()` returns `null` instead.
   *
   * An error is thrown if some bytes could be read, but not enough to fill `p`
   * entirely before the underlying stream reported an error or EOF. Any error
   * thrown will have a `partial` property that indicates the slice of the
   * buffer that has been successfully filled with data.
   *
   * Ported from https://golang.org/pkg/io/#ReadFull
   */ async readFull(p) {
    let bytesRead = 0;
    while(bytesRead < p.length){
      try {
        const rr = await this.read(p.subarray(bytesRead));
        if (rr === null) {
          if (bytesRead === 0) {
            return null;
          } else {
            throw new PartialReadError();
          }
        }
        bytesRead += rr;
      } catch (err) {
        err.partial = p.subarray(0, bytesRead);
        throw err;
      }
    }
    return p;
  }
  /** Returns the next byte [0, 255] or `null`. */ async readByte() {
    while(this.r === this.w){
      if (this.eof) return null;
      await this._fill(); // buffer is empty.
    }
    const c = this.buf[this.r];
    this.r++;
    // this.lastByte = c;
    return c;
  }
  /** readString() reads until the first occurrence of delim in the input,
   * returning a string containing the data up to and including the delimiter.
   * If ReadString encounters an error before finding a delimiter,
   * it returns the data read before the error and the error itself
   * (often `null`).
   * ReadString returns err != nil if and only if the returned data does not end
   * in delim.
   * For simple uses, a Scanner may be more convenient.
   */ async readString(delim) {
    if (delim.length !== 1) {
      throw new Error("Delimiter should be a single character");
    }
    const buffer = await this.readSlice(delim.charCodeAt(0));
    if (buffer === null) return null;
    return new TextDecoder().decode(buffer);
  }
  /** `readLine()` is a low-level line-reading primitive. Most callers should
   * use `readString('\n')` instead or use a Scanner.
   *
   * `readLine()` tries to return a single line, not including the end-of-line
   * bytes. If the line was too long for the buffer then `more` is set and the
   * beginning of the line is returned. The rest of the line will be returned
   * from future calls. `more` will be false when returning the last fragment
   * of the line. The returned buffer is only valid until the next call to
   * `readLine()`.
   *
   * The text returned from ReadLine does not include the line end ("\r\n" or
   * "\n").
   *
   * When the end of the underlying stream is reached, the final bytes in the
   * stream are returned. No indication or error is given if the input ends
   * without a final line end. When there are no more trailing bytes to read,
   * `readLine()` returns `null`.
   *
   * Calling `unreadByte()` after `readLine()` will always unread the last byte
   * read (possibly a character belonging to the line end) even if that byte is
   * not part of the line returned by `readLine()`.
   */ async readLine() {
    let line;
    try {
      line = await this.readSlice(LF);
    } catch (err) {
      let { partial } = err;
      assert(partial instanceof Uint8Array, "bufio: caught error from `readSlice()` without `partial` property");
      // Don't throw if `readSlice()` failed with `BufferFullError`, instead we
      // just return whatever is available and set the `more` flag.
      if (!(err instanceof BufferFullError)) {
        throw err;
      }
      // Handle the case where "\r\n" straddles the buffer.
      if (!this.eof && partial.byteLength > 0 && partial[partial.byteLength - 1] === CR) {
        // Put the '\r' back on buf and drop it from line.
        // Let the next call to ReadLine check for "\r\n".
        assert(this.r > 0, "bufio: tried to rewind past start of buffer");
        this.r--;
        partial = partial.subarray(0, partial.byteLength - 1);
      }
      return {
        line: partial,
        more: !this.eof
      };
    }
    if (line === null) {
      return null;
    }
    if (line.byteLength === 0) {
      return {
        line,
        more: false
      };
    }
    if (line[line.byteLength - 1] == LF) {
      let drop = 1;
      if (line.byteLength > 1 && line[line.byteLength - 2] === CR) {
        drop = 2;
      }
      line = line.subarray(0, line.byteLength - drop);
    }
    return {
      line,
      more: false
    };
  }
  /** `readSlice()` reads until the first occurrence of `delim` in the input,
   * returning a slice pointing at the bytes in the buffer. The bytes stop
   * being valid at the next read.
   *
   * If `readSlice()` encounters an error before finding a delimiter, or the
   * buffer fills without finding a delimiter, it throws an error with a
   * `partial` property that contains the entire buffer.
   *
   * If `readSlice()` encounters the end of the underlying stream and there are
   * any bytes left in the buffer, the rest of the buffer is returned. In other
   * words, EOF is always treated as a delimiter. Once the buffer is empty,
   * it returns `null`.
   *
   * Because the data returned from `readSlice()` will be overwritten by the
   * next I/O operation, most clients should use `readString()` instead.
   */ async readSlice(delim) {
    let s = 0; // search start index
    let slice;
    while(true){
      // Search buffer.
      let i = this.buf.subarray(this.r + s, this.w).indexOf(delim);
      if (i >= 0) {
        i += s;
        slice = this.buf.subarray(this.r, this.r + i + 1);
        this.r += i + 1;
        break;
      }
      // EOF?
      if (this.eof) {
        if (this.r === this.w) {
          return null;
        }
        slice = this.buf.subarray(this.r, this.w);
        this.r = this.w;
        break;
      }
      // Buffer full?
      if (this.buffered() >= this.buf.byteLength) {
        this.r = this.w;
        // #4521 The internal buffer should not be reused across reads because it causes corruption of data.
        const oldbuf = this.buf;
        const newbuf = this.buf.slice(0);
        this.buf = newbuf;
        throw new BufferFullError(oldbuf);
      }
      s = this.w - this.r; // do not rescan area we scanned before
      // Buffer is not full.
      try {
        await this._fill();
      } catch (err) {
        err.partial = slice;
        throw err;
      }
    }
    // Handle last byte, if any.
    // const i = slice.byteLength - 1;
    // if (i >= 0) {
    //   this.lastByte = slice[i];
    //   this.lastCharSize = -1
    // }
    return slice;
  }
  /** `peek()` returns the next `n` bytes without advancing the reader. The
   * bytes stop being valid at the next read call.
   *
   * When the end of the underlying stream is reached, but there are unread
   * bytes left in the buffer, those bytes are returned. If there are no bytes
   * left in the buffer, it returns `null`.
   *
   * If an error is encountered before `n` bytes are available, `peek()` throws
   * an error with the `partial` property set to a slice of the buffer that
   * contains the bytes that were available before the error occurred.
   */ async peek(n) {
    if (n < 0) {
      throw Error("negative count");
    }
    let avail = this.w - this.r;
    while(avail < n && avail < this.buf.byteLength && !this.eof){
      try {
        await this._fill();
      } catch (err) {
        err.partial = this.buf.subarray(this.r, this.w);
        throw err;
      }
      avail = this.w - this.r;
    }
    if (avail === 0 && this.eof) {
      return null;
    } else if (avail < n && this.eof) {
      return this.buf.subarray(this.r, this.r + avail);
    } else if (avail < n) {
      throw new BufferFullError(this.buf.subarray(this.r, this.w));
    }
    return this.buf.subarray(this.r, this.r + n);
  }
}
class AbstractBufBase {
  buf;
  usedBufferBytes = 0;
  err = null;
  /** Size returns the size of the underlying buffer in bytes. */ size() {
    return this.buf.byteLength;
  }
  /** Returns how many bytes are unused in the buffer. */ available() {
    return this.buf.byteLength - this.usedBufferBytes;
  }
  /** buffered returns the number of bytes that have been written into the
   * current buffer.
   */ buffered() {
    return this.usedBufferBytes;
  }
}
/** BufWriter implements buffering for an deno.Writer object.
 * If an error occurs writing to a Writer, no more data will be
 * accepted and all subsequent writes, and flush(), will return the error.
 * After all data has been written, the client should call the
 * flush() method to guarantee all data has been forwarded to
 * the underlying deno.Writer.
 */ export class BufWriter extends AbstractBufBase {
  writer;
  /** return new BufWriter unless writer is BufWriter */ static create(writer, size = DEFAULT_BUF_SIZE) {
    return writer instanceof BufWriter ? writer : new BufWriter(writer, size);
  }
  constructor(writer, size = DEFAULT_BUF_SIZE){
    super();
    this.writer = writer;
    if (size <= 0) {
      size = DEFAULT_BUF_SIZE;
    }
    this.buf = new Uint8Array(size);
  }
  /** Discards any unflushed buffered data, clears any error, and
   * resets buffer to write its output to w.
   */ reset(w) {
    this.err = null;
    this.usedBufferBytes = 0;
    this.writer = w;
  }
  /** Flush writes any buffered data to the underlying io.Writer. */ async flush() {
    if (this.err !== null) throw this.err;
    if (this.usedBufferBytes === 0) return;
    try {
      await writeAll(this.writer, this.buf.subarray(0, this.usedBufferBytes));
    } catch (e) {
      this.err = e;
      throw e;
    }
    this.buf = new Uint8Array(this.buf.length);
    this.usedBufferBytes = 0;
  }
  /** Writes the contents of `data` into the buffer.  If the contents won't fully
   * fit into the buffer, those bytes that can are copied into the buffer, the
   * buffer is the flushed to the writer and the remaining bytes are copied into
   * the now empty buffer.
   *
   * @return the number of bytes written to the buffer.
   */ async write(data) {
    if (this.err !== null) throw this.err;
    if (data.length === 0) return 0;
    let totalBytesWritten = 0;
    let numBytesWritten = 0;
    while(data.byteLength > this.available()){
      if (this.buffered() === 0) {
        // Large write, empty buffer.
        // Write directly from data to avoid copy.
        try {
          numBytesWritten = await this.writer.write(data);
        } catch (e) {
          this.err = e;
          throw e;
        }
      } else {
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        await this.flush();
      }
      totalBytesWritten += numBytesWritten;
      data = data.subarray(numBytesWritten);
    }
    numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
    this.usedBufferBytes += numBytesWritten;
    totalBytesWritten += numBytesWritten;
    return totalBytesWritten;
  }
}
/** BufWriterSync implements buffering for a deno.WriterSync object.
 * If an error occurs writing to a WriterSync, no more data will be
 * accepted and all subsequent writes, and flush(), will return the error.
 * After all data has been written, the client should call the
 * flush() method to guarantee all data has been forwarded to
 * the underlying deno.WriterSync.
 */ export class BufWriterSync extends AbstractBufBase {
  writer;
  /** return new BufWriterSync unless writer is BufWriterSync */ static create(writer, size = DEFAULT_BUF_SIZE) {
    return writer instanceof BufWriterSync ? writer : new BufWriterSync(writer, size);
  }
  constructor(writer, size = DEFAULT_BUF_SIZE){
    super();
    this.writer = writer;
    if (size <= 0) {
      size = DEFAULT_BUF_SIZE;
    }
    this.buf = new Uint8Array(size);
  }
  /** Discards any unflushed buffered data, clears any error, and
   * resets buffer to write its output to w.
   */ reset(w) {
    this.err = null;
    this.usedBufferBytes = 0;
    this.writer = w;
  }
  /** Flush writes any buffered data to the underlying io.WriterSync. */ flush() {
    if (this.err !== null) throw this.err;
    if (this.usedBufferBytes === 0) return;
    try {
      writeAllSync(this.writer, this.buf.subarray(0, this.usedBufferBytes));
    } catch (e) {
      this.err = e;
      throw e;
    }
    this.buf = new Uint8Array(this.buf.length);
    this.usedBufferBytes = 0;
  }
  /** Writes the contents of `data` into the buffer.  If the contents won't fully
   * fit into the buffer, those bytes that can are copied into the buffer, the
   * buffer is the flushed to the writer and the remaining bytes are copied into
   * the now empty buffer.
   *
   * @return the number of bytes written to the buffer.
   */ writeSync(data) {
    if (this.err !== null) throw this.err;
    if (data.length === 0) return 0;
    let totalBytesWritten = 0;
    let numBytesWritten = 0;
    while(data.byteLength > this.available()){
      if (this.buffered() === 0) {
        // Large write, empty buffer.
        // Write directly from data to avoid copy.
        try {
          numBytesWritten = this.writer.writeSync(data);
        } catch (e) {
          this.err = e;
          throw e;
        }
      } else {
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        this.flush();
      }
      totalBytesWritten += numBytesWritten;
      data = data.subarray(numBytesWritten);
    }
    numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
    this.usedBufferBytes += numBytesWritten;
    totalBytesWritten += numBytesWritten;
    return totalBytesWritten;
  }
}
/** Generate longest proper prefix which is also suffix array. */ function createLPS(pat) {
  const lps = new Uint8Array(pat.length);
  lps[0] = 0;
  let prefixEnd = 0;
  let i = 1;
  while(i < lps.length){
    if (pat[i] == pat[prefixEnd]) {
      prefixEnd++;
      lps[i] = prefixEnd;
      i++;
    } else if (prefixEnd === 0) {
      lps[i] = 0;
      i++;
    } else {
      prefixEnd = pat[prefixEnd - 1];
    }
  }
  return lps;
}
/** Read delimited bytes from a Reader. */ export async function* readDelim(reader, delim) {
  // Avoid unicode problems
  const delimLen = delim.length;
  const delimLPS = createLPS(delim);
  let inputBuffer = new Buffer();
  const inspectArr = new Uint8Array(Math.max(1024, delimLen + 1));
  // Modified KMP
  let inspectIndex = 0;
  let matchIndex = 0;
  while(true){
    const result = await reader.read(inspectArr);
    if (result === null) {
      // Yield last chunk.
      yield inputBuffer.bytes();
      return;
    }
    if (result < 0) {
      // Discard all remaining and silently fail.
      return;
    }
    const sliceRead = inspectArr.subarray(0, result);
    await writeAll(inputBuffer, sliceRead);
    let sliceToProcess = inputBuffer.bytes();
    while(inspectIndex < sliceToProcess.length){
      if (sliceToProcess[inspectIndex] === delim[matchIndex]) {
        inspectIndex++;
        matchIndex++;
        if (matchIndex === delimLen) {
          // Full match
          const matchEnd = inspectIndex - delimLen;
          const readyBytes = sliceToProcess.subarray(0, matchEnd);
          // Copy
          const pendingBytes = sliceToProcess.slice(inspectIndex);
          yield readyBytes;
          // Reset match, different from KMP.
          sliceToProcess = pendingBytes;
          inspectIndex = 0;
          matchIndex = 0;
        }
      } else {
        if (matchIndex === 0) {
          inspectIndex++;
        } else {
          matchIndex = delimLPS[matchIndex - 1];
        }
      }
    }
    // Keep inspectIndex and matchIndex.
    inputBuffer = new Buffer(sliceToProcess);
  }
}
/** Read delimited strings from a Reader. */ export async function* readStringDelim(reader, delim) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  for await (const chunk of readDelim(reader, encoder.encode(delim))){
    yield decoder.decode(chunk);
  }
}
/** Read strings line-by-line from a Reader. */ export async function* readLines(reader) {
  for await (let chunk of readStringDelim(reader, "\n")){
    // Finding a CR at the end of the line is evidence of a
    // "\r\n" at the end of the line. The "\r" part should be
    // removed too.
    if (chunk.endsWith("\r")) {
      chunk = chunk.slice(0, -1);
    }
    yield chunk;
  }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjkyLjAvaW8vYnVmaW8udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbi8vIEJhc2VkIG9uIGh0dHBzOi8vZ2l0aHViLmNvbS9nb2xhbmcvZ28vYmxvYi84OTE2ODIvc3JjL2J1ZmlvL2J1ZmlvLmdvXG4vLyBDb3B5cmlnaHQgMjAwOSBUaGUgR28gQXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC5cbi8vIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlXG4vLyBsaWNlbnNlIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUuXG5cbnR5cGUgUmVhZGVyID0gRGVuby5SZWFkZXI7XG50eXBlIFdyaXRlciA9IERlbm8uV3JpdGVyO1xudHlwZSBXcml0ZXJTeW5jID0gRGVuby5Xcml0ZXJTeW5jO1xuaW1wb3J0IHsgY29weSB9IGZyb20gXCIuLi9ieXRlcy9tb2QudHNcIjtcbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcbmltcG9ydCB7IEJ1ZmZlciB9IGZyb20gXCIuL2J1ZmZlci50c1wiO1xuaW1wb3J0IHsgd3JpdGVBbGwsIHdyaXRlQWxsU3luYyB9IGZyb20gXCIuL3V0aWwudHNcIjtcblxuY29uc3QgREVGQVVMVF9CVUZfU0laRSA9IDQwOTY7XG5jb25zdCBNSU5fQlVGX1NJWkUgPSAxNjtcbmNvbnN0IE1BWF9DT05TRUNVVElWRV9FTVBUWV9SRUFEUyA9IDEwMDtcbmNvbnN0IENSID0gXCJcXHJcIi5jaGFyQ29kZUF0KDApO1xuY29uc3QgTEYgPSBcIlxcblwiLmNoYXJDb2RlQXQoMCk7XG5cbmV4cG9ydCBjbGFzcyBCdWZmZXJGdWxsRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIG5hbWUgPSBcIkJ1ZmZlckZ1bGxFcnJvclwiO1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgcGFydGlhbDogVWludDhBcnJheSkge1xuICAgIHN1cGVyKFwiQnVmZmVyIGZ1bGxcIik7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFBhcnRpYWxSZWFkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIG5hbWUgPSBcIlBhcnRpYWxSZWFkRXJyb3JcIjtcbiAgcGFydGlhbD86IFVpbnQ4QXJyYXk7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKFwiRW5jb3VudGVyZWQgVW5leHBlY3RlZEVvZiwgZGF0YSBvbmx5IHBhcnRpYWxseSByZWFkXCIpO1xuICB9XG59XG5cbi8qKiBSZXN1bHQgdHlwZSByZXR1cm5lZCBieSBvZiBCdWZSZWFkZXIucmVhZExpbmUoKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVhZExpbmVSZXN1bHQge1xuICBsaW5lOiBVaW50OEFycmF5O1xuICBtb3JlOiBib29sZWFuO1xufVxuXG4vKiogQnVmUmVhZGVyIGltcGxlbWVudHMgYnVmZmVyaW5nIGZvciBhIFJlYWRlciBvYmplY3QuICovXG5leHBvcnQgY2xhc3MgQnVmUmVhZGVyIGltcGxlbWVudHMgUmVhZGVyIHtcbiAgcHJpdmF0ZSBidWYhOiBVaW50OEFycmF5O1xuICBwcml2YXRlIHJkITogUmVhZGVyOyAvLyBSZWFkZXIgcHJvdmlkZWQgYnkgY2FsbGVyLlxuICBwcml2YXRlIHIgPSAwOyAvLyBidWYgcmVhZCBwb3NpdGlvbi5cbiAgcHJpdmF0ZSB3ID0gMDsgLy8gYnVmIHdyaXRlIHBvc2l0aW9uLlxuICBwcml2YXRlIGVvZiA9IGZhbHNlO1xuICAvLyBwcml2YXRlIGxhc3RCeXRlOiBudW1iZXI7XG4gIC8vIHByaXZhdGUgbGFzdENoYXJTaXplOiBudW1iZXI7XG5cbiAgLyoqIHJldHVybiBuZXcgQnVmUmVhZGVyIHVubGVzcyByIGlzIEJ1ZlJlYWRlciAqL1xuICBzdGF0aWMgY3JlYXRlKHI6IFJlYWRlciwgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSk6IEJ1ZlJlYWRlciB7XG4gICAgcmV0dXJuIHIgaW5zdGFuY2VvZiBCdWZSZWFkZXIgPyByIDogbmV3IEJ1ZlJlYWRlcihyLCBzaXplKTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHJkOiBSZWFkZXIsIHNpemU6IG51bWJlciA9IERFRkFVTFRfQlVGX1NJWkUpIHtcbiAgICBpZiAoc2l6ZSA8IE1JTl9CVUZfU0laRSkge1xuICAgICAgc2l6ZSA9IE1JTl9CVUZfU0laRTtcbiAgICB9XG4gICAgdGhpcy5fcmVzZXQobmV3IFVpbnQ4QXJyYXkoc2l6ZSksIHJkKTtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIHRoZSBzaXplIG9mIHRoZSB1bmRlcmx5aW5nIGJ1ZmZlciBpbiBieXRlcy4gKi9cbiAgc2l6ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmJ1Zi5ieXRlTGVuZ3RoO1xuICB9XG5cbiAgYnVmZmVyZWQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy53IC0gdGhpcy5yO1xuICB9XG5cbiAgLy8gUmVhZHMgYSBuZXcgY2h1bmsgaW50byB0aGUgYnVmZmVyLlxuICBwcml2YXRlIGFzeW5jIF9maWxsKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFNsaWRlIGV4aXN0aW5nIGRhdGEgdG8gYmVnaW5uaW5nLlxuICAgIGlmICh0aGlzLnIgPiAwKSB7XG4gICAgICB0aGlzLmJ1Zi5jb3B5V2l0aGluKDAsIHRoaXMuciwgdGhpcy53KTtcbiAgICAgIHRoaXMudyAtPSB0aGlzLnI7XG4gICAgICB0aGlzLnIgPSAwO1xuICAgIH1cblxuICAgIGlmICh0aGlzLncgPj0gdGhpcy5idWYuYnl0ZUxlbmd0aCkge1xuICAgICAgdGhyb3cgRXJyb3IoXCJidWZpbzogdHJpZWQgdG8gZmlsbCBmdWxsIGJ1ZmZlclwiKTtcbiAgICB9XG5cbiAgICAvLyBSZWFkIG5ldyBkYXRhOiB0cnkgYSBsaW1pdGVkIG51bWJlciBvZiB0aW1lcy5cbiAgICBmb3IgKGxldCBpID0gTUFYX0NPTlNFQ1VUSVZFX0VNUFRZX1JFQURTOyBpID4gMDsgaS0tKSB7XG4gICAgICBjb25zdCByciA9IGF3YWl0IHRoaXMucmQucmVhZCh0aGlzLmJ1Zi5zdWJhcnJheSh0aGlzLncpKTtcbiAgICAgIGlmIChyciA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLmVvZiA9IHRydWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGFzc2VydChyciA+PSAwLCBcIm5lZ2F0aXZlIHJlYWRcIik7XG4gICAgICB0aGlzLncgKz0gcnI7XG4gICAgICBpZiAocnIgPiAwKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTm8gcHJvZ3Jlc3MgYWZ0ZXIgJHtNQVhfQ09OU0VDVVRJVkVfRU1QVFlfUkVBRFN9IHJlYWQoKSBjYWxsc2AsXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBEaXNjYXJkcyBhbnkgYnVmZmVyZWQgZGF0YSwgcmVzZXRzIGFsbCBzdGF0ZSwgYW5kIHN3aXRjaGVzXG4gICAqIHRoZSBidWZmZXJlZCByZWFkZXIgdG8gcmVhZCBmcm9tIHIuXG4gICAqL1xuICByZXNldChyOiBSZWFkZXIpOiB2b2lkIHtcbiAgICB0aGlzLl9yZXNldCh0aGlzLmJ1Ziwgcik7XG4gIH1cblxuICBwcml2YXRlIF9yZXNldChidWY6IFVpbnQ4QXJyYXksIHJkOiBSZWFkZXIpOiB2b2lkIHtcbiAgICB0aGlzLmJ1ZiA9IGJ1ZjtcbiAgICB0aGlzLnJkID0gcmQ7XG4gICAgdGhpcy5lb2YgPSBmYWxzZTtcbiAgICAvLyB0aGlzLmxhc3RCeXRlID0gLTE7XG4gICAgLy8gdGhpcy5sYXN0Q2hhclNpemUgPSAtMTtcbiAgfVxuXG4gIC8qKiByZWFkcyBkYXRhIGludG8gcC5cbiAgICogSXQgcmV0dXJucyB0aGUgbnVtYmVyIG9mIGJ5dGVzIHJlYWQgaW50byBwLlxuICAgKiBUaGUgYnl0ZXMgYXJlIHRha2VuIGZyb20gYXQgbW9zdCBvbmUgUmVhZCBvbiB0aGUgdW5kZXJseWluZyBSZWFkZXIsXG4gICAqIGhlbmNlIG4gbWF5IGJlIGxlc3MgdGhhbiBsZW4ocCkuXG4gICAqIFRvIHJlYWQgZXhhY3RseSBsZW4ocCkgYnl0ZXMsIHVzZSBpby5SZWFkRnVsbChiLCBwKS5cbiAgICovXG4gIGFzeW5jIHJlYWQocDogVWludDhBcnJheSk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAgIGxldCBycjogbnVtYmVyIHwgbnVsbCA9IHAuYnl0ZUxlbmd0aDtcbiAgICBpZiAocC5ieXRlTGVuZ3RoID09PSAwKSByZXR1cm4gcnI7XG5cbiAgICBpZiAodGhpcy5yID09PSB0aGlzLncpIHtcbiAgICAgIGlmIChwLmJ5dGVMZW5ndGggPj0gdGhpcy5idWYuYnl0ZUxlbmd0aCkge1xuICAgICAgICAvLyBMYXJnZSByZWFkLCBlbXB0eSBidWZmZXIuXG4gICAgICAgIC8vIFJlYWQgZGlyZWN0bHkgaW50byBwIHRvIGF2b2lkIGNvcHkuXG4gICAgICAgIGNvbnN0IHJyID0gYXdhaXQgdGhpcy5yZC5yZWFkKHApO1xuICAgICAgICBjb25zdCBucmVhZCA9IHJyID8/IDA7XG4gICAgICAgIGFzc2VydChucmVhZCA+PSAwLCBcIm5lZ2F0aXZlIHJlYWRcIik7XG4gICAgICAgIC8vIGlmIChyci5ucmVhZCA+IDApIHtcbiAgICAgICAgLy8gICB0aGlzLmxhc3RCeXRlID0gcFtyci5ucmVhZCAtIDFdO1xuICAgICAgICAvLyAgIHRoaXMubGFzdENoYXJTaXplID0gLTE7XG4gICAgICAgIC8vIH1cbiAgICAgICAgcmV0dXJuIHJyO1xuICAgICAgfVxuXG4gICAgICAvLyBPbmUgcmVhZC5cbiAgICAgIC8vIERvIG5vdCB1c2UgdGhpcy5maWxsLCB3aGljaCB3aWxsIGxvb3AuXG4gICAgICB0aGlzLnIgPSAwO1xuICAgICAgdGhpcy53ID0gMDtcbiAgICAgIHJyID0gYXdhaXQgdGhpcy5yZC5yZWFkKHRoaXMuYnVmKTtcbiAgICAgIGlmIChyciA9PT0gMCB8fCByciA9PT0gbnVsbCkgcmV0dXJuIHJyO1xuICAgICAgYXNzZXJ0KHJyID49IDAsIFwibmVnYXRpdmUgcmVhZFwiKTtcbiAgICAgIHRoaXMudyArPSBycjtcbiAgICB9XG5cbiAgICAvLyBjb3B5IGFzIG11Y2ggYXMgd2UgY2FuXG4gICAgY29uc3QgY29waWVkID0gY29weSh0aGlzLmJ1Zi5zdWJhcnJheSh0aGlzLnIsIHRoaXMudyksIHAsIDApO1xuICAgIHRoaXMuciArPSBjb3BpZWQ7XG4gICAgLy8gdGhpcy5sYXN0Qnl0ZSA9IHRoaXMuYnVmW3RoaXMuciAtIDFdO1xuICAgIC8vIHRoaXMubGFzdENoYXJTaXplID0gLTE7XG4gICAgcmV0dXJuIGNvcGllZDtcbiAgfVxuXG4gIC8qKiByZWFkcyBleGFjdGx5IGBwLmxlbmd0aGAgYnl0ZXMgaW50byBgcGAuXG4gICAqXG4gICAqIElmIHN1Y2Nlc3NmdWwsIGBwYCBpcyByZXR1cm5lZC5cbiAgICpcbiAgICogSWYgdGhlIGVuZCBvZiB0aGUgdW5kZXJseWluZyBzdHJlYW0gaGFzIGJlZW4gcmVhY2hlZCwgYW5kIHRoZXJlIGFyZSBubyBtb3JlXG4gICAqIGJ5dGVzIGF2YWlsYWJsZSBpbiB0aGUgYnVmZmVyLCBgcmVhZEZ1bGwoKWAgcmV0dXJucyBgbnVsbGAgaW5zdGVhZC5cbiAgICpcbiAgICogQW4gZXJyb3IgaXMgdGhyb3duIGlmIHNvbWUgYnl0ZXMgY291bGQgYmUgcmVhZCwgYnV0IG5vdCBlbm91Z2ggdG8gZmlsbCBgcGBcbiAgICogZW50aXJlbHkgYmVmb3JlIHRoZSB1bmRlcmx5aW5nIHN0cmVhbSByZXBvcnRlZCBhbiBlcnJvciBvciBFT0YuIEFueSBlcnJvclxuICAgKiB0aHJvd24gd2lsbCBoYXZlIGEgYHBhcnRpYWxgIHByb3BlcnR5IHRoYXQgaW5kaWNhdGVzIHRoZSBzbGljZSBvZiB0aGVcbiAgICogYnVmZmVyIHRoYXQgaGFzIGJlZW4gc3VjY2Vzc2Z1bGx5IGZpbGxlZCB3aXRoIGRhdGEuXG4gICAqXG4gICAqIFBvcnRlZCBmcm9tIGh0dHBzOi8vZ29sYW5nLm9yZy9wa2cvaW8vI1JlYWRGdWxsXG4gICAqL1xuICBhc3luYyByZWFkRnVsbChwOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5IHwgbnVsbD4ge1xuICAgIGxldCBieXRlc1JlYWQgPSAwO1xuICAgIHdoaWxlIChieXRlc1JlYWQgPCBwLmxlbmd0aCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcnIgPSBhd2FpdCB0aGlzLnJlYWQocC5zdWJhcnJheShieXRlc1JlYWQpKTtcbiAgICAgICAgaWYgKHJyID09PSBudWxsKSB7XG4gICAgICAgICAgaWYgKGJ5dGVzUmVhZCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJ0aWFsUmVhZEVycm9yKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJ5dGVzUmVhZCArPSBycjtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBlcnIucGFydGlhbCA9IHAuc3ViYXJyYXkoMCwgYnl0ZXNSZWFkKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcDtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIHRoZSBuZXh0IGJ5dGUgWzAsIDI1NV0gb3IgYG51bGxgLiAqL1xuICBhc3luYyByZWFkQnl0ZSgpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICB3aGlsZSAodGhpcy5yID09PSB0aGlzLncpIHtcbiAgICAgIGlmICh0aGlzLmVvZikgcmV0dXJuIG51bGw7XG4gICAgICBhd2FpdCB0aGlzLl9maWxsKCk7IC8vIGJ1ZmZlciBpcyBlbXB0eS5cbiAgICB9XG4gICAgY29uc3QgYyA9IHRoaXMuYnVmW3RoaXMucl07XG4gICAgdGhpcy5yKys7XG4gICAgLy8gdGhpcy5sYXN0Qnl0ZSA9IGM7XG4gICAgcmV0dXJuIGM7XG4gIH1cblxuICAvKiogcmVhZFN0cmluZygpIHJlYWRzIHVudGlsIHRoZSBmaXJzdCBvY2N1cnJlbmNlIG9mIGRlbGltIGluIHRoZSBpbnB1dCxcbiAgICogcmV0dXJuaW5nIGEgc3RyaW5nIGNvbnRhaW5pbmcgdGhlIGRhdGEgdXAgdG8gYW5kIGluY2x1ZGluZyB0aGUgZGVsaW1pdGVyLlxuICAgKiBJZiBSZWFkU3RyaW5nIGVuY291bnRlcnMgYW4gZXJyb3IgYmVmb3JlIGZpbmRpbmcgYSBkZWxpbWl0ZXIsXG4gICAqIGl0IHJldHVybnMgdGhlIGRhdGEgcmVhZCBiZWZvcmUgdGhlIGVycm9yIGFuZCB0aGUgZXJyb3IgaXRzZWxmXG4gICAqIChvZnRlbiBgbnVsbGApLlxuICAgKiBSZWFkU3RyaW5nIHJldHVybnMgZXJyICE9IG5pbCBpZiBhbmQgb25seSBpZiB0aGUgcmV0dXJuZWQgZGF0YSBkb2VzIG5vdCBlbmRcbiAgICogaW4gZGVsaW0uXG4gICAqIEZvciBzaW1wbGUgdXNlcywgYSBTY2FubmVyIG1heSBiZSBtb3JlIGNvbnZlbmllbnQuXG4gICAqL1xuICBhc3luYyByZWFkU3RyaW5nKGRlbGltOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBpZiAoZGVsaW0ubGVuZ3RoICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEZWxpbWl0ZXIgc2hvdWxkIGJlIGEgc2luZ2xlIGNoYXJhY3RlclwiKTtcbiAgICB9XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgdGhpcy5yZWFkU2xpY2UoZGVsaW0uY2hhckNvZGVBdCgwKSk7XG4gICAgaWYgKGJ1ZmZlciA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWZmZXIpO1xuICB9XG5cbiAgLyoqIGByZWFkTGluZSgpYCBpcyBhIGxvdy1sZXZlbCBsaW5lLXJlYWRpbmcgcHJpbWl0aXZlLiBNb3N0IGNhbGxlcnMgc2hvdWxkXG4gICAqIHVzZSBgcmVhZFN0cmluZygnXFxuJylgIGluc3RlYWQgb3IgdXNlIGEgU2Nhbm5lci5cbiAgICpcbiAgICogYHJlYWRMaW5lKClgIHRyaWVzIHRvIHJldHVybiBhIHNpbmdsZSBsaW5lLCBub3QgaW5jbHVkaW5nIHRoZSBlbmQtb2YtbGluZVxuICAgKiBieXRlcy4gSWYgdGhlIGxpbmUgd2FzIHRvbyBsb25nIGZvciB0aGUgYnVmZmVyIHRoZW4gYG1vcmVgIGlzIHNldCBhbmQgdGhlXG4gICAqIGJlZ2lubmluZyBvZiB0aGUgbGluZSBpcyByZXR1cm5lZC4gVGhlIHJlc3Qgb2YgdGhlIGxpbmUgd2lsbCBiZSByZXR1cm5lZFxuICAgKiBmcm9tIGZ1dHVyZSBjYWxscy4gYG1vcmVgIHdpbGwgYmUgZmFsc2Ugd2hlbiByZXR1cm5pbmcgdGhlIGxhc3QgZnJhZ21lbnRcbiAgICogb2YgdGhlIGxpbmUuIFRoZSByZXR1cm5lZCBidWZmZXIgaXMgb25seSB2YWxpZCB1bnRpbCB0aGUgbmV4dCBjYWxsIHRvXG4gICAqIGByZWFkTGluZSgpYC5cbiAgICpcbiAgICogVGhlIHRleHQgcmV0dXJuZWQgZnJvbSBSZWFkTGluZSBkb2VzIG5vdCBpbmNsdWRlIHRoZSBsaW5lIGVuZCAoXCJcXHJcXG5cIiBvclxuICAgKiBcIlxcblwiKS5cbiAgICpcbiAgICogV2hlbiB0aGUgZW5kIG9mIHRoZSB1bmRlcmx5aW5nIHN0cmVhbSBpcyByZWFjaGVkLCB0aGUgZmluYWwgYnl0ZXMgaW4gdGhlXG4gICAqIHN0cmVhbSBhcmUgcmV0dXJuZWQuIE5vIGluZGljYXRpb24gb3IgZXJyb3IgaXMgZ2l2ZW4gaWYgdGhlIGlucHV0IGVuZHNcbiAgICogd2l0aG91dCBhIGZpbmFsIGxpbmUgZW5kLiBXaGVuIHRoZXJlIGFyZSBubyBtb3JlIHRyYWlsaW5nIGJ5dGVzIHRvIHJlYWQsXG4gICAqIGByZWFkTGluZSgpYCByZXR1cm5zIGBudWxsYC5cbiAgICpcbiAgICogQ2FsbGluZyBgdW5yZWFkQnl0ZSgpYCBhZnRlciBgcmVhZExpbmUoKWAgd2lsbCBhbHdheXMgdW5yZWFkIHRoZSBsYXN0IGJ5dGVcbiAgICogcmVhZCAocG9zc2libHkgYSBjaGFyYWN0ZXIgYmVsb25naW5nIHRvIHRoZSBsaW5lIGVuZCkgZXZlbiBpZiB0aGF0IGJ5dGUgaXNcbiAgICogbm90IHBhcnQgb2YgdGhlIGxpbmUgcmV0dXJuZWQgYnkgYHJlYWRMaW5lKClgLlxuICAgKi9cbiAgYXN5bmMgcmVhZExpbmUoKTogUHJvbWlzZTxSZWFkTGluZVJlc3VsdCB8IG51bGw+IHtcbiAgICBsZXQgbGluZTogVWludDhBcnJheSB8IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgbGluZSA9IGF3YWl0IHRoaXMucmVhZFNsaWNlKExGKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxldCB7IHBhcnRpYWwgfSA9IGVycjtcbiAgICAgIGFzc2VydChcbiAgICAgICAgcGFydGlhbCBpbnN0YW5jZW9mIFVpbnQ4QXJyYXksXG4gICAgICAgIFwiYnVmaW86IGNhdWdodCBlcnJvciBmcm9tIGByZWFkU2xpY2UoKWAgd2l0aG91dCBgcGFydGlhbGAgcHJvcGVydHlcIixcbiAgICAgICk7XG5cbiAgICAgIC8vIERvbid0IHRocm93IGlmIGByZWFkU2xpY2UoKWAgZmFpbGVkIHdpdGggYEJ1ZmZlckZ1bGxFcnJvcmAsIGluc3RlYWQgd2VcbiAgICAgIC8vIGp1c3QgcmV0dXJuIHdoYXRldmVyIGlzIGF2YWlsYWJsZSBhbmQgc2V0IHRoZSBgbW9yZWAgZmxhZy5cbiAgICAgIGlmICghKGVyciBpbnN0YW5jZW9mIEJ1ZmZlckZ1bGxFcnJvcikpIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuXG4gICAgICAvLyBIYW5kbGUgdGhlIGNhc2Ugd2hlcmUgXCJcXHJcXG5cIiBzdHJhZGRsZXMgdGhlIGJ1ZmZlci5cbiAgICAgIGlmIChcbiAgICAgICAgIXRoaXMuZW9mICYmXG4gICAgICAgIHBhcnRpYWwuYnl0ZUxlbmd0aCA+IDAgJiZcbiAgICAgICAgcGFydGlhbFtwYXJ0aWFsLmJ5dGVMZW5ndGggLSAxXSA9PT0gQ1JcbiAgICAgICkge1xuICAgICAgICAvLyBQdXQgdGhlICdcXHInIGJhY2sgb24gYnVmIGFuZCBkcm9wIGl0IGZyb20gbGluZS5cbiAgICAgICAgLy8gTGV0IHRoZSBuZXh0IGNhbGwgdG8gUmVhZExpbmUgY2hlY2sgZm9yIFwiXFxyXFxuXCIuXG4gICAgICAgIGFzc2VydCh0aGlzLnIgPiAwLCBcImJ1ZmlvOiB0cmllZCB0byByZXdpbmQgcGFzdCBzdGFydCBvZiBidWZmZXJcIik7XG4gICAgICAgIHRoaXMuci0tO1xuICAgICAgICBwYXJ0aWFsID0gcGFydGlhbC5zdWJhcnJheSgwLCBwYXJ0aWFsLmJ5dGVMZW5ndGggLSAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgbGluZTogcGFydGlhbCwgbW9yZTogIXRoaXMuZW9mIH07XG4gICAgfVxuXG4gICAgaWYgKGxpbmUgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmIChsaW5lLmJ5dGVMZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7IGxpbmUsIG1vcmU6IGZhbHNlIH07XG4gICAgfVxuXG4gICAgaWYgKGxpbmVbbGluZS5ieXRlTGVuZ3RoIC0gMV0gPT0gTEYpIHtcbiAgICAgIGxldCBkcm9wID0gMTtcbiAgICAgIGlmIChsaW5lLmJ5dGVMZW5ndGggPiAxICYmIGxpbmVbbGluZS5ieXRlTGVuZ3RoIC0gMl0gPT09IENSKSB7XG4gICAgICAgIGRyb3AgPSAyO1xuICAgICAgfVxuICAgICAgbGluZSA9IGxpbmUuc3ViYXJyYXkoMCwgbGluZS5ieXRlTGVuZ3RoIC0gZHJvcCk7XG4gICAgfVxuICAgIHJldHVybiB7IGxpbmUsIG1vcmU6IGZhbHNlIH07XG4gIH1cblxuICAvKiogYHJlYWRTbGljZSgpYCByZWFkcyB1bnRpbCB0aGUgZmlyc3Qgb2NjdXJyZW5jZSBvZiBgZGVsaW1gIGluIHRoZSBpbnB1dCxcbiAgICogcmV0dXJuaW5nIGEgc2xpY2UgcG9pbnRpbmcgYXQgdGhlIGJ5dGVzIGluIHRoZSBidWZmZXIuIFRoZSBieXRlcyBzdG9wXG4gICAqIGJlaW5nIHZhbGlkIGF0IHRoZSBuZXh0IHJlYWQuXG4gICAqXG4gICAqIElmIGByZWFkU2xpY2UoKWAgZW5jb3VudGVycyBhbiBlcnJvciBiZWZvcmUgZmluZGluZyBhIGRlbGltaXRlciwgb3IgdGhlXG4gICAqIGJ1ZmZlciBmaWxscyB3aXRob3V0IGZpbmRpbmcgYSBkZWxpbWl0ZXIsIGl0IHRocm93cyBhbiBlcnJvciB3aXRoIGFcbiAgICogYHBhcnRpYWxgIHByb3BlcnR5IHRoYXQgY29udGFpbnMgdGhlIGVudGlyZSBidWZmZXIuXG4gICAqXG4gICAqIElmIGByZWFkU2xpY2UoKWAgZW5jb3VudGVycyB0aGUgZW5kIG9mIHRoZSB1bmRlcmx5aW5nIHN0cmVhbSBhbmQgdGhlcmUgYXJlXG4gICAqIGFueSBieXRlcyBsZWZ0IGluIHRoZSBidWZmZXIsIHRoZSByZXN0IG9mIHRoZSBidWZmZXIgaXMgcmV0dXJuZWQuIEluIG90aGVyXG4gICAqIHdvcmRzLCBFT0YgaXMgYWx3YXlzIHRyZWF0ZWQgYXMgYSBkZWxpbWl0ZXIuIE9uY2UgdGhlIGJ1ZmZlciBpcyBlbXB0eSxcbiAgICogaXQgcmV0dXJucyBgbnVsbGAuXG4gICAqXG4gICAqIEJlY2F1c2UgdGhlIGRhdGEgcmV0dXJuZWQgZnJvbSBgcmVhZFNsaWNlKClgIHdpbGwgYmUgb3ZlcndyaXR0ZW4gYnkgdGhlXG4gICAqIG5leHQgSS9PIG9wZXJhdGlvbiwgbW9zdCBjbGllbnRzIHNob3VsZCB1c2UgYHJlYWRTdHJpbmcoKWAgaW5zdGVhZC5cbiAgICovXG4gIGFzeW5jIHJlYWRTbGljZShkZWxpbTogbnVtYmVyKTogUHJvbWlzZTxVaW50OEFycmF5IHwgbnVsbD4ge1xuICAgIGxldCBzID0gMDsgLy8gc2VhcmNoIHN0YXJ0IGluZGV4XG4gICAgbGV0IHNsaWNlOiBVaW50OEFycmF5IHwgdW5kZWZpbmVkO1xuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIC8vIFNlYXJjaCBidWZmZXIuXG4gICAgICBsZXQgaSA9IHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciArIHMsIHRoaXMudykuaW5kZXhPZihkZWxpbSk7XG4gICAgICBpZiAoaSA+PSAwKSB7XG4gICAgICAgIGkgKz0gcztcbiAgICAgICAgc2xpY2UgPSB0aGlzLmJ1Zi5zdWJhcnJheSh0aGlzLnIsIHRoaXMuciArIGkgKyAxKTtcbiAgICAgICAgdGhpcy5yICs9IGkgKyAxO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgLy8gRU9GP1xuICAgICAgaWYgKHRoaXMuZW9mKSB7XG4gICAgICAgIGlmICh0aGlzLnIgPT09IHRoaXMudykge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHNsaWNlID0gdGhpcy5idWYuc3ViYXJyYXkodGhpcy5yLCB0aGlzLncpO1xuICAgICAgICB0aGlzLnIgPSB0aGlzLnc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICAvLyBCdWZmZXIgZnVsbD9cbiAgICAgIGlmICh0aGlzLmJ1ZmZlcmVkKCkgPj0gdGhpcy5idWYuYnl0ZUxlbmd0aCkge1xuICAgICAgICB0aGlzLnIgPSB0aGlzLnc7XG4gICAgICAgIC8vICM0NTIxIFRoZSBpbnRlcm5hbCBidWZmZXIgc2hvdWxkIG5vdCBiZSByZXVzZWQgYWNyb3NzIHJlYWRzIGJlY2F1c2UgaXQgY2F1c2VzIGNvcnJ1cHRpb24gb2YgZGF0YS5cbiAgICAgICAgY29uc3Qgb2xkYnVmID0gdGhpcy5idWY7XG4gICAgICAgIGNvbnN0IG5ld2J1ZiA9IHRoaXMuYnVmLnNsaWNlKDApO1xuICAgICAgICB0aGlzLmJ1ZiA9IG5ld2J1ZjtcbiAgICAgICAgdGhyb3cgbmV3IEJ1ZmZlckZ1bGxFcnJvcihvbGRidWYpO1xuICAgICAgfVxuXG4gICAgICBzID0gdGhpcy53IC0gdGhpcy5yOyAvLyBkbyBub3QgcmVzY2FuIGFyZWEgd2Ugc2Nhbm5lZCBiZWZvcmVcblxuICAgICAgLy8gQnVmZmVyIGlzIG5vdCBmdWxsLlxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZmlsbCgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGVyci5wYXJ0aWFsID0gc2xpY2U7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgbGFzdCBieXRlLCBpZiBhbnkuXG4gICAgLy8gY29uc3QgaSA9IHNsaWNlLmJ5dGVMZW5ndGggLSAxO1xuICAgIC8vIGlmIChpID49IDApIHtcbiAgICAvLyAgIHRoaXMubGFzdEJ5dGUgPSBzbGljZVtpXTtcbiAgICAvLyAgIHRoaXMubGFzdENoYXJTaXplID0gLTFcbiAgICAvLyB9XG5cbiAgICByZXR1cm4gc2xpY2U7XG4gIH1cblxuICAvKiogYHBlZWsoKWAgcmV0dXJucyB0aGUgbmV4dCBgbmAgYnl0ZXMgd2l0aG91dCBhZHZhbmNpbmcgdGhlIHJlYWRlci4gVGhlXG4gICAqIGJ5dGVzIHN0b3AgYmVpbmcgdmFsaWQgYXQgdGhlIG5leHQgcmVhZCBjYWxsLlxuICAgKlxuICAgKiBXaGVuIHRoZSBlbmQgb2YgdGhlIHVuZGVybHlpbmcgc3RyZWFtIGlzIHJlYWNoZWQsIGJ1dCB0aGVyZSBhcmUgdW5yZWFkXG4gICAqIGJ5dGVzIGxlZnQgaW4gdGhlIGJ1ZmZlciwgdGhvc2UgYnl0ZXMgYXJlIHJldHVybmVkLiBJZiB0aGVyZSBhcmUgbm8gYnl0ZXNcbiAgICogbGVmdCBpbiB0aGUgYnVmZmVyLCBpdCByZXR1cm5zIGBudWxsYC5cbiAgICpcbiAgICogSWYgYW4gZXJyb3IgaXMgZW5jb3VudGVyZWQgYmVmb3JlIGBuYCBieXRlcyBhcmUgYXZhaWxhYmxlLCBgcGVlaygpYCB0aHJvd3NcbiAgICogYW4gZXJyb3Igd2l0aCB0aGUgYHBhcnRpYWxgIHByb3BlcnR5IHNldCB0byBhIHNsaWNlIG9mIHRoZSBidWZmZXIgdGhhdFxuICAgKiBjb250YWlucyB0aGUgYnl0ZXMgdGhhdCB3ZXJlIGF2YWlsYWJsZSBiZWZvcmUgdGhlIGVycm9yIG9jY3VycmVkLlxuICAgKi9cbiAgYXN5bmMgcGVlayhuOiBudW1iZXIpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgaWYgKG4gPCAwKSB7XG4gICAgICB0aHJvdyBFcnJvcihcIm5lZ2F0aXZlIGNvdW50XCIpO1xuICAgIH1cblxuICAgIGxldCBhdmFpbCA9IHRoaXMudyAtIHRoaXMucjtcbiAgICB3aGlsZSAoYXZhaWwgPCBuICYmIGF2YWlsIDwgdGhpcy5idWYuYnl0ZUxlbmd0aCAmJiAhdGhpcy5lb2YpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2ZpbGwoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBlcnIucGFydGlhbCA9IHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy53KTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgICAgYXZhaWwgPSB0aGlzLncgLSB0aGlzLnI7XG4gICAgfVxuXG4gICAgaWYgKGF2YWlsID09PSAwICYmIHRoaXMuZW9mKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGF2YWlsIDwgbiAmJiB0aGlzLmVvZikge1xuICAgICAgcmV0dXJuIHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy5yICsgYXZhaWwpO1xuICAgIH0gZWxzZSBpZiAoYXZhaWwgPCBuKSB7XG4gICAgICB0aHJvdyBuZXcgQnVmZmVyRnVsbEVycm9yKHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy53KSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy5yICsgbik7XG4gIH1cbn1cblxuYWJzdHJhY3QgY2xhc3MgQWJzdHJhY3RCdWZCYXNlIHtcbiAgYnVmITogVWludDhBcnJheTtcbiAgdXNlZEJ1ZmZlckJ5dGVzID0gMDtcbiAgZXJyOiBFcnJvciB8IG51bGwgPSBudWxsO1xuXG4gIC8qKiBTaXplIHJldHVybnMgdGhlIHNpemUgb2YgdGhlIHVuZGVybHlpbmcgYnVmZmVyIGluIGJ5dGVzLiAqL1xuICBzaXplKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYnVmLmJ5dGVMZW5ndGg7XG4gIH1cblxuICAvKiogUmV0dXJucyBob3cgbWFueSBieXRlcyBhcmUgdW51c2VkIGluIHRoZSBidWZmZXIuICovXG4gIGF2YWlsYWJsZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmJ1Zi5ieXRlTGVuZ3RoIC0gdGhpcy51c2VkQnVmZmVyQnl0ZXM7XG4gIH1cblxuICAvKiogYnVmZmVyZWQgcmV0dXJucyB0aGUgbnVtYmVyIG9mIGJ5dGVzIHRoYXQgaGF2ZSBiZWVuIHdyaXR0ZW4gaW50byB0aGVcbiAgICogY3VycmVudCBidWZmZXIuXG4gICAqL1xuICBidWZmZXJlZCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnVzZWRCdWZmZXJCeXRlcztcbiAgfVxufVxuXG4vKiogQnVmV3JpdGVyIGltcGxlbWVudHMgYnVmZmVyaW5nIGZvciBhbiBkZW5vLldyaXRlciBvYmplY3QuXG4gKiBJZiBhbiBlcnJvciBvY2N1cnMgd3JpdGluZyB0byBhIFdyaXRlciwgbm8gbW9yZSBkYXRhIHdpbGwgYmVcbiAqIGFjY2VwdGVkIGFuZCBhbGwgc3Vic2VxdWVudCB3cml0ZXMsIGFuZCBmbHVzaCgpLCB3aWxsIHJldHVybiB0aGUgZXJyb3IuXG4gKiBBZnRlciBhbGwgZGF0YSBoYXMgYmVlbiB3cml0dGVuLCB0aGUgY2xpZW50IHNob3VsZCBjYWxsIHRoZVxuICogZmx1c2goKSBtZXRob2QgdG8gZ3VhcmFudGVlIGFsbCBkYXRhIGhhcyBiZWVuIGZvcndhcmRlZCB0b1xuICogdGhlIHVuZGVybHlpbmcgZGVuby5Xcml0ZXIuXG4gKi9cbmV4cG9ydCBjbGFzcyBCdWZXcml0ZXIgZXh0ZW5kcyBBYnN0cmFjdEJ1ZkJhc2UgaW1wbGVtZW50cyBXcml0ZXIge1xuICAvKiogcmV0dXJuIG5ldyBCdWZXcml0ZXIgdW5sZXNzIHdyaXRlciBpcyBCdWZXcml0ZXIgKi9cbiAgc3RhdGljIGNyZWF0ZSh3cml0ZXI6IFdyaXRlciwgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSk6IEJ1ZldyaXRlciB7XG4gICAgcmV0dXJuIHdyaXRlciBpbnN0YW5jZW9mIEJ1ZldyaXRlciA/IHdyaXRlciA6IG5ldyBCdWZXcml0ZXIod3JpdGVyLCBzaXplKTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgd3JpdGVyOiBXcml0ZXIsIHNpemU6IG51bWJlciA9IERFRkFVTFRfQlVGX1NJWkUpIHtcbiAgICBzdXBlcigpO1xuICAgIGlmIChzaXplIDw9IDApIHtcbiAgICAgIHNpemUgPSBERUZBVUxUX0JVRl9TSVpFO1xuICAgIH1cbiAgICB0aGlzLmJ1ZiA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xuICB9XG5cbiAgLyoqIERpc2NhcmRzIGFueSB1bmZsdXNoZWQgYnVmZmVyZWQgZGF0YSwgY2xlYXJzIGFueSBlcnJvciwgYW5kXG4gICAqIHJlc2V0cyBidWZmZXIgdG8gd3JpdGUgaXRzIG91dHB1dCB0byB3LlxuICAgKi9cbiAgcmVzZXQodzogV3JpdGVyKTogdm9pZCB7XG4gICAgdGhpcy5lcnIgPSBudWxsO1xuICAgIHRoaXMudXNlZEJ1ZmZlckJ5dGVzID0gMDtcbiAgICB0aGlzLndyaXRlciA9IHc7XG4gIH1cblxuICAvKiogRmx1c2ggd3JpdGVzIGFueSBidWZmZXJlZCBkYXRhIHRvIHRoZSB1bmRlcmx5aW5nIGlvLldyaXRlci4gKi9cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuZXJyICE9PSBudWxsKSB0aHJvdyB0aGlzLmVycjtcbiAgICBpZiAodGhpcy51c2VkQnVmZmVyQnl0ZXMgPT09IDApIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUFsbChcbiAgICAgICAgdGhpcy53cml0ZXIsXG4gICAgICAgIHRoaXMuYnVmLnN1YmFycmF5KDAsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKSxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5lcnIgPSBlO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMuYnVmLmxlbmd0aCk7XG4gICAgdGhpcy51c2VkQnVmZmVyQnl0ZXMgPSAwO1xuICB9XG5cbiAgLyoqIFdyaXRlcyB0aGUgY29udGVudHMgb2YgYGRhdGFgIGludG8gdGhlIGJ1ZmZlci4gIElmIHRoZSBjb250ZW50cyB3b24ndCBmdWxseVxuICAgKiBmaXQgaW50byB0aGUgYnVmZmVyLCB0aG9zZSBieXRlcyB0aGF0IGNhbiBhcmUgY29waWVkIGludG8gdGhlIGJ1ZmZlciwgdGhlXG4gICAqIGJ1ZmZlciBpcyB0aGUgZmx1c2hlZCB0byB0aGUgd3JpdGVyIGFuZCB0aGUgcmVtYWluaW5nIGJ5dGVzIGFyZSBjb3BpZWQgaW50b1xuICAgKiB0aGUgbm93IGVtcHR5IGJ1ZmZlci5cbiAgICpcbiAgICogQHJldHVybiB0aGUgbnVtYmVyIG9mIGJ5dGVzIHdyaXR0ZW4gdG8gdGhlIGJ1ZmZlci5cbiAgICovXG4gIGFzeW5jIHdyaXRlKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGlmICh0aGlzLmVyciAhPT0gbnVsbCkgdGhyb3cgdGhpcy5lcnI7XG4gICAgaWYgKGRhdGEubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcblxuICAgIGxldCB0b3RhbEJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgbGV0IG51bUJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgd2hpbGUgKGRhdGEuYnl0ZUxlbmd0aCA+IHRoaXMuYXZhaWxhYmxlKCkpIHtcbiAgICAgIGlmICh0aGlzLmJ1ZmZlcmVkKCkgPT09IDApIHtcbiAgICAgICAgLy8gTGFyZ2Ugd3JpdGUsIGVtcHR5IGJ1ZmZlci5cbiAgICAgICAgLy8gV3JpdGUgZGlyZWN0bHkgZnJvbSBkYXRhIHRvIGF2b2lkIGNvcHkuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbnVtQnl0ZXNXcml0dGVuID0gYXdhaXQgdGhpcy53cml0ZXIud3JpdGUoZGF0YSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICB0aGlzLmVyciA9IGU7XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbnVtQnl0ZXNXcml0dGVuID0gY29weShkYXRhLCB0aGlzLmJ1ZiwgdGhpcy51c2VkQnVmZmVyQnl0ZXMpO1xuICAgICAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgICAgIGF3YWl0IHRoaXMuZmx1c2goKTtcbiAgICAgIH1cbiAgICAgIHRvdGFsQnl0ZXNXcml0dGVuICs9IG51bUJ5dGVzV3JpdHRlbjtcbiAgICAgIGRhdGEgPSBkYXRhLnN1YmFycmF5KG51bUJ5dGVzV3JpdHRlbik7XG4gICAgfVxuXG4gICAgbnVtQnl0ZXNXcml0dGVuID0gY29weShkYXRhLCB0aGlzLmJ1ZiwgdGhpcy51c2VkQnVmZmVyQnl0ZXMpO1xuICAgIHRoaXMudXNlZEJ1ZmZlckJ5dGVzICs9IG51bUJ5dGVzV3JpdHRlbjtcbiAgICB0b3RhbEJ5dGVzV3JpdHRlbiArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgcmV0dXJuIHRvdGFsQnl0ZXNXcml0dGVuO1xuICB9XG59XG5cbi8qKiBCdWZXcml0ZXJTeW5jIGltcGxlbWVudHMgYnVmZmVyaW5nIGZvciBhIGRlbm8uV3JpdGVyU3luYyBvYmplY3QuXG4gKiBJZiBhbiBlcnJvciBvY2N1cnMgd3JpdGluZyB0byBhIFdyaXRlclN5bmMsIG5vIG1vcmUgZGF0YSB3aWxsIGJlXG4gKiBhY2NlcHRlZCBhbmQgYWxsIHN1YnNlcXVlbnQgd3JpdGVzLCBhbmQgZmx1c2goKSwgd2lsbCByZXR1cm4gdGhlIGVycm9yLlxuICogQWZ0ZXIgYWxsIGRhdGEgaGFzIGJlZW4gd3JpdHRlbiwgdGhlIGNsaWVudCBzaG91bGQgY2FsbCB0aGVcbiAqIGZsdXNoKCkgbWV0aG9kIHRvIGd1YXJhbnRlZSBhbGwgZGF0YSBoYXMgYmVlbiBmb3J3YXJkZWQgdG9cbiAqIHRoZSB1bmRlcmx5aW5nIGRlbm8uV3JpdGVyU3luYy5cbiAqL1xuZXhwb3J0IGNsYXNzIEJ1ZldyaXRlclN5bmMgZXh0ZW5kcyBBYnN0cmFjdEJ1ZkJhc2UgaW1wbGVtZW50cyBXcml0ZXJTeW5jIHtcbiAgLyoqIHJldHVybiBuZXcgQnVmV3JpdGVyU3luYyB1bmxlc3Mgd3JpdGVyIGlzIEJ1ZldyaXRlclN5bmMgKi9cbiAgc3RhdGljIGNyZWF0ZShcbiAgICB3cml0ZXI6IFdyaXRlclN5bmMsXG4gICAgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSxcbiAgKTogQnVmV3JpdGVyU3luYyB7XG4gICAgcmV0dXJuIHdyaXRlciBpbnN0YW5jZW9mIEJ1ZldyaXRlclN5bmNcbiAgICAgID8gd3JpdGVyXG4gICAgICA6IG5ldyBCdWZXcml0ZXJTeW5jKHdyaXRlciwgc2l6ZSk7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHdyaXRlcjogV3JpdGVyU3luYywgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSkge1xuICAgIHN1cGVyKCk7XG4gICAgaWYgKHNpemUgPD0gMCkge1xuICAgICAgc2l6ZSA9IERFRkFVTFRfQlVGX1NJWkU7XG4gICAgfVxuICAgIHRoaXMuYnVmID0gbmV3IFVpbnQ4QXJyYXkoc2l6ZSk7XG4gIH1cblxuICAvKiogRGlzY2FyZHMgYW55IHVuZmx1c2hlZCBidWZmZXJlZCBkYXRhLCBjbGVhcnMgYW55IGVycm9yLCBhbmRcbiAgICogcmVzZXRzIGJ1ZmZlciB0byB3cml0ZSBpdHMgb3V0cHV0IHRvIHcuXG4gICAqL1xuICByZXNldCh3OiBXcml0ZXJTeW5jKTogdm9pZCB7XG4gICAgdGhpcy5lcnIgPSBudWxsO1xuICAgIHRoaXMudXNlZEJ1ZmZlckJ5dGVzID0gMDtcbiAgICB0aGlzLndyaXRlciA9IHc7XG4gIH1cblxuICAvKiogRmx1c2ggd3JpdGVzIGFueSBidWZmZXJlZCBkYXRhIHRvIHRoZSB1bmRlcmx5aW5nIGlvLldyaXRlclN5bmMuICovXG4gIGZsdXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmVyciAhPT0gbnVsbCkgdGhyb3cgdGhpcy5lcnI7XG4gICAgaWYgKHRoaXMudXNlZEJ1ZmZlckJ5dGVzID09PSAwKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgd3JpdGVBbGxTeW5jKFxuICAgICAgICB0aGlzLndyaXRlcixcbiAgICAgICAgdGhpcy5idWYuc3ViYXJyYXkoMCwgdGhpcy51c2VkQnVmZmVyQnl0ZXMpLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmVyciA9IGU7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cblxuICAgIHRoaXMuYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5idWYubGVuZ3RoKTtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyA9IDA7XG4gIH1cblxuICAvKiogV3JpdGVzIHRoZSBjb250ZW50cyBvZiBgZGF0YWAgaW50byB0aGUgYnVmZmVyLiAgSWYgdGhlIGNvbnRlbnRzIHdvbid0IGZ1bGx5XG4gICAqIGZpdCBpbnRvIHRoZSBidWZmZXIsIHRob3NlIGJ5dGVzIHRoYXQgY2FuIGFyZSBjb3BpZWQgaW50byB0aGUgYnVmZmVyLCB0aGVcbiAgICogYnVmZmVyIGlzIHRoZSBmbHVzaGVkIHRvIHRoZSB3cml0ZXIgYW5kIHRoZSByZW1haW5pbmcgYnl0ZXMgYXJlIGNvcGllZCBpbnRvXG4gICAqIHRoZSBub3cgZW1wdHkgYnVmZmVyLlxuICAgKlxuICAgKiBAcmV0dXJuIHRoZSBudW1iZXIgb2YgYnl0ZXMgd3JpdHRlbiB0byB0aGUgYnVmZmVyLlxuICAgKi9cbiAgd3JpdGVTeW5jKGRhdGE6IFVpbnQ4QXJyYXkpOiBudW1iZXIge1xuICAgIGlmICh0aGlzLmVyciAhPT0gbnVsbCkgdGhyb3cgdGhpcy5lcnI7XG4gICAgaWYgKGRhdGEubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcblxuICAgIGxldCB0b3RhbEJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgbGV0IG51bUJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgd2hpbGUgKGRhdGEuYnl0ZUxlbmd0aCA+IHRoaXMuYXZhaWxhYmxlKCkpIHtcbiAgICAgIGlmICh0aGlzLmJ1ZmZlcmVkKCkgPT09IDApIHtcbiAgICAgICAgLy8gTGFyZ2Ugd3JpdGUsIGVtcHR5IGJ1ZmZlci5cbiAgICAgICAgLy8gV3JpdGUgZGlyZWN0bHkgZnJvbSBkYXRhIHRvIGF2b2lkIGNvcHkuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbnVtQnl0ZXNXcml0dGVuID0gdGhpcy53cml0ZXIud3JpdGVTeW5jKGRhdGEpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgdGhpcy5lcnIgPSBlO1xuICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICAgICAgdGhpcy51c2VkQnVmZmVyQnl0ZXMgKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgICAgICB0aGlzLmZsdXNoKCk7XG4gICAgICB9XG4gICAgICB0b3RhbEJ5dGVzV3JpdHRlbiArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgICBkYXRhID0gZGF0YS5zdWJhcnJheShudW1CeXRlc1dyaXR0ZW4pO1xuICAgIH1cblxuICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgdG90YWxCeXRlc1dyaXR0ZW4gKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgIHJldHVybiB0b3RhbEJ5dGVzV3JpdHRlbjtcbiAgfVxufVxuXG4vKiogR2VuZXJhdGUgbG9uZ2VzdCBwcm9wZXIgcHJlZml4IHdoaWNoIGlzIGFsc28gc3VmZml4IGFycmF5LiAqL1xuZnVuY3Rpb24gY3JlYXRlTFBTKHBhdDogVWludDhBcnJheSk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBscHMgPSBuZXcgVWludDhBcnJheShwYXQubGVuZ3RoKTtcbiAgbHBzWzBdID0gMDtcbiAgbGV0IHByZWZpeEVuZCA9IDA7XG4gIGxldCBpID0gMTtcbiAgd2hpbGUgKGkgPCBscHMubGVuZ3RoKSB7XG4gICAgaWYgKHBhdFtpXSA9PSBwYXRbcHJlZml4RW5kXSkge1xuICAgICAgcHJlZml4RW5kKys7XG4gICAgICBscHNbaV0gPSBwcmVmaXhFbmQ7XG4gICAgICBpKys7XG4gICAgfSBlbHNlIGlmIChwcmVmaXhFbmQgPT09IDApIHtcbiAgICAgIGxwc1tpXSA9IDA7XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZWZpeEVuZCA9IHBhdFtwcmVmaXhFbmQgLSAxXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxwcztcbn1cblxuLyoqIFJlYWQgZGVsaW1pdGVkIGJ5dGVzIGZyb20gYSBSZWFkZXIuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24qIHJlYWREZWxpbShcbiAgcmVhZGVyOiBSZWFkZXIsXG4gIGRlbGltOiBVaW50OEFycmF5LFxuKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFVpbnQ4QXJyYXk+IHtcbiAgLy8gQXZvaWQgdW5pY29kZSBwcm9ibGVtc1xuICBjb25zdCBkZWxpbUxlbiA9IGRlbGltLmxlbmd0aDtcbiAgY29uc3QgZGVsaW1MUFMgPSBjcmVhdGVMUFMoZGVsaW0pO1xuXG4gIGxldCBpbnB1dEJ1ZmZlciA9IG5ldyBCdWZmZXIoKTtcbiAgY29uc3QgaW5zcGVjdEFyciA9IG5ldyBVaW50OEFycmF5KE1hdGgubWF4KDEwMjQsIGRlbGltTGVuICsgMSkpO1xuXG4gIC8vIE1vZGlmaWVkIEtNUFxuICBsZXQgaW5zcGVjdEluZGV4ID0gMDtcbiAgbGV0IG1hdGNoSW5kZXggPSAwO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlYWRlci5yZWFkKGluc3BlY3RBcnIpO1xuICAgIGlmIChyZXN1bHQgPT09IG51bGwpIHtcbiAgICAgIC8vIFlpZWxkIGxhc3QgY2h1bmsuXG4gICAgICB5aWVsZCBpbnB1dEJ1ZmZlci5ieXRlcygpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoKHJlc3VsdCBhcyBudW1iZXIpIDwgMCkge1xuICAgICAgLy8gRGlzY2FyZCBhbGwgcmVtYWluaW5nIGFuZCBzaWxlbnRseSBmYWlsLlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBzbGljZVJlYWQgPSBpbnNwZWN0QXJyLnN1YmFycmF5KDAsIHJlc3VsdCBhcyBudW1iZXIpO1xuICAgIGF3YWl0IHdyaXRlQWxsKGlucHV0QnVmZmVyLCBzbGljZVJlYWQpO1xuXG4gICAgbGV0IHNsaWNlVG9Qcm9jZXNzID0gaW5wdXRCdWZmZXIuYnl0ZXMoKTtcbiAgICB3aGlsZSAoaW5zcGVjdEluZGV4IDwgc2xpY2VUb1Byb2Nlc3MubGVuZ3RoKSB7XG4gICAgICBpZiAoc2xpY2VUb1Byb2Nlc3NbaW5zcGVjdEluZGV4XSA9PT0gZGVsaW1bbWF0Y2hJbmRleF0pIHtcbiAgICAgICAgaW5zcGVjdEluZGV4Kys7XG4gICAgICAgIG1hdGNoSW5kZXgrKztcbiAgICAgICAgaWYgKG1hdGNoSW5kZXggPT09IGRlbGltTGVuKSB7XG4gICAgICAgICAgLy8gRnVsbCBtYXRjaFxuICAgICAgICAgIGNvbnN0IG1hdGNoRW5kID0gaW5zcGVjdEluZGV4IC0gZGVsaW1MZW47XG4gICAgICAgICAgY29uc3QgcmVhZHlCeXRlcyA9IHNsaWNlVG9Qcm9jZXNzLnN1YmFycmF5KDAsIG1hdGNoRW5kKTtcbiAgICAgICAgICAvLyBDb3B5XG4gICAgICAgICAgY29uc3QgcGVuZGluZ0J5dGVzID0gc2xpY2VUb1Byb2Nlc3Muc2xpY2UoaW5zcGVjdEluZGV4KTtcbiAgICAgICAgICB5aWVsZCByZWFkeUJ5dGVzO1xuICAgICAgICAgIC8vIFJlc2V0IG1hdGNoLCBkaWZmZXJlbnQgZnJvbSBLTVAuXG4gICAgICAgICAgc2xpY2VUb1Byb2Nlc3MgPSBwZW5kaW5nQnl0ZXM7XG4gICAgICAgICAgaW5zcGVjdEluZGV4ID0gMDtcbiAgICAgICAgICBtYXRjaEluZGV4ID0gMDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKG1hdGNoSW5kZXggPT09IDApIHtcbiAgICAgICAgICBpbnNwZWN0SW5kZXgrKztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtYXRjaEluZGV4ID0gZGVsaW1MUFNbbWF0Y2hJbmRleCAtIDFdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEtlZXAgaW5zcGVjdEluZGV4IGFuZCBtYXRjaEluZGV4LlxuICAgIGlucHV0QnVmZmVyID0gbmV3IEJ1ZmZlcihzbGljZVRvUHJvY2Vzcyk7XG4gIH1cbn1cblxuLyoqIFJlYWQgZGVsaW1pdGVkIHN0cmluZ3MgZnJvbSBhIFJlYWRlci4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiogcmVhZFN0cmluZ0RlbGltKFxuICByZWFkZXI6IFJlYWRlcixcbiAgZGVsaW06IHN0cmluZyxcbik6IEFzeW5jSXRlcmFibGVJdGVyYXRvcjxzdHJpbmc+IHtcbiAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKCk7XG4gIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgcmVhZERlbGltKHJlYWRlciwgZW5jb2Rlci5lbmNvZGUoZGVsaW0pKSkge1xuICAgIHlpZWxkIGRlY29kZXIuZGVjb2RlKGNodW5rKTtcbiAgfVxufVxuXG4vKiogUmVhZCBzdHJpbmdzIGxpbmUtYnktbGluZSBmcm9tIGEgUmVhZGVyLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiByZWFkTGluZXMoXG4gIHJlYWRlcjogUmVhZGVyLFxuKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPHN0cmluZz4ge1xuICBmb3IgYXdhaXQgKGxldCBjaHVuayBvZiByZWFkU3RyaW5nRGVsaW0ocmVhZGVyLCBcIlxcblwiKSkge1xuICAgIC8vIEZpbmRpbmcgYSBDUiBhdCB0aGUgZW5kIG9mIHRoZSBsaW5lIGlzIGV2aWRlbmNlIG9mIGFcbiAgICAvLyBcIlxcclxcblwiIGF0IHRoZSBlbmQgb2YgdGhlIGxpbmUuIFRoZSBcIlxcclwiIHBhcnQgc2hvdWxkIGJlXG4gICAgLy8gcmVtb3ZlZCB0b28uXG4gICAgaWYgKGNodW5rLmVuZHNXaXRoKFwiXFxyXCIpKSB7XG4gICAgICBjaHVuayA9IGNodW5rLnNsaWNlKDAsIC0xKTtcbiAgICB9XG4gICAgeWllbGQgY2h1bms7XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSwwRUFBMEU7QUFDMUUsdUVBQXVFO0FBQ3ZFLHNEQUFzRDtBQUN0RCxxREFBcUQ7QUFDckQsaURBQWlEO0FBS2pELFNBQVMsSUFBSSxRQUFRLGtCQUFrQjtBQUN2QyxTQUFTLE1BQU0sUUFBUSxxQkFBcUI7QUFDNUMsU0FBUyxNQUFNLFFBQVEsY0FBYztBQUNyQyxTQUFTLFFBQVEsRUFBRSxZQUFZLFFBQVEsWUFBWTtBQUVuRCxNQUFNLG1CQUFtQjtBQUN6QixNQUFNLGVBQWU7QUFDckIsTUFBTSw4QkFBOEI7QUFDcEMsTUFBTSxLQUFLLEtBQUssVUFBVSxDQUFDO0FBQzNCLE1BQU0sS0FBSyxLQUFLLFVBQVUsQ0FBQztBQUUzQixPQUFPLE1BQU0sd0JBQXdCOztFQUNuQyxLQUF5QjtFQUN6QixZQUFZLEFBQU8sT0FBbUIsQ0FBRTtJQUN0QyxLQUFLLENBQUM7U0FEVyxVQUFBO1NBRG5CLE9BQU87RUFHUDtBQUNGO0FBRUEsT0FBTyxNQUFNLHlCQUF5QjtFQUNwQyxPQUFPLG1CQUFtQjtFQUMxQixRQUFxQjtFQUNyQixhQUFjO0lBQ1osS0FBSyxDQUFDO0VBQ1I7QUFDRjtBQVFBLHdEQUF3RCxHQUN4RCxPQUFPLE1BQU07RUFDSCxJQUFpQjtFQUNq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