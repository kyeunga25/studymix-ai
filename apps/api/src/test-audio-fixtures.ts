export function createSyntheticMp3Fixture(): Uint8Array {
  const frameLength = 417;
  const bytes = new Uint8Array(frameLength * 2);
  const header = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
  bytes.set(header, 0);
  bytes.set(header, frameLength);
  return bytes;
}

export function createSyntheticWaveFixture(): Uint8Array {
  const bytes = new Uint8Array(60);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, 16, true);
  return bytes;
}
