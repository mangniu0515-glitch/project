/**
 * jsQR - A QR Code decoding library
 * https://github.com/cozmo/jsQR
 * Version 1.4.0
 */
(function(global, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define(factory);
  } else {
    global.jsQR = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  const DEFAULT_EPI = 0.5;
  const INVALID = NaN;

  const EC_LEVELS = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2
  };

  function BitMatrix(data, width) {
    this.data = data;
    this.width = width;
    this.height = width;
    this.dimension = width;
  }

  BitMatrix.prototype.get = function(x, y) {
    if (x < 0 || this.width <= x || y < 0 || this.height <= y) {
      return false;
    }
    return !!this.data[y * this.width + x];
  };

  BitMatrix.prototype.set = function(x, y, value) {
    this.data[y * this.width + x] = value ? 1 : 0;
  };

  BitMatrix.prototype.clear = function(value) {
    if (value === undefined) {
      value = false;
    }
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = value ? 1 : 0;
    }
  };

  BitMatrix.prototypeRegion = function(top, left, border) {
    if (border === undefined) {
      border = 0;
    }
    const right = top + this.dimension - border;
    const bottom = left + this.dimension - border;
    return new BitMatrix(
      this.data.slice(top * this.width + left, right * this.width + bottom),
      right - left
    );
  };

  function applyRegion(mask, region, topOffset, leftOffset) {
    for (let y = 0; y < region.dimension; y++) {
      for (let x = 0; x < region.dimension; x++) {
        if (!region.get(x, y)) {
          mask.set(x + leftOffset, y + topOffset, false);
        }
      }
    }
  }

  function bitStreamToHex(bitStream) {
    let result = "";
    for (let i = 0; i < bitStream.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        if (bitStream.charAt(i + j) === "1") {
          byte |= 1 << (7 - j);
        }
      }
      result += byte.toString(16).padStart(2, "0");
    }
    return result;
  }

  function decodeUtf8(iso88591) {
    let result = "";
    let i = 0;
    while (i < iso88591.length) {
      let c = iso88591.charCodeAt(i++);
      if (c < 128) {
        result += String.fromCharCode(c);
      } else if (c < 224) {
        result += String.fromCharCode(((c & 0x1f) << 6) | (iso88591.charCodeAt(i++) & 0x3f));
      } else if (c < 240) {
        const c2 = iso88591.charCodeAt(i++);
        result += String.fromCharCode(
          ((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (iso88591.charCodeAt(i++) & 0x3f)
        );
      } else {
        const c2 = iso88591.charCodeAt(i++);
        const c3 = iso88591.charCodeAt(i++);
        result += String.fromCharCode(
          ((c & 0x07) << 18) |
            ((c2 & 0x3f) << 12) |
            ((c3 & 0x3f) << 6) |
            (iso88591.charCodeAt(i++) & 0x3f)
        );
      }
    }
    return result;
  }

  function bitStreamToString(bitStream, bits) {
    let result = "";
    let encodings = [
      { label: "Numeric", minLength: 1, maxLength: 10, bits: 10, count: 10 },
      { label: "Alphanumeric", minLength: 1, maxLength: 9, bits: 9, count: 45 },
      { label: "Byte", minLength: 1, maxLength: 8, bits: 8, count: 256, decode: decodeUtf8 },
      { label: "Kanji", minLength: 1, maxLength: 13, bits: 13, count: 8192 }
    ];
    let encoding = encodings[3];
    let i = 0;
    if (bitStream.length < 4) {
      return { result: "", bits: 0 };
    }
    if (bitStream.substring(0, 4) === "0001") {
      encoding = encodings[0];
      i += 4;
    } else if (bitStream.substring(0, 4) === "0010") {
      encoding = encodings[1];
      i += 4;
    } else if (bitStream.substring(0, 4) === "0100") {
      encoding = encodings[2];
      i += 4;
    } else if (bitStream.substring(0, 4) === "1000") {
      encoding = encodings[3];
      i += 4;
    } else {
      const modeBits = parseInt(bitStream.substring(0, 4), 2);
      if (modeBits >= 1 && modeBits <= 3) {
        return { result: "", bits: 0 };
      }
    }
    let charCountBits = encoding.minLength;
    if (encoding.minLength === 1) {
      charCountBits = 10;
    } else if (encoding.minLength === 9) {
      charCountBits = 9;
    } else if (encoding.minLength === 8) {
      charCountBits = 8;
    } else {
      charCountBits = 13;
    }
    let charCount = parseInt(bitStream.substring(i, i + charCountBits), 2);
    i += charCountBits;
    let data = "";
    while (i < bitStream.length) {
      if (encoding.label === "Numeric") {
        if (charCount >= 3) {
          const num = parseInt(bitStream.substring(i, i + 10), 2);
          data += num.toString().padStart(3, "0");
          charCount -= 3;
          i += 10;
        } else if (charCount === 2) {
          const num = parseInt(bitStream.substring(i, i + 7), 2);
          data += num.toString().padStart(2, "0");
          charCount -= 2;
          i += 7;
          break;
        } else if (charCount === 1) {
          const num = parseInt(bitStream.substring(i, i + 4), 2);
          data += num.toString();
          charCount -= 1;
          i += 4;
          break;
        }
      } else if (encoding.label === "Alphanumeric") {
        if (charCount >= 2) {
          const num = parseInt(bitStream.substring(i, i + 11), 2);
          data += ALPHANUMERIC_CHARS.charAt(Math.floor(num / 45)) + ALPHANUMERIC_CHARS.charAt(num % 45);
          charCount -= 2;
          i += 11;
        } else if (charCount === 1) {
          const num = parseInt(bitStream.substring(i, i + 6), 2);
          data += ALPHANUMERIC_CHARS.charAt(num);
          charCount -= 1;
          i += 6;
          break;
        }
      } else if (encoding.label === "Byte") {
        if (charCount >= 1) {
          const byte = parseInt(bitStream.substring(i, i + 8), 2);
          data += String.fromCharCode(byte);
          charCount--;
          i += 8;
        }
      } else if (encoding.label === "Kanji") {
        if (charCount >= 1) {
          const kanji = parseInt(bitStream.substring(i, i + 13), 2);
          const value = Math.floor(kanji / 0xc0) * 0xc0 + (kanji % 0xc0);
          let resultValue = value + 0x8080;
          if (value >= 0x1f00 && value <= 0x1bbf) {
            resultValue = value + 0x6821;
          }
          const bytes = [(resultValue >> 8) & 0xff, resultValue & 0xff];
          const decoder = new TextDecoder("shift-jis");
          try {
            data += decoder.decode(new Uint8Array(bytes));
          } catch (_a) {
            data += String.fromCharCode(bytes[0], bytes[1]);
          }
          charCount--;
          i += 13;
        }
      }
      if (i >= bitStream.length) {
        break;
      }
      if (bitStream.substring(i, i + 4) !== "0000") {
        break;
      }
      i += 4;
    }
    return { result: encoding.decode ? encoding.decode(data) : data, bits: i };
  }

  const ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function getMatrixdimensions(width) {
    switch (Math.sqrt(width.length / 2) | 0) {
      case 21:
        return { dimension: 21, version: 1 };
      case 25:
        return { dimension: 25, version: 2 };
      case 29:
        return { dimension: 29, version: 3 };
      case 33:
        return { dimension: 33, version: 4 };
      case 37:
        return { dimension: 37, version: 5 };
      case 41:
        return { dimension: 41, version: 6 };
      case 45:
        return { dimension: 45, version: 7 };
      case 49:
        return { dimension: 49, version: 8 };
      case 53:
        return { dimension: 53, version: 9 };
      case 57:
        return { dimension: 57, version: 10 };
      case 61:
        return { dimension: 61, version: 11 };
      case 65:
        return { dimension: 65, version: 12 };
      case 69:
        return { dimension: 69, version: 13 };
      case 73:
        return { dimension: 73, version: 14 };
      case 77:
        return { dimension: 77, version: 15 };
      case 81:
        return { dimension: 81, version: 16 };
      case 85:
        return { dimension: 85, version: 17 };
      case 89:
        return { dimension: 89, version: 18 };
      case 93:
        return { dimension: 93, version: 19 };
      case 97:
        return { dimension: 97, version: 20 };
      case 101:
        return { dimension: 101, version: 21 };
      case 105:
        return { dimension: 105, version: 22 };
      case 109:
        return { dimension: 109, version: 23 };
      case 113:
        return { dimension: 113, version: 24 };
      case 117:
        return { dimension: 117, version: 25 };
      case 121:
        return { dimension: 121, version: 26 };
      case 125:
        return { dimension: 125, version: 27 };
      case 129:
        return { dimension: 129, version: 28 };
      case 133:
        return { dimension: 133, version: 29 };
      case 137:
        return { dimension: 137, version: 30 };
      case 141:
        return { dimension: 141, version: 31 };
      case 145:
        return { dimension: 145, version: 32 };
      case 149:
        return { dimension: 149, version: 33 };
      case 153:
        return { dimension: 153, version: 34 };
      case 157:
        return { dimension: 157, version: 35 };
      case 161:
        return { dimension: 161, version: 36 };
      case 165:
        return { dimension: 165, version: 37 };
      case 169:
        return { dimension: 169, version: 38 };
      case 173:
        return { dimension: 173, version: 39 };
      case 177:
        return { dimension: 177, version: 40 };
      default:
        return { dimension: 21, version: 1 };
    }
  }

  function readCodewords(bits, version, ecLevel) {
    const ecLevelIndex = EC_LEVELS[ecLevel];
    const size = version.dimension;
    const result = new Uint8Array(size * size >> 3);
    let bitOffset = 0;
    let wordOffset = 0;
    const readingUp = true;
    for (let column = size - 1; column >= 0; column -= 2) {
      if (column === 6) {
        column = 5;
      }
      for (let row = readingUp ? size - 1 : 0; readingUp ? row >= 0 : row < size; row += readingUp ? -1 : 1) {
        for (let column2 = 0; column2 < 2; column2++) {
          const x = column - column2;
          const y = row;
          if (!isDataRegion(x, y)) {
            continue;
          }
          if (bits.get(x, y)) {
            result[wordOffset] |= 1 << (7 - bitOffset);
          }
          bitOffset++;
          if (bitOffset === 8) {
            bitOffset = 0;
            wordOffset++;
          }
        }
      }
    }
    return result;
  }

  function isDataRegion(x, y) {
    return (
      (x < 9 && (y < 8 || y >= size - 8)) ||
      (x >= size - 8 && y < 8) ||
      false
    );
  }

  function readBits(bits, from, to) {
    let result = "";
    for (let i = from; i < to; i++) {
      result += bits.get(i % bits.width, Math.floor(i / bits.width)) ? "1" : "0";
    }
    return result;
  }

  function decodeQRCode(matrix, versions, maybeFlipped) {
    let version;
    let top = 0;
    let left = 0;
    if (maybeFlipped) {
      const match = locateQRCode(matrix);
      if (!match) {
        return undefined;
      }
      top = match.top;
      left = match.left;
      const size = Math.max(
        Math.max(match.dimension, locateQRCode(flipMatrix(matrix), false)),
        Math.max(locateQRCode(rotateMatrix90(matrix), false), locateQRCode(rotateMatrix180(matrix), false)),
        Math.max(locateQRCode(rotateMatrix270(matrix), false), locateQRCode(flipMatrix(rotateMatrix90(matrix)), false)),
        locateQRCode(flipMatrix(rotateMatrix270(matrix)), false)
      );
      version = versions[size] || getMatrixdimensions(size);
    } else {
      version = getMatrixdimensions(matrix.width);
    }
    const size = version.dimension;
    const bits = new BitMatrix(new Uint8Array(size * size), size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        bits.set(x, y, matrix.get(left + x, top + y));
      }
    }
    if (bits.get(size - 1, size - 1)) {
      flipMatrix(bits);
    }
    const formatInfo = tryDecodeFormatInfo(bits, version);
    if (!formatInfo) {
      return undefined;
    }
    const data = readCodewords(bits, version, formatInfo.ecLevel);
    return applyDataMask(size, formatInfo.maskPattern, bits, version, data);
  }

  function locateQRCode(matrix) {
    const size = matrix.width;
    let found = false;
    let maxScore = 0;
    let best = { dimension: 0, top: 0, left: 0 };
    for (let y = 0; y < size; y++) {
      let score = 0;
      for (let x = 0; x < size; x++) {
        if (matrix.get(x, y) === (x + y) % 2) {
          score++;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        best.top = y;
      }
    }
    for (let x = 0; x < size; x++) {
      let score = 0;
      for (let y = 0; y < size; y++) {
        if (matrix.get(x, y) === (x + y) % 2) {
          score++;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        best.left = x;
      }
    }
    if (maxScore > size * 0.3) {
      found = true;
      best.dimension = Math.round(size / 7);
    }
    if (!found) {
      return undefined;
    }
    return best;
  }

  function flipMatrix(matrix) {
    for (let y = 0; y < matrix.width; y++) {
      for (let x = y + 1; x < matrix.width; x++) {
        const old = matrix.get(x, y);
        matrix.set(x, y, matrix.get(y, x));
        matrix.set(y, x, old);
      }
    }
  }

  function rotateMatrix90(matrix) {
    const rotated = new BitMatrix(new Uint8Array(matrix.width * matrix.width), matrix.width);
    for (let y = 0; y < matrix.width; y++) {
      for (let x = 0; x < matrix.width; x++) {
        rotated.set(matrix.width - y - 1, x, matrix.get(x, y));
      }
    }
    return rotated;
  }

  function rotateMatrix180(matrix) {
    const rotated = new BitMatrix(new Uint8Array(matrix.width * matrix.width), matrix.width);
    for (let y = 0; y < matrix.width; y++) {
      for (let x = 0; x < matrix.width; x++) {
        rotated.set(matrix.width - x - 1, matrix.width - y - 1, matrix.get(x, y));
      }
    }
    return rotated;
  }

  function rotateMatrix270(matrix) {
    const rotated = new BitMatrix(new Uint8Array(matrix.width * matrix.width), matrix.width);
    for (let y = 0; y < matrix.width; y++) {
      for (let x = 0; x < matrix.width; x++) {
        rotated.set(y, matrix.width - x - 1, matrix.get(x, y));
      }
    }
    return rotated;
  }

  function flipMatrix(matrix) {
    for (let y = 0; y < matrix.width; y++) {
      for (let x = 0; x < matrix.width; x++) {
        matrix.set(x, y, !matrix.get(x, y));
      }
    }
  }

  function tryDecodeFormatInfo(bits, version) {
    for (let i = 0; i < 32; i++) {
      const ecLevel = (i >> 3) & 3;
      const maskPattern = i & 7;
      const data = applyDataMaskAndDecodeFormatInfo(bits, version, maskPattern);
      if (data && data.ecLevel === ecLevel) {
        return data;
      }
    }
    return undefined;
  }

  function applyDataMaskAndDecodeFormatInfo(bits, version, maskPattern) {
    const size = version.dimension;
    const mask = getDataMaskFunction(maskPattern);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isDataModule(x, y, size) && mask(x, y)) {
          bits.set(x, y, !bits.get(x, y));
        }
      }
    }
    let formatInfo;
    try {
      formatInfo = decodeFormatInfo(bits, version);
    } catch (_a) {
      return undefined;
    }
    return formatInfo;
  }

  function isDataModule(x, y, size) {
    return (
      (x < 9 && (y < 8 || y >= size - 8)) ||
      (x >= size - 8 && y < 8) ||
      (x >= size - 8 && y >= size - 8) ||
      false
    );
  }

  function getDataMaskFunction(maskPattern) {
    switch (maskPattern) {
      case 0:
        return (x, y) => (x + y) % 2 === 0;
      case 1:
        return (x, _y) => x % 2 === 0;
      case 2:
        return (_x, y) => y % 3 === 0;
      case 3:
        return (x, y) => (x + y) % 3 === 0;
      case 4:
        return (x, y) => (Math.floor(x / 2) + Math.floor(y / 3)) % 2 === 0;
      case 5:
        return (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7:
        return (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return () => false;
    }
  }

  function decodeFormatInfo(bits, version) {
    const size = version.dimension;
    let formatBits = 0;
    for (let x = 0; x < 6; x++) {
      formatBits = (formatBits << 1) | (bits.get(x, 8) ? 1 : 0);
    }
    formatBits = (formatBits << 1) | (bits.get(8, 7) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(8, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(7, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(5, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(4, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(3, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(2, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(1, 8) ? 1 : 0);
    formatBits = (formatBits << 1) | (bits.get(0, 8) ? 1 : 0);
    for (let y = 9; y < size - 8; y++) {
      formatBits = (formatBits << 1) | (bits.get(8, y) ? 1 : 0);
    }
    for (let x = size - 7; x < size; x++) {
      formatBits = (formatBits << 1) | (bits.get(x, 8) ? 1 : 0);
    }
    let ecLevelBits = (formatBits >> 10) & 3;
    let maskPattern = formatBits & 7;
    const ecLevel = ["L", "M", "Q", "H"][ecLevelBits];
    return { ecLevel, maskPattern };
  }

  function applyDataMask(dimension, maskPattern, bits, version, data) {
    const mask = getDataMaskFunction(maskPattern);
    for (let y = 0; y < dimension; y++) {
      for (let x = 0; x < dimension; x++) {
        if (isDataModule(x, y, dimension) && mask(x, y)) {
          bits.set(x, y, !bits.get(x, y));
        }
      }
    }
    return decodeQRCodeData(data, version);
  }

  function decodeQRCodeData(data, version) {
    const size = version.dimension;
    let bitOffset = 0;
    let charCount = 0;
    const result = [];
    const readingUp = true;
    for (let column = size - 1; column >= 0; column -= 2) {
      if (column === 6) {
        column = 5;
      }
      for (let row = readingUp ? size - 1 : 0; readingUp ? row >= 0 : row < size; row += readingUp ? -1 : 1) {
        for (let column2 = 0; column2 < 2; column2++) {
          const x = column - column2;
          const y = row;
          if (!isDataRegion(x, y)) {
            continue;
          }
          const byteOffset = (y * size + x) >> 3;
          const bitOffset_1 = (y * size + x) & 7;
          const bit = (data[byteOffset] >> (7 - bitOffset_1)) & 1;
          if (bit) {
            result.push("1");
          } else {
            result.push("0");
          }
        }
      }
    }
    const bitStream = result.join("");
    const { result: decoded, bits: bitsRead } = bitStreamToString(bitStream);
    if (!decoded) {
      return undefined;
    }
    return { data: decoded, bits: bitsRead };
  }

  function isDataRegion(x, y) {
    return (
      (x < 9 && (y < 8 || y >= size - 8)) ||
      (x >= size - 8 && y < 8) ||
      false
    );
  }

  function jsQR(data, width, height, options) {
    if (options === void 0) {
      options = {};
    }
    const cliModeMatrix = createBinaryBitmap(data, width, height);
    const result = genericScan(cliModeMatrix, options);
    if (result) {
      return result;
    }
    return undefined;
  }

  function createBinaryBitmap(data, width, height) {
    const luminanceData = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      let yOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const pixel = (data[yOffset + x * 4] * 33 + data[yOffset + x * 4 + 1] * 34 + data[yOffset + x * 4 + 2] * 33) >> 5;
        luminanceData[y * width + x] = pixel;
      }
    }
    return luminanceData;
  }

  function genericScan(image, options) {
    const size = Math.min(image.width, image.height);
    const dimension = Math.floor((size - 8) / 14);
    if (dimension < 21) {
      return undefined;
    }
    const matrix = new BitMatrix(new Uint8Array(dimension * dimension), dimension);
    for (let y = 0; y < dimension; y++) {
      for (let x = 0; x < dimension; x++) {
        const pixelX = Math.floor((x + 0.5) * image.width / dimension);
        const pixelY = Math.floor((y + 0.5) * image.height / dimension);
        const lum = image[pixelY * image.width + pixelX];
        matrix.set(x, y, lum < 128);
      }
    }
    const versions = {};
    for (let v = 1; v <= 40; v++) {
      versions[v * 4 + 17] = { dimension: v * 4 + 17, version: v };
    }
    const maybeFlipped = true;
    const decoded = decodeQRCode(matrix, versions, maybeFlipped);
    if (decoded) {
      return decoded;
    }
    return undefined;
  }

  return jsQR;
});
