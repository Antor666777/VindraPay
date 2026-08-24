import type { BackendHealth, Meta, Stats } from './api';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toasts = $state<{ items: Toast[] }>({ items: [] });

export const auth = $state({
  mode: 'open' as 'open' | 'locked',
  unlocked: true,
});

export const backend = $state({
  online: null as boolean | null,
});

export const session = $state<{
  meta: Meta | null;
  stats: Stats | null;
  health: BackendHealth | null;
  refreshedAt: string | null;
}>({
  meta: null,
  stats: null,
  health: null,
  refreshedAt: null,
});

let toastSeq = 1;

export function pushToast(kind: ToastKind, message: string): void {
  const id = toastSeq++;
  toasts.items.push({ id, kind, message });
  setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: number): void {
  const index = toasts.items.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.items.splice(index, 1);
}

export function lockSession(): void {
  auth.mode = 'locked';
  auth.unlocked = false;
}

export function unlockSession(): void {
  auth.unlocked = true;
}

export function setBackendReachable(reachable: boolean): void {
  backend.online = reachable;
}
