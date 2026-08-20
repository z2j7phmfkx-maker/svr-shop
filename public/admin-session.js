'use strict';
(() => {
  const originalFetch = window.fetch.bind(window);
  function cookie(name) { return document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const options = { ...init };
    if (url.origin === location.origin && url.pathname.startsWith('/api/admin') && !['GET','HEAD','OPTIONS'].includes(method)) {
      const headers = new Headers(options.headers || (typeof input !== 'string' ? input.headers : undefined));
      headers.set('X-CSRF-Token', decodeURIComponent(cookie('svr_admin_csrf')));
      options.headers = headers;
    }
    const response = await originalFetch(input, options);
    if (response.status === 401 && url.pathname !== '/api/admin/login') location.replace(`/admin/login?next=${encodeURIComponent(location.pathname)}`);
    return response;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent='.admin-logout{margin-top:12px;width:100%;padding:11px;border:1px solid #ffffff20;border-radius:9px;background:#ffffff08;color:#b8c2d1;font:inherit;font-weight:800;cursor:pointer}.admin-logout:hover{background:#ffffff14;color:#fff}'; document.head.append(style);
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const button = document.createElement('button'); button.type='button'; button.className='admin-logout'; button.textContent='↪ Se déconnecter';
    button.addEventListener('click', async () => { await window.fetch('/api/admin/logout', { method:'POST' }); location.replace('/admin/login'); });
    sidebar.append(button);
  });
})();
