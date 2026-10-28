import { describe, it, expect, vi } from 'vitest';
import { PortalClient } from '../src/client/portal-client.js';

describe('PortalClient Session Management & 401 Interceptor', () => {
  it('automatically logs in and replays request when receiving a 401 Unauthorized', async () => {
    const client = new PortalClient({
      baseUrl: 'https://urja-ops.flockenergy.tech',
      username: 'mock_user@example.com',
      password: 'mock_password_123',
    });

    // Seed client with an expired dummy cookie
    client.setSessionCookie('__Secure-better-auth.session_token=EXPIRED_OLD_TOKEN');

    let callCount = 0;
    const loginSpy = vi.spyOn(client, 'login').mockImplementation(async () => {
      client.setSessionCookie('__Secure-better-auth.session_token=FRESH_NEW_TOKEN');
      return '__Secure-better-auth.session_token=FRESH_NEW_TOKEN';
    });

    // Mock global fetch to simulate 401 on first call, 200 on second call
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
});
