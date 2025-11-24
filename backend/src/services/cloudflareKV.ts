import config from '../config/env';

interface KVGetOptions {
  type?: 'text' | 'json' | 'arrayBuffer' | 'stream';

}
interface KVPutOptions {
  expirationTtl?: number;
  expiration?: number;
  metadata?: any;
}

class CloudflareKVService {
  private accountId: string;
  private namespaceId: string;
  private apiToken: string;
  private baseUrl: string;
  private workerUrl: string | null;
  private useWorker: boolean;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID || '';
    this.apiToken = process.env.CLOUDFLARE_KV_API_TOKEN || '';
    this.workerUrl = process.env.CLOUDFLARE_WORKER_URL || null;
    
    this.useWorker = !!this.workerUrl;
    
    if (this.useWorker) {
      console.log(`Using Cloudflare Worker for KV operations: ${this.workerUrl}`);
    } else if (!this.accountId || !this.namespaceId || !this.apiToken) {
      console.warn('Cloudflare KV not configured. Background jobs will not work.');
    }
    
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}`;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`KV API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async get(key: string, options: KVGetOptions = {}): Promise<string | null> {
    try {
      if (this.useWorker && this.workerUrl) {
        const response = await fetch(`${this.workerUrl}/kv/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });

        if (!response.ok) {
          throw new Error(`Worker KV get error: ${response.status}`);
        }

        const data = await response.json();
        return data.value;
      }

      const response = await fetch(
        `${this.baseUrl}/values/${encodeURIComponent(key)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
          },
        }
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`KV get error: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error(`Error getting key ${key} from KV:`, error);
      throw error;
    }
  }

  async getJSON<T = any>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value ? JSON.parse(value) : null;
  }

  async put(
    key: string,
    value: string,
    options: KVPutOptions = {}
  ): Promise<void> {
    try {
      if (this.useWorker && this.workerUrl) {
        const response = await fetch(`${this.workerUrl}/kv/put`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            key, 
            value,
            expirationTtl: options.expirationTtl
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Worker KV put error: ${response.status} - ${errorText}`);
        }
        return;
      }

      const url = new URL(`${this.baseUrl}/values/${encodeURIComponent(key)}`);
      
      if (options.expirationTtl) {
        url.searchParams.append('expiration_ttl', options.expirationTtl.toString());
      }
      
      if (options.expiration) {
        url.searchParams.append('expiration', options.expiration.toString());
      }

      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'text/plain',
        },
        body: value,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`KV put error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error(`Error putting key ${key} to KV:`, error);
      throw error;
    }
  }

  async putJSON(
    key: string,
    value: any,
    options: KVPutOptions = {}
  ): Promise<void> {
    await this.put(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.useWorker && this.workerUrl) {
        const response = await fetch(`${this.workerUrl}/kv/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });

        if (!response.ok) {
          throw new Error(`Worker KV delete error: ${response.status}`);
        }
        return;
      }

      const response = await fetch(
        `${this.baseUrl}/values/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
          },
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`KV delete error: ${response.status}`);
      }
    } catch (error) {
      console.error(`Error deleting key ${key} from KV:`, error);
      throw error;
    }
  }

  async list(options: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: any }>; list_complete: boolean; cursor?: string }> {
    try {
      if (this.useWorker && this.workerUrl) {
        const response = await fetch(`${this.workerUrl}/kv/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });

        if (!response.ok) {
          throw new Error(`Worker KV list error: ${response.status}`);
        }

        const data = await response.json();
        return data.result;
      }

      const url = new URL(`${this.baseUrl}/keys`);
      
      if (options.prefix) {
        url.searchParams.append('prefix', options.prefix);
      }
      
      if (options.limit) {
        url.searchParams.append('limit', options.limit.toString());
      }
      
      if (options.cursor) {
        url.searchParams.append('cursor', options.cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`KV list error: ${response.status}`);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error listing keys from KV:', error);
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!(this.accountId && this.namespaceId && this.apiToken);
  }
}

export const kvService = new CloudflareKVService();
export default kvService;
