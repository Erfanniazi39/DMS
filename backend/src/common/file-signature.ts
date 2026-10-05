// Basic content check for uploaded documents/images: the file's leading
// "magic bytes" must match its extension, so a renamed .exe/.html is not
// accepted as a .pdf/.png just because of its name. Deliberately small —
// only the formats this project accepts (PDF, PNG, JPEG). Added in the QA
// pass of 2026-10-05 for Purchase documents; Employee photo/contract uploads
// still check the extension only and could adopt this same helper.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_MARKER = Buffer.from('%PDF-', 'ascii');
// The PDF spec tolerates a little leading junk before the header; readers
// look for it within the first 1024 bytes.
const PDF_HEADER_SEARCH_WINDOW = 1024;

function startsWith(buffer: Buffer, signature: number[]) {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

export function matchesFileSignature(buffer: Buffer, extension: string): boolean {
  switch (extension.toLowerCase()) {
    case '.pdf':
      return buffer.subarray(0, PDF_HEADER_SEARCH_WINDOW).includes(PDF_MARKER);
    case '.png':
      return startsWith(buffer, PNG_SIGNATURE);
    case '.jpg':
    case '.jpeg':
      return startsWith(buffer, JPEG_SIGNATURE);
    default:
      return false;
  }
}
