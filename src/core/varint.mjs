export function varIntSize(value) {
  assertVarIntValue(value);
  let size = 1;
  while (value >= 0x80) {
    value = Math.floor(value / 128);
    size++;
  }
  return size;
}

export function encodeVarInt(value) {
  assertVarIntValue(value);
  const bytes = [];
  do {
    let next = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) next |= 0x80;
    bytes.push(next);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function assertVarIntValue(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new RangeError(`Invalid non-negative VarInt value: ${value}`);
  }
}
