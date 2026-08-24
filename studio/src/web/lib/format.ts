export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function errMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'Something went wrong');
}

export function focusOnMount(node: HTMLElement): { destroy: () => void } {
  const timer = window.setTimeout(() => node.focus(), 30);
  return {
    destroy: () => window.clearTimeout(timer),
  };
}
