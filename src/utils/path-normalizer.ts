

/** Normalize a file path to a relative, safe format */
export function normalizePath(inputPath: string, projectRoot?: string): string {
  let path = inputPath;

  // 1. Replace backslashes with forward slashes
  path = path.replaceAll('\\', '/');

  // 2. Remove file:// prefix
  path = path.replace(/^file:\/\//, '');

  // 3. Remove SARIF %SRCROOT% placeholder
  path = path.replace(/^%SRCROOT%\//, '');

  // 4. Remove file URI encoded prefix
  path = path.replace(/^file:\/\//, '');

  // 5. Remove project root prefix if present
  if (projectRoot) {
    const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
    if (path.startsWith(normalizedRoot + '/')) {
      path = path.slice(normalizedRoot.length + 1);
    }
  }

  // 6. Reject path traversal attempts
  if (path.includes('..')) {
    const segments = path.split('/');
    let depth = 0;
    for (const segment of segments) {
      if (segment === '..') {
        depth--;
        if (depth < 0) {
          throw new Error(`Path traversal detected: ${inputPath}`);
        }
      } else if (segment !== '.' && segment !== '') {
        depth++;
      }
    }
    // Normalize the path after validation
    path = path.replaceAll('../', '');
    path = path.replaceAll('./', '');
  }

  // 7. Remove leading slash
  path = path.replace(/^\//, '');

  // 8. Collapse multiple slashes
  path = path.replace(/\/+/g, '/');

  return path;
}

/** Convert a Windows path to POSIX format */
export function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Check if a path is absolute */
export function isAbsolutePath(path: string): boolean {
  return /^[/\\]/.test(path) || /^[a-zA-Z]:[/\\]/.test(path);
}
