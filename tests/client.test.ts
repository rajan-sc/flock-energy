import { describe, it, expect, vi } from 'vitest';
import { PortalClient } from '../src/client/portal-client.js';

describe('PortalClient Session Management & Concurrency', () => {
  it('automatically logs in and replays request when receiving a 401 Unauthorized', async () => {
    const client = new PortalClient({
      baseUrl: 'https://urja-ops.flockenergy.tech',
      username: 'mock_user@example.com',
      password: 'mock_password_123',
    });

    client.setSessionCookie('__Secure-better-auth.session_token=EXPIRED_OLD_TOKEN');

    let callCount = 0;
    const loginSpy = vi.spyOn(client, 'login').mockImplementation(async () => {
      client.setSessionCookie('__Secure-better-auth.session_token=FRESH_NEW_TOKEN');
      return '__Secure-better-auth.session_token=FRESH_NEW_TOKEN';
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      callCount++;
      const cookieHeader = (init?.headers as Headers)?.get('cookie');

      if (callCount === 1) {
        expect(cookieHeader).toBe('__Secure-better-auth.session_token=EXPIRED_OLD_TOKEN');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }

      if (callCount === 2) {
        expect(cookieHeader).toBe('__Secure-better-auth.session_token=FRESH_NEW_TOKEN');
        return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
      }

      return new Response(null, { status: 500 });
    });

    try {
      const response = await client.fetchWithAuth('/portal/meters/search?q=&page=1');
      expect(response.status).toBe(200);
      expect(loginSpy).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(2);
      expect(client.getSessionCookie()).toBe('__Secure-better-auth.session_token=FRESH_NEW_TOKEN');
    } finally {
      globalThis.fetch = originalFetch;
      loginSpy.mockRestore();
    }
  });

  it('shares a single in-flight login promise during concurrent cold requests', async () => {
    const client = new PortalClient({
      baseUrl: 'https://urja-ops.flockenergy.tech',
      username: 'mock_user@example.com',
      password: 'mock_password_123',
    });

    let loginFetches = 0;
    const signals: boolean[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      signals.push(Boolean(options?.signal));
      if (url.includes('/login')) {
        loginFetches++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ type: 'success' }), {
          status: 200,
          headers: {
            'set-cookie': '__Secure-better-auth.session_token=CONCURRENT_TEST_TOKEN; Path=/; HttpOnly',
          },
        });
      }
      return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
    });

    try {
      // 3 concurrent requests on a cold client
      await Promise.all([client.searchMeters(), client.searchMeters(), client.searchMeters()]);

      // Exactly 1 POST /login network request occurred despite 3 simultaneous requests!
      expect(loginFetches).toBe(1);
      // All fetch calls included an AbortSignal timeout
      expect(signals.every(Boolean)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('recovers from SvelteKit HTML login redirects by refreshing session and retrying', async () => {
    const client = new PortalClient({
      baseUrl: 'https://urja-ops.flockenergy.tech',
      username: 'mock_user@example.com',
      password: 'mock_password_123',
    });
    client.setSessionCookie('__Secure-better-auth.session_token=EXPIRED_REDIRECT_COOKIE');

    let logins = 0;
    client.login = async () => {
      logins++;
      client.setSessionCookie('__Secure-better-auth.session_token=FRESH_RECOVERED_TOKEN');
      return '__Secure-better-auth.session_token=FRESH_RECOVERED_TOKEN';
    };

    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        // First attempt returns HTML login page
        return new Response('<!DOCTYPE html><html><body>Login</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      // Second attempt returns valid JSON
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      const res = await client.searchMeters();
      expect(fetchAttempts).toBe(2);
      expect(logins).toBe(1);
      expect(Array.isArray(res.data)).toBe(true);
      expect(client.getSessionCookie()).toBe('__Secure-better-auth.session_token=FRESH_RECOVERED_TOKEN');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caches bulk export responses in memory and coalesces concurrent calls', async () => {
    const client = new PortalClient({
      baseUrl: 'https://urja-ops.flockenergy.tech',
      username: 'mock_user@example.com',
      password: 'mock_password_123',
    });
    client.setSessionCookie('__Secure-better-auth.session_token=ACTIVE_SESSION');

    let networkFetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      networkFetches++;
      if (url.includes('/portal/keys')) {
        return new Response(JSON.stringify({ data: { signingSecret: 'mock_secret_key' } }), { status: 200 });
      }
      if (url.includes('/portal/export')) {
        return new Response(JSON.stringify({ data: [{ meterId: 'J100000', serialNo: 'SE123' }], total: 1 }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    try {
      const [res1, res2, res3] = await Promise.all([
        client.getBulkExport(1),
        client.getBulkExport(1),
        client.getBulkExport(1),
      ]);

      expect(res1.data[0].meterId).toBe('J100000');
      expect(res2.data[0].meterId).toBe('J100000');
      expect(res3.data[0].meterId).toBe('J100000');

      expect(networkFetches).toBe(2);

      const cachedRes = await client.getBulkExport(1);
      expect(cachedRes.data[0].meterId).toBe('J100000');
      expect(networkFetches).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
