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
    latitude: string;
    longitude: string;
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

export class PortalClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private bulkExportCache: { data: PortalExportResponse; expiresAt: number } | null = null;
  private inFlightExportPromise: Promise<PortalExportResponse> | null = null;
  private cacheTtlMs = 5 * 60 * 1000; // 5-minute inventory TTL

  constructor(options: { baseUrl: string; username: string; password: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.username = options.username;
    this.password = options.password;
  }

  public getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  public setSessionCookie(cookie: string | null): void {
    this.sessionCookie = cookie;
  }

  public async login(): Promise<string> {
    const body = new URLSearchParams({
      email: this.username,
      password: this.password,
    }).toString();

    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
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
  }

  public async fetchWithAuth(path: string, options: RequestInit = {}, isRetry = false): Promise<Response> {
    if (!this.sessionCookie) {
      await this.login();
    }

    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});
    headers.set('cookie', this.sessionCookie!);

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Reactive self-healing: intercept 401 once and replay
    if (response.status === 401 && !isRetry) {
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
    return res.json() as Promise<PortalMetersResponse>;
  }

  public async getMeterGeo(meterId: string): Promise<PortalGeoResponse> {
    const res = await this.fetchWithAuth(`/portal/meters/${encodeURIComponent(meterId)}/geo`);
    if (res.status === 404) {
      throw new Error(`Meter ${meterId} not found`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch meter geo: HTTP ${res.status}`);
    }
    return res.json() as Promise<PortalGeoResponse>;
  }

  public async getMeterEnergy(meterId: string): Promise<PortalEnergyResponse> {
    const res = await this.fetchWithAuth(`/portal/meters/${encodeURIComponent(meterId)}/energy`);
    if (res.status === 404) {
      throw new Error(`Meter ${meterId} not found`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch meter energy: HTTP ${res.status}`);
    }
    return res.json() as Promise<PortalEnergyResponse>;
  }

  public clearBulkCache(): void {
    this.bulkExportCache = null;
  }

  public async getBulkExport(page = 1, forceRefresh = false): Promise<PortalExportResponse> {
    // 1. Return cached inventory if fresh and page == 1
    if (!forceRefresh && page === 1 && this.bulkExportCache && Date.now() < this.bulkExportCache.expiresAt) {
      return this.bulkExportCache.data;
    }

    // 2. Coalesce concurrent in-flight requests for page 1
    if (page === 1 && this.inFlightExportPromise) {
      return this.inFlightExportPromise;
    }

    const fetchPromise = (async () => {
      try {
        // Fetch HMAC secret
        const keyRes = await this.fetchWithAuth('/portal/keys');
        if (!keyRes.ok) {
          throw new Error(`Failed to fetch portal signing keys: HTTP ${keyRes.status}`);
        }
        const keyData = (await keyRes.json()) as { data: { signingSecret: string } };
        const secret = keyData.data?.signingSecret;
        if (!secret) {
          throw new Error('Portal signing key response missing signingSecret');
        }

        // Generate HMAC signature
        const method = 'GET';
        const path = '/portal/export';
        const query = `page=${page}`;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const payload = [method, path, query, timestamp].join('\n');
        const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

        // Authenticated signed fetch
        const res = await this.fetchWithAuth(`${path}?${query}`, {
          headers: {
            'x-timestamp': timestamp,
            'x-signature': signature,
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch bulk export: HTTP ${res.status}`);
        }

        const exportData = (await res.json()) as PortalExportResponse;
        if (!exportData || !Array.isArray(exportData.data)) {
          throw new Error('Malformed bulk export response from portal');
        }

        // Cache page 1 snapshot
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
