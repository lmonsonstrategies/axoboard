export class GoogleProviderError extends Error {
  constructor(code, status = 502, retryable = false) {
    super(code);
    this.name = 'GoogleProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function endpoint(value, fallback) { return String(value || fallback).replace(/\/$/, ''); }

export function createGoogleProvider({ fetchImpl = fetch, env = process.env } = {}) {
  const authorizationUrl = endpoint(env.AXOBOARD_GOOGLE_AUTHORIZATION_URL, 'https://accounts.google.com/o/oauth2/v2/auth');
  const tokenUrl = endpoint(env.AXOBOARD_GOOGLE_TOKEN_URL, 'https://oauth2.googleapis.com/token');
  const userInfoUrl = endpoint(env.AXOBOARD_GOOGLE_USERINFO_URL, 'https://openidconnect.googleapis.com/v1/userinfo');
  const sheetsBaseUrl = endpoint(env.AXOBOARD_GOOGLE_SHEETS_API_BASE_URL, 'https://sheets.googleapis.com/v4');
  const driveBaseUrl = endpoint(env.AXOBOARD_GOOGLE_DRIVE_API_BASE_URL, 'https://www.googleapis.com/drive/v3');
  const revokeUrl = endpoint(env.AXOBOARD_GOOGLE_REVOKE_URL, 'https://oauth2.googleapis.com/revoke');

  async function requestJson(url, options = {}, { retries = 0, errorCode = 'google_request_failed' } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
        const requestId = response.headers.get('x-guploader-uploadid') || response.headers.get('x-request-id') || null;
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { body, status: response.status, requestId, attempts: attempt };
        const providerCode = String(body.error?.status || body.error || body.error_description || errorCode).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 80);
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new GoogleProviderError(providerCode || errorCode, response.status, retryable);
        if (!retryable || attempt > retries) throw lastError;
        const retryAfter = Math.min(2, Number(response.headers.get('retry-after') || attempt));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, retryAfter * 100));
      } catch (error) {
        if (error instanceof GoogleProviderError) {
          if (!error.retryable || attempt > retries) throw error;
          lastError = error;
        } else {
          lastError = new GoogleProviderError(error?.name === 'TimeoutError' ? 'google_timeout' : 'google_network_error', 502, true);
          if (attempt > retries) throw lastError;
        }
      }
    }
    throw lastError;
  }

  async function tokenRequest(params, errorCode) {
    return requestJson(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params)
    }, { errorCode });
  }

  return {
    authorizationUrl,
    async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
      return (await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: codeVerifier, grant_type: 'authorization_code' }, 'google_code_exchange_failed')).body;
    },
    async refreshToken({ refreshToken, clientId, clientSecret }) {
      return (await tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }, 'google_refresh_failed')).body;
    },
    async userInfo(accessToken) {
      return (await requestJson(userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, { errorCode: 'google_userinfo_failed' })).body;
    },
    async spreadsheetFiles(accessToken, pageToken = '') {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        orderBy: 'modifiedTime desc,name_natural',
        pageSize: '1000',
        corpora: 'user',
        spaces: 'drive',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        fields: 'nextPageToken,incompleteSearch,files(id,name,modifiedTime)'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const url = `${driveBaseUrl}/files?${params.toString()}`;
      return requestJson(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, { retries: 2, errorCode: 'google_spreadsheet_list_failed' });
    },
    async spreadsheetMetadata(accessToken, spreadsheetId) {
      const fields = 'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount),sheetType))';
      const url = `${sheetsBaseUrl}/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=${encodeURIComponent(fields)}`;
      return requestJson(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, { retries: 2, errorCode: 'google_spreadsheet_metadata_failed' });
    },
    async spreadsheetValues(accessToken, spreadsheetId, range, { formatted = false } = {}) {
      const renderOption = formatted ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE';
      const url = `${sheetsBaseUrl}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${renderOption}&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`;
      return requestJson(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, { retries: 2, errorCode: 'google_values_failed' });
    },
    async spreadsheetValueRanges(accessToken, spreadsheetId, ranges, { formatted = false } = {}) {
      const params = new URLSearchParams({
        valueRenderOption: formatted ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
        majorDimension: 'ROWS'
      });
      ranges.forEach((range) => params.append('ranges', range));
      const url = `${sheetsBaseUrl}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`;
      return requestJson(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, { retries: 2, errorCode: 'google_values_failed' });
    },
    async revoke(token) {
      const response = await fetchImpl(revokeUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok && response.status !== 400) throw new GoogleProviderError('google_revoke_failed', response.status, response.status >= 500);
    }
  };
}
