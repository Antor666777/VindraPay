export interface Route {
  name: string;
  path: string;
  params: Record<string, string>;
}

export const route = $state<Route>({ name: 'dashboard', path: '/dashboard', params: {} });

export function navigate(hashPath: string): void {
  const target = `#${hashPath}`;
  if (location.hash === target) {
    parseHash();
    return;
  }
  location.hash = target;
}

function parseHash(): void {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const segments = path.split('/').filter(Boolean).slice(0, 2);
  const head = segments[0];
  const second = segments[1];

  let name = 'dashboard';
  let params: Record<string, string> = {};

  switch (head) {
    case undefined:
    case 'dashboard':
      break;
    case 'businesses':
      if (second) {
        name = 'business-detail';
        params = { id: second };
      } else {
        name = 'businesses';
      }
      break;
    case 'providers':
    case 'transactions':
    case 'inbox':
    case 'attempts':
    case 'settings':
    case 'guide':
      name = head;
      break;
    default:
      navigate('/dashboard');
      return;
  }

  route.name = name;
  route.path = path;
  route.params = params;
}

window.addEventListener('hashchange', parseHash);
parseHash();

export function isActive(prefix: string): boolean {
  if (prefix === '/dashboard') return route.name === 'dashboard';
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}
