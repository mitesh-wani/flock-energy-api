# Flock Energy API

A lightweight Node.js REST API that acts as an adapter between clients and the legacy **Urja Meter Ops** portal. The service authenticates with the portal using a shared cookie-backed session, retrieves meter information from the portal's internal endpoints, normalizes the responses, and exposes a clean JSON API.

## Features

- RESTful API built with Express.js
- Automatic portal authentication and session reuse
- Automatic re-authentication on session expiry
- Swagger UI for interactive API documentation
- Request validation using Zod
- Comprehensive API testing using Jest and Supertest
- Structured error handling
- Environment-based configuration
- Health check endpoint

---

## Tech Stack

- Node.js
- Express.js
- Axios
- Swagger UI Express
- Zod
- Jest
- Supertest
- Pino
- Morgan
- Cheerio (used where HTML parsing is required)

---

## Installation

```powershell
npm install
Copy-Item .env.example .env
```

Update `.env` with the portal credentials:

```text
URJA_USERNAME=operator@urja.local
URJA_PASSWORD=urja-ops-2026
```

Start the server:

```powershell
npm start
```

The API runs at

```
http://localhost:3000
```

---

## API Documentation

Swagger UI is available at

```
http://localhost:3000/docs
```

The OpenAPI specification is defined in

```
openapi.json
```

---

## Available Endpoints

| Method | Endpoint | Description |
|---------|----------|-------------|
| GET | `/health` | Service health check |
| POST | `/api/v1/auth/login` | Authenticate with Urja portal |
| GET | `/api/v1/meters` | List smart meters |
| GET | `/api/v1/meters/:id` | Meter details |
| GET | `/api/v1/meters/:id/consumption` | Meter consumption history |
| GET | `/api/v1/hierarchy` | Network hierarchy |

---

## Testing

The project uses **Jest** and **Supertest** for automated API testing.

Run all tests:

```powershell
npm test
```

Run a single test:

```powershell
npm run test:one -- test/app.test.js -t "GET /api/v1/meters returns"
```

Current test coverage includes:

- Health endpoint
- Meter list
- Meter details
- Consumption history
- Hierarchy
- Login endpoint
- Validation errors
- Authentication failures
- Network failures
- Unexpected server errors

---

## Portal Integration

The API authenticates once and stores the portal session cookie. Subsequent requests reuse the session automatically.

The implementation consumes the portal's internal endpoints, including:

- `/login`
- `/portal/meters/search`
- `/portal/meters/{id}/geo`
- `/portal/meters/{id}/energy`

When the session expires, the client automatically performs a fresh login and retries the request once.

---

## Error Handling

The API returns normalized JSON errors instead of exposing portal responses.

Examples include:

- `400 validation_error`
- `404 not_found`
- `502 portal_parse_error`
- `502 portal_unreachable`
- `503 portal_authentication_failed`
- `500 internal_error`

---

## Project Structure

```
app/
 ├── app.js
 ├── client.js
 ├── config.js
 ├── models.js

test/
 └── app.test.js

openapi.json
README.md
PROTOCOL.md
REFLECTION.md
```

---

## Design Decisions

- Stateless REST API
- Cookie-based portal authentication
- Automatic session renewal
- Normalized JSON responses
- Request validation using Zod
- Interactive API documentation with Swagger
- Unit and integration testing with Jest + Supertest
- Environment-driven configuration
- No persistent caching

---
## Reflection

### What assumptions did you make?

I assumed the Urja Meter Ops portal was the authoritative data source and that authentication should be handled internally by the API using shared credentials stored in environment variables. Initially, I expected most data to be available through HTML pages as described in the specification. During implementation, I discovered that the portal exposes internal JSON endpoints for meter search, location, and energy data, so I adapted the client to consume those endpoints instead while keeping the external API unchanged.

### Which part was the most difficult, and how did you get unstuck?

The most difficult part was understanding how the portal actually worked because the public routes documented in the specification did not exactly match the real implementation. I repeatedly received authentication failures, 404 responses, and parsing errors. I used Chrome Developer Tools (Network tab) to inspect every request made by the portal after login. By tracing the requests, I identified the internal APIs (`/portal/meters/search`, `/portal/meters/{id}/geo`, `/portal/meters/{id}/energy`) and the SvelteKit `__data.json` responses, which allowed me to replace unreliable HTML parsing with direct JSON parsing where possible.

### If you had another day, what would you improve?

I would improve the resilience of the portal client by introducing a dedicated service layer, stronger retry and backoff logic, and optional response caching to reduce repeated portal requests. I would also increase automated test coverage for the portal client itself using mocked HTTP responses, improve logging for easier debugging, and add metrics for authentication failures and portal response times.

### What mistake did you make while solving this?

My biggest mistake was assuming that the portal exposed traditional REST endpoints for meter details and hierarchy. I initially spent time trying to parse HTML responses and debugging non-existent endpoints before inspecting the browser's network traffic. Once I analyzed the portal requests with Developer Tools, I realized that most data was already available through internal JSON APIs, making the implementation much simpler and more reliable.

### If you were reviewing your own submission, what would you criticise?

I would criticise the tight coupling between the portal's internal API structure and the adapter implementation. Because the solution depends on undocumented internal endpoints, changes to the portal could require code updates. I would also recommend separating the portal client into smaller modules, improving parser abstraction, and expanding integration tests to better validate behavior when the upstream portal changes.

---
## Notes

This project was developed as an adapter over the Urja Meter Ops portal. During development, the portal's internal endpoints were analyzed and integrated to provide reliable JSON responses while hiding implementation details from API consumers.

See:

- `PROTOCOL.md` — Portal communication details
- `REFLECTION.md` — Design decisions and implementation notes