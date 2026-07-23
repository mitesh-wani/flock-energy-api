const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const {
  ConsumptionRecordSchema,
  HierarchyNodeSchema,
  MeterSchema
} = require('./models');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class PortalError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

class PortalUnreachableError extends PortalError {
  constructor(message, options) {
    super(message, 'portal_unreachable', options);
  }
}

class PortalAuthenticationError extends PortalError {
  constructor(message, options) {
    super(message, 'portal_authentication_failed', options);
  }
}

class PortalParseError extends PortalError {
  constructor(message, options) {
    super(message, 'portal_parse_error', options);
  }
}

class PortalNotFoundError extends PortalError {
  constructor(message, options) {
    super(message, 'meter_not_found', { ...options, status: 404 });
  }
}

// ---------------------------------------------------------------------------
// Small text/number/date helpers
// ---------------------------------------------------------------------------

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function keyOf(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function firstValue(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function nullableText(value) {
  const text = cleanText(value);
  return text && !/^(n\/a|unknown|null|-)$/i.test(text) ? text : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = cleanText(value).replace(/,/g, '');
  if (!text) return null;
  const number = Number.parseFloat(text.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  const text = nullableText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function replaceId(pathTemplate, id) {
  const encodedId = encodeURIComponent(id);
  return pathTemplate.includes(':id')
    ? pathTemplate.replace(':id', encodedId)
    : `${pathTemplate.replace(/\/$/, '')}/${encodedId}`;
}

// ---------------------------------------------------------------------------
// HTML parsing helpers (fallback path — used only if a JSON endpoint
// isn't available for a given page; see getMeterDetail / getHierarchy)
// ---------------------------------------------------------------------------

function extractTables($) {
  const tables = [];
  $('table').each((_, table) => {
    const rows = [];
    const headerCells = $(table).find('thead tr').first().find('th,td');
    let headers = headerCells.map((__, cell) => keyOf($(cell).text())).get();
    const bodyRows = $(table).find('tbody tr');
    const sourceRows = bodyRows.length ? bodyRows : $(table).find('tr').slice(headers.length ? 1 : 0);
    if (!headers.length && sourceRows.length) {
      headers = $(sourceRows.first()).find('th,td').map((__, cell) => keyOf($(cell).text())).get();
    }
    sourceRows.each((__, tr) => {
      const cells = $(tr).find('td,th').map((___, cell) => cleanText($(cell).text())).get();
      if (!cells.length) return;
      const row = {};
      cells.forEach((cell, index) => {
        row[headers[index] || `column${index + 1}`] = cell;
      });
      rows.push(row);
    });
    if (rows.length) tables.push(rows);
  });
  return tables;
}

function parseKeyValuePage($) {
  const values = {};
  $('dl dt').each((_, dt) => {
    const key = keyOf($(dt).text());
    const value = cleanText($(dt).next('dd').text());
    if (key && value) values[key] = value;
  });
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('th,td');
    if (cells.length === 2) values[keyOf($(cells[0]).text())] = cleanText($(cells[1]).text());
  });
  return values;
}

function meterFromRow(row) {
  const meterId = nullableText(firstValue(row, ['meterid', 'id', 'meterno', 'meternumber', 'metercode', 'column1']));
  if (!meterId) return null;
  const latitude = numberOrNull(firstValue(row, ['latitude', 'lat']));
  const longitude = numberOrNull(firstValue(row, ['longitude', 'lng', 'lon']));
  const address = nullableText(firstValue(row, ['location', 'address', 'site']));
  return MeterSchema.parse({
    meterId,
    serialNumber:
    nullableText(
        row.serialNo || row.serialNumber
    ),

status:
    nullableText(
        row.installStatus || row.status
    ),
    name: nullableText(firstValue(row, ['name', 'metername'])),
    installedAt: normalizeDate(firstValue(row, ['installedat', 'installationdate', 'installeddate'])),
    location: address || latitude !== null || longitude !== null
      ? { address, latitude, longitude }
      : null
  });
}

function looksLikeLoginPage(response) {
  if (response.status === 401 || response.status === 403) return true;
  const html = typeof response.data === 'string' ? response.data : '';
  if (!html) return false;
  const hasPassword = /type=["']password["']/i.test(html);
  const hasLoginWord = /\blogin\b|\bsign[ -]?in\b/i.test(html);
  return hasPassword && hasLoginWord;
}

// ---------------------------------------------------------------------------
// Parsers referenced by getMeterDetail() / getHierarchy()
//
// Both accept EITHER a parsed JSON object (preferred, if the portal exposes
// one) OR a raw HTML string (fallback), so the calling method doesn't need
// to know which shape it received.
// ---------------------------------------------------------------------------

function parseMeterDetail(payload, id) {

    if (payload && typeof payload === "object") {

        const latitude = numberOrNull(payload.latitude);
        const longitude = numberOrNull(payload.longitude);
        const address = nullableText(payload.address);

        return MeterSchema.parse({

            meterId: String(payload.meterId || payload.id || id),

            serialNumber: nullableText(
                payload.serialNo ||
                payload.serialNumber ||
                payload.serial
            ),

            name: nullableText(
                payload.name ||
                payload.meterName
            ),

            status: nullableText(
                payload.installStatus ||
                payload.status
            ),

            installedAt: normalizeDate(
                payload.installedAt ||
                payload.installationDate
            ),

            location:
                address ||
                latitude !== null ||
                longitude !== null
                    ? {
                        address,
                        latitude,
                        longitude
                    }
                    : null
        });

    }

    const $ = cheerio.load(
        typeof payload === "string"
            ? payload
            : ""
    );

    const values = parseKeyValuePage($);

    const meter = meterFromRow({
        meterid:id,
        ...values
    });

    if(!meter){

        throw new PortalParseError(
            `Could not extract meter ${id}`
        );

    }

    return meter;

}
function parseHierarchy(payload) {
  const toNode = (node) => HierarchyNodeSchema.parse({
    id: String(node.id ?? node.nodeId ?? ''),
    type: nullableText(node.type ?? node.nodeType) || 'unknown',
    children: Array.isArray(node.children) ? node.children.map(toNode) : []
  });

  if (Array.isArray(payload)) {
    return payload.map(toNode);
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data.map(toNode);
  }

  // HTML fallback — flatten any tables found into a shallow node list.
  // NOTE: this almost certainly needs adjusting once the real hierarchy
  // page markup is known; it's a reasonable starting point, not a
  // confirmed-correct parser.
  const $ = cheerio.load(typeof payload === 'string' ? payload : '');
  const tables = extractTables($);
  return tables
    .flat()
    .map((row) => ({
      id: nullableText(firstValue(row, ['id', 'nodeid', 'column1'])),
      type: nullableText(firstValue(row, ['type', 'nodetype'])) || 'unknown',
      children: []
    }))
    .filter((node) => node.id)
    .map((node) => HierarchyNodeSchema.parse(node));
}

// ---------------------------------------------------------------------------
// Portal client
// ---------------------------------------------------------------------------

class PortalClient {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.jar = dependencies.jar || new CookieJar();
    this.http = dependencies.http || wrapper(axios.create({
      baseURL: config.portal.baseUrl,
      jar: this.jar,
      withCredentials: true,
      timeout: config.portal.timeoutMs,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: { Accept: 'text/html,application/xhtml+xml,application/json' }
    }));
    this.authenticated = false;
    this.loginPromise = null;
  }

  async login() {
    if (!this.config.portal.username || !this.config.portal.password) {
      throw new PortalAuthenticationError('Portal credentials are not configured.');
    }
    try {
      const loginPage = await this.http.get(this.config.portal.paths.login);
      const $ = cheerio.load(typeof loginPage.data === 'string' ? loginPage.data : '');
      const fields = {};
      $('input[type="hidden"]').each((_, input) => {
        const name = $(input).attr('name');
        if (name) fields[name] = $(input).attr('value') || '';
      });
      fields[this.config.portal.usernameField] = this.config.portal.username;
      fields[this.config.portal.passwordField] = this.config.portal.password;

      const response = await this.http.post(
        this.config.portal.paths.login,
        new URLSearchParams(fields).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Origin: this.config.portal.baseUrl,
            Referer: `${this.config.portal.baseUrl}/login`
          }
        }
      );

      if (this.config.debug) {
        console.log('[portal] login status:', response.status);
        console.log('[portal] login body preview:', String(response.data).slice(0, 500));
      }

      if (response.status >= 400 || looksLikeLoginPage(response)) {
        throw new PortalAuthenticationError('The portal rejected the configured credentials.');
      }
      this.authenticated = true;
      return { authenticated: true };
    } catch (error) {
      this.authenticated = false;
      if (error instanceof PortalError) throw error;
      throw new PortalUnreachableError('The portal could not be reached during login.', { cause: error });
    }
  }

  async ensureAuthenticated(force = false) {
    if (this.authenticated && !force) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => { this.loginPromise = null; });
    }
    await this.loginPromise;
  }

  /**
   * Fetch an HTML page, transparently reauthenticating (once) if the
   * response turns out to be a login page in disguise.
   */
  async fetchPage(path, params = {}, retried = false) {
    await this.ensureAuthenticated();

    let response;
    try {
      response = await this.http.get(path, { params });
    } catch (error) {
      throw new PortalUnreachableError('The portal request failed.', { cause: error });
    }

    if (looksLikeLoginPage(response)) {
      if (retried) {
        throw new PortalAuthenticationError('The portal session remained invalid after reauthentication.');
      }
      this.authenticated = false;
      await this.ensureAuthenticated(true);
      return this.fetchPage(path, params, true);
    }

    if (response.status >= 400) {
      throw new PortalUnreachableError(`The portal returned HTTP ${response.status}.`, { status: response.status });
    }

    return response.data;
  }

  /**
   * Returns the full paginated envelope from the portal
   * ({ data, total, page, pageSize }) rather than just the array,
   * so callers/routes can surface real pagination metadata instead
   * of a locally-recomputed count.
   */
async getMeterList(query = {}) {
  await this.ensureAuthenticated();

  try {
    const response = await this.http.get(
      "/portal/meters/search",
      {
        params: {
          q: query.search || "",
          page: query.page || 1
        },
        headers: {
          Accept: "application/json"
        }
      }
    );

    return {
      data: response.data.data.map((row) => ({
        meterId: row.meterId,
        serialNumber: row.serialNo,
        make: row.make,
        phaseType: row.phaseType,
        status: row.installStatus,
        dtCode: row.dtCode
      })),
      total: response.data.total,
      page: response.data.page,
      pageSize: response.data.pageSize
    };

  } catch (error) {

    if (error.response?.status === 401) {
      this.authenticated = false;
      throw new PortalAuthenticationError(
        "Portal session expired."
      );
    }

    throw new PortalUnreachableError(
      "Unable to fetch meter list.",
      { cause: error }
    );
  }
}
  async getMeterDetail(id) {
    await this.ensureAuthenticated();

    try {
      const detailResponse = await this.http.get(
        replaceId(this.config.portal.paths.meterDetail, id),
        { headers: { Accept: 'application/json,text/html' } }
      );

      if (detailResponse.status === 404) {
        throw new PortalNotFoundError(`Meter ${id} was not found on the portal.`);
      }

      if (looksLikeLoginPage(detailResponse)) {
        this.authenticated = false;
        await this.ensureAuthenticated(true);
        return this.getMeterDetail(id);
      }

      if (detailResponse.status >= 400) {
        throw new PortalUnreachableError(`The portal returned HTTP ${detailResponse.status}.`, {
          status: detailResponse.status
        });
      }

      const payload = typeof detailResponse.data === 'object' && detailResponse.data !== null
        ? detailResponse.data
        : null;

      if (!payload) {
        const html = await this.fetchPage(replaceId(this.config.portal.paths.meterDetail, id));
        return parseMeterDetail(html, id);
      }

      return parseMeterDetail(payload, id);
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalParseError('The meter detail response could not be parsed.', { cause: error });
    }
  }
  /**
   * Forwards page/limit/from/to through to the portal's energy endpoint
   * so consumers can actually page/filter consumption history once the
   * portal supports it server-side.
   */
  async getConsumption(id, query = {}) {
    await this.ensureAuthenticated();

    const response = await this.http.get(`/portal/meters/${encodeURIComponent(id)}/energy`, {
      params: {
        page: query.page,
        limit: query.limit,
        from: query.from,
        to: query.to
      },
      headers: { Accept: 'application/json' }
    });

    const body = response.data;
    const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];

    return items.map((item) => ConsumptionRecordSchema.parse({
      meterId: id,
      period: normalizeDate(item.timestamp) || item.timestamp,
      unitsConsumed: numberOrNull(item.kwh) ?? 0,
      kvah: numberOrNull(item.kvah),
      voltR: numberOrNull(item.voltR)
    }));
  }

  async getHierarchy() {
    return parseHierarchy(await this.fetchPage(this.config.portal.paths.hierarchy));
  }
}

module.exports = {
  PortalClient,
  PortalError,
  PortalUnreachableError,
  PortalAuthenticationError,
  PortalParseError,
  PortalNotFoundError,
  // exported so parser logic can be unit-tested against saved HTML/JSON
  // fixtures without going through the network layer
  parseMeterDetail,
  parseHierarchy
};