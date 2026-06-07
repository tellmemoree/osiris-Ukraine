import { ProxyAgent, fetch as undiciFetch } from 'undici';

let _cachedUrl: string | null = null;
let _agent: ProxyAgent | null = null;

function getAgent(): ProxyAgent | null {
  const url = process.env.RU_PROXY_URL;
  if (!url) return null;
  if (_agent && _cachedUrl === url) return _agent;
  _agent = new ProxyAgent(url);
  _cachedUrl = url;
  return _agent;
}

/**
 * Drop-in fetch for RU-geoblocked endpoints.
 * Routes through RU_PROXY_URL (residential RU proxy, e.g. IPRoyal) when set;
 * falls back to direct fetch when unset — nothing breaks without the proxy.
 */
export async function ruFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const agent = getAgent();
  if (!agent) return fetch(url as string, init);
  const resp = await undiciFetch(url.toString(), {
    ...(init as Record<string, unknown>),
    dispatcher: agent,
  });
  return resp as unknown as Response;
}
