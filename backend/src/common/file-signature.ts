// Basic content check for uploaded documents/images: the file's leading
// "magic bytes" must match its extension, so a renamed .exe/.html is not
// accepted as a .pdf/.png just because of its name. Deliberately small —
// only the formats this project accepts (PDF, PNG, JPEG; Word/Excel for letters). Added in the QA
// pass of 2026-10-05 for Purchase documents; Employee photo/contract uploads
// still check the extension only and could adopt this same helper.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_MARKER = Buffer.from('%PDF-', 'ascii');
// Office formats: .docx/.xlsx are ZIP containers; legacy .doc/.xls are OLE2
// compound files. Only the container magic is checked (a renamed .exe/.html
// is refused; a zip renamed to .docx is not) — files are never served inline
// or executed, only downloaded.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
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
    case '.docx':
    case '.xlsx':
      return startsWith(buffer, ZIP_SIGNATURE);
    case '.doc':
    case '.xls':
      return startsWith(buffer, OLE2_SIGNATURE);
    default:
      return false;
  }
}
