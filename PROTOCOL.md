# Urja Portal Protocol Notes

The live portal at `https://urja-ops.flockenergy.tech` was not reachable from the implementation environment, so live browser recon could not be completed. No portal behavior is being presented as observed fact.

## Provisional adapter contract

- Login page: `GET ${URJA_LOGIN_PATH}` followed by a form-encoded `POST` to the same configured path.
- Credentials: `URJA_USERNAME` and `URJA_PASSWORD`; field names are configurable with `URJA_USERNAME_FIELD` and `URJA_PASSWORD_FIELD`.
- Hidden inputs on the login page are collected and sent back, which supports common CSRF-token patterns.
- The shared Axios client uses a `tough-cookie` jar. A response containing a login form, HTTP 401, or HTTP 403 is treated as an expired session; the request is retried once after a mutex-protected login.
- Default page paths are `/meters`, `/meters/:id`, `/meters/:id/consumption`, and `/hierarchy`. Override them in `.env` after recon.

## Parsing and normalization

The adapter recognizes common table headings for meter ID, serial number, status, installation date, location, consumption period, and units. Numeric values become JavaScript numbers. Dates are ISO 8601 when the source can be parsed; `YYYY-MM` periods remain month strings. Missing fields are returned as `null`.

The parser also has fallbacks for meter links, key/value detail tables, and simple nested lists/tables for hierarchy data. These are deliberately conservative: an unrecognized page raises `portal_parse_error` and the API returns `502`.

## Recon still required

Confirm the real login URL/method, form fields, CSRF behavior, cookies, redirect/session-expiry signal, page URLs, selectors, pagination/filter semantics, hidden JSON endpoints, exports, and rate limits. Those details are intentionally not guessed because the draft specification marks them as required investigative work.
