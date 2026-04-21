// Cloud-side auth against apis.control4.com. Two steps:
//   1. POST creds  -> account bearer token
//   2. POST controller common name + account token -> director bearer token
//
// The director token is what lets us talk to the local controller.
// Validity is returned in seconds (typically 86400).

const AUTHENTICATION_ENDPOINT = "https://apis.control4.com/authentication/v1/rest";
const CONTROLLER_AUTHORIZATION_ENDPOINT =
  "https://apis.control4.com/authentication/v1/rest/authorization";
const GET_CONTROLLERS_ENDPOINT =
  "https://apis.control4.com/account/v3/rest/accounts";
// Application key copied from pyControl4 — this is the published one, not a secret.
const APPLICATION_KEY = "78f6791373d61bea49fdb9fb8897f1f3af193f11";

const CLIENT_INFO_DEVICE = {
  deviceName: "control4-app",
  deviceUUID: "0000000000000000",
  make: "control4-app",
  model: "control4-app",
  os: "Electron",
  osVersion: "33",
};

export interface AccountControllerInfo {
  controllerCommonName: string;
  href: string;
  name: string;
}

export interface DirectorToken {
  token: string;
  validSeconds: number;
  expiresAt: number;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 400)}`);
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

export async function getAccountBearerToken(
  username: string,
  password: string,
): Promise<string> {
  const payload = {
    clientInfo: {
      device: CLIENT_INFO_DEVICE,
      userInfo: {
        applicationKey: APPLICATION_KEY,
        password,
        userName: username,
      },
    },
  };
  const data = (await postJson(AUTHENTICATION_ENDPOINT, payload)) as {
    authToken?: { token?: string };
  };
  const token = data.authToken?.token;
  if (!token) {
    throw new Error(
      "Control4 cloud auth did not return a token — check username/password.",
    );
  }
  return token;
}

export async function getAccountControllers(
  accountBearer: string,
): Promise<AccountControllerInfo[]> {
  const data = (await getJson(GET_CONTROLLERS_ENDPOINT, {
    Authorization: `Bearer ${accountBearer}`,
  })) as { account?: AccountControllerInfo | AccountControllerInfo[] };
  const account = data.account;
  if (!account) {
    throw new Error("Control4 cloud returned no account info.");
  }
  return Array.isArray(account) ? account : [account];
}

export async function getDirectorBearerToken(
  accountBearer: string,
  controllerCommonName: string,
): Promise<DirectorToken> {
  const data = (await postJson(
    CONTROLLER_AUTHORIZATION_ENDPOINT,
    {
      serviceInfo: {
        commonName: controllerCommonName,
        services: "director",
      },
    },
    { Authorization: `Bearer ${accountBearer}` },
  )) as { authToken?: { token?: string; validSeconds?: number } };
  const token = data.authToken?.token;
  const validSeconds = data.authToken?.validSeconds;
  if (!token || typeof validSeconds !== "number") {
    throw new Error("Director auth did not return a token.");
  }
  return {
    token,
    validSeconds,
    expiresAt: Date.now() + validSeconds * 1000,
  };
}
