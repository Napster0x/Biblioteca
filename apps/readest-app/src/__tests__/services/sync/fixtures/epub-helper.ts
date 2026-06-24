/**
 * EPUB test fixture helper — creates minimal valid EPUB files for dev sync tests.
 *
 * Uses Python's built-in zipfile module to avoid jsdom/adm-zip Buffer issues
 * in the vitest environment.
 */
import { execFileSync } from 'node:child_process';

/**
 * Create a minimal EPUB zip file at the given path.
 *
 * @param epubPath  — absolute path where the .epub file will be written
 * @param containerXml — content of META-INF/container.xml
 * @param opfXml   — content of OEBPS/content.opf
 */
export function createEpubZip(epubPath: string, containerXml: string, opfXml: string): void {
  const script = `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('META-INF/container.xml', sys.argv[2])
    zf.writestr('OEBPS/content.opf', sys.argv[3])
`;
  execFileSync('python3', ['-c', script, epubPath, containerXml, opfXml], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

/**
 * Convenience — creates a minimal EPUB with sensible defaults.
 * Book title and author are extracted from the OPF metadata.
 */
export function createMinimalEpub(
  epubPath: string,
  title: string,
  author: string,
  extraMetadata = '',
): void {
  createEpubZip(
    epubPath,
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    ${extraMetadata}
  </metadata>
</package>`,
  );
}
