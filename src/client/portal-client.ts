import crypto from 'node:crypto';

export interface PortalMetersResponse {
  data: Array<{
    meterId: string;
    serialNo: string;
    make: string;
    phaseType: string;
    installStatus: string;
    dtCode: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalGeoResponse {
  data: {
    meterId: string;
    latitude: string;
    longitude: string;
    address: string;
  };
}

export interface PortalEnergyReading {
  timestamp: string;
  kwh: string;
  kvah: string;
  voltR: string;
}

export interface PortalEnergyResponse {
  data: PortalEnergyReading[];
}

export interface PortalExportItem {
  meterId: string;
  serialNo: string;
  make: string;
  phaseType: string;
  installStatus: string;
  installType?: string;
  dtCode?: string;
  hierarchy?: {
    zone?: { name: string; code: string };
    circle?: { name: string; code: string };
    division?: { name: string; code: string };
    subdivision?: { name: string; code: string };
    substation?: { name: string; code: string };
    feeder?: { name: string; code: string };
    dt?: { name: string; code: string };
  };
  geo?: {
    lat: number;
    lng: number;
  };
}

export interface PortalExportResponse {
  data: PortalExportItem[];
  total: number;
}

export interface PortalClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export class PortalClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private timeoutMs: number;
  private sessionCookie: string | null = null;
  private inFlightLoginPromise: Promise<string> | null = null;
  private bulkExportCache: { data: PortalExportResponse; expiresAt: number } | null = null;
  private inFlightExportPromise: Promise<PortalExportResponse> | null = null;
  private cacheTtlMs = 5 * 60 * 1000; // 5-minute inventory freshness

  constructor(options: PortalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.username = options.username;
    this.password = options.password;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  public getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  public setSessionCookie(cookie: string | null): void {
    this.sessionCookie = cookie;
  }

  public clearBulkCache(): void {
    this.bulkExportCache = null;
  }

  /**
   * Thread-safe login with mutex deduplication.
   * Concurrent callers share a single in-flight login request to prevent stampedes.
   */
  public async login(): Promise<string> {
    if (this.inFlightLoginPromise) {
      return this.inFlightLoginPromise;
    }

    this.inFlightLoginPromise = (async () => {
      try {
        const body = new URLSearchParams({
          email: this.username,
          password: this.password,
        }).toString();

        const response = await fetch(`${this.baseUrl}/login`, {
          method: 'POST',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-sveltekit-action': 'true',
            'origin': this.baseUrl,
          },
          body,
        });

        if (!response.ok) {
          throw new Error(`Portal login HTTP failed with status ${response.status}`);
        }

        const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
        if (payload && payload.type === 'failure') {
          throw new Error(`Portal login failed: invalid credentials or form error`);
        }

        const rawCookies = typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie') || ''];

        const authCookieHeader = rawCookies.find((c) => c.includes('__Secure-better-auth.session_token'));
        if (!authCookieHeader) {
          throw new Error('Portal login succeeded but session cookie was not returned');
        }

        const tokenPart = authCookieHeader.split(';')[0].trim();
        this.sessionCookie = tokenPart;
        return this.sessionCookie;
      } finally {
        this.inFlightLoginPromise = null;
      }
    })();

    return this.inFlightLoginPromise;
  }

  /**
   * Authenticated fetch with automatic session refresh on 401 or SvelteKit HTML login redirects.
   * Prevents hung connections by applying AbortSignal timeouts to all upstream requests.
   */
  public async fetchWithAuth(path: string, options: RequestInit = {}, isRetry = false): Promise<Response> {
    if (!this.sessionCookie) {
      await this.login();
    }

    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});
    headers.set('cookie', this.sessionCookie!);

    const signal = options.signal || AbortSignal.timeout(this.timeoutMs);

    const response = await fetch(url, {
      ...options,
      signal,
      headers,
    });

    const contentType = response.headers?.get('content-type') || '';
    const isHtmlRedirect = contentType.includes('text/html') || response.url?.includes('/login');

    // Intercept 401 or redirect to HTML login page once and auto-refresh
    if ((response.status === 401 || isHtmlRedirect) && !isRetry) {
      this.sessionCookie = null; // Mark expired
      await this.login();
      return this.fetchWithAuth(path, options, true);
    }

    return response;
  }

  public async searchMeters(q = '', page = 1): Promise<PortalMetersResponse> {
    const res = await this.fetchWithAuth(`/portal/meters/search?q=${encodeURIComponent(q)}&page=${page}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch meters list from portal: HTTP ${res.status}`);
    }
    const json = (await res.json()) as PortalMetersResponse;
    if (!json || typeof json !== 'object' || !Array.isArray(json.data)) {
      throw new Error('Malformed portal response: invalid or missing meters array');
    }
    return json;
  }

  public async getMeterGeo(meterId: string): Promise<PortalGeoResponse> {
    const res = await this.fetchWithAuth(`/portal/meters/${encodeURIComponent(meterId)}/geo`);
    if (res.status === 404) {
      throw new Error(`Meter ${meterId} not found`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch meter geo: HTTP ${res.status}`);
    }
    const json = (await res.json()) as PortalGeoResponse;
    if (!json || typeof json !== 'object' || !json.data) {
      throw new Error(`Malformed portal geo response for meter ${meterId}`);
    }
    return json;
  }

  public async getMeterEnergy(meterId: string): Promise<PortalEnergyResponse> {
    const res = await this.fetchWithAuth(`/portal/meters/${encodeURIComponent(meterId)}/energy`);
    if (res.status === 404) {
      throw new Error(`Meter ${meterId} not found`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch meter energy: HTTP ${res.status}`);
    }
    const json = (await res.json()) as PortalEnergyResponse;
    if (!json || typeof json !== 'object' || !Array.isArray(json.data)) {
      throw new Error(`Malformed portal energy response for meter ${meterId}`);
    }
    return json;
  }

  /**
   * Fetches the bulk inventory snapshot using HMAC-SHA256 authenticated signature.
   * If replaying after a 401, fresh signing keys and updated timestamps are used.
   */
  public async getBulkExport(page = 1, forceRefresh = false): Promise<PortalExportResponse> {
    if (!forceRefresh && page === 1 && this.bulkExportCache && Date.now() < this.bulkExportCache.expiresAt) {
      return this.bulkExportCache.data;
    }

    if (page === 1 && this.inFlightExportPromise) {
      return this.inFlightExportPromise;
    }

    const fetchPromise = (async () => {
      try {
        const executeSignedExport = async (isRetry = false): Promise<PortalExportResponse> => {
          // 1. Fetch fresh signing key
          const keyRes = await this.fetchWithAuth('/portal/keys');
          if (!keyRes.ok) {
            throw new Error(`Failed to fetch portal signing keys: HTTP ${keyRes.status}`);
          }
          const keyData = (await keyRes.json()) as { data: { signingSecret: string } };
          const secret = keyData.data?.signingSecret;
          if (!secret) {
            throw new Error('Portal signing key response missing signingSecret');
          }

          // 2. Generate HMAC signature with fresh timestamp
          const method = 'GET';
          const path = '/portal/export';
          const query = `page=${page}`;
          const timestamp = String(Math.floor(Date.now() / 1000));
          const payload = [method, path, query, timestamp].join('\n');
          const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

          // 3. Perform authenticated signed fetch
          const res = await this.fetchWithAuth(`${path}?${query}`, {
            headers: {
              'x-timestamp': timestamp,
              'x-signature': signature,
            },
          });

          // Handle 401 retry specifically for signed endpoint to refresh key & signature
          if (res.status === 401 && !isRetry) {
            this.sessionCookie = null;
            await this.login();
            return executeSignedExport(true);
          }

          if (!res.ok) {
            throw new Error(`Failed to fetch bulk export: HTTP ${res.status}`);
          }

          const exportData = (await res.json()) as PortalExportResponse;
          if (!exportData || !Array.isArray(exportData.data)) {
            throw new Error('Malformed bulk export response from portal');
          }

          return exportData;
        };

        const exportData = await executeSignedExport();

        if (page === 1) {
          this.bulkExportCache = {
            data: exportData,
            expiresAt: Date.now() + this.cacheTtlMs,
          };
        }

        return exportData;
      } finally {
        if (page === 1) {
          this.inFlightExportPromise = null;
        }
      }
    })();

    if (page === 1) {
      this.inFlightExportPromise = fetchPromise;
    }

    return fetchPromise;
  }
}
