import { matchesFileSignature } from './file-signature';

describe('matchesFileSignature', () => {
  it('accepts Office containers by their magic bytes: .docx/.xlsx (ZIP) and .doc/.xls (OLE2)', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    expect(matchesFileSignature(zip, '.docx')).toBe(true);
    expect(matchesFileSignature(zip, '.xlsx')).toBe(true);
    expect(matchesFileSignature(ole, '.doc')).toBe(true);
    expect(matchesFileSignature(ole, '.xls')).toBe(true);
  });

  it('refuses a renamed executable or text file, and a container under the wrong extension', () => {
    const exe = Buffer.from('MZ\x90\x00 not an office file');
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(matchesFileSignature(exe, '.docx')).toBe(false);
    expect(matchesFileSignature(exe, '.xls')).toBe(false);
    expect(matchesFileSignature(zip, '.doc')).toBe(false);
    expect(matchesFileSignature(zip, '.pdf')).toBe(false);
  });

  it('still handles the original formats and rejects unknown extensions', () => {
    expect(matchesFileSignature(Buffer.from('%PDF-1.7'), '.pdf')).toBe(true);
    expect(matchesFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg')).toBe(true);
    expect(matchesFileSignature(Buffer.from('anything'), '.exe')).toBe(false);
  });
});
