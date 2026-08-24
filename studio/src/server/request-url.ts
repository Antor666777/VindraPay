const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function requestPath(rawUrl: string | undefined): string {
  const candidate = rawUrl ?? '';
  if (ABSOLUTE_URL_PATTERN.test(candidate)) {
    try {
      return new URL(candidate).pathname;
    } catch {
      return '/';
    }
  }
  const withoutQuery = candidate.split('?')[0] ?? '';
  return withoutQuery === '' ? '/' : withoutQuery;
}

export function queryOf(rawUrl: string | undefined): string {
  const candidate = rawUrl ?? '';
  const queryIndex = candidate.indexOf('?');
  return queryIndex >= 0 ? candidate.slice(queryIndex) : '';
}

function decodeSegmentValue(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function hasUnsafeSegments(path: string): boolean {
  return path.split('/').some((segment) => {
    if (segment === '') return false;
    const decoded = decodeSegmentValue(segment);
    return (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    );
  });
}
