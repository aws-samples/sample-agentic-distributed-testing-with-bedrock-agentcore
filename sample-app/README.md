# CardDemo - Modernized Credit Card Management System

> This is sample code, for non-production usage. You should work with your
> security and legal teams to meet your organizational security, regulatory,
> and compliance requirements before deployment. All account/card/transaction
> data here is synthetic seed data generated for demo purposes — none of it
> represents real cardholders — and the demo login (`USER0001` / `PASSWORD`)
> is intentionally public for that same reason. Do not point this app at, or
> model it after, a deployment that will hold real PII/PCI data without a
> full security review first. Licensed under [MIT-0](../LICENSE).

A full-stack modernization of the CardDemo COBOL/CICS/VSAM mainframe application, rebuilt with React, Java Spring Boot, and SQLite.

- [`SPEC.md`](./SPEC.md) — technical specification of the original mainframe system (COBOL programs, copybooks, VSAM data layer, business rules, dependency/risk analysis) that this modernization is derived from.
- [`TEST_CASE.md`](./TEST_CASE.md) — manual frontend test cases for exercising this sample app end-to-end (separate from the Agentic Test Runner's own YAML-based test cases).

## Architecture

| Layer | Original (Mainframe) | Modernized |
|:------|:--------------------|:-----------|
| Frontend | BMS 3270 screens (17 maps) | React 18 + React Router |
| Backend | COBOL CICS programs (29 online) | Java 17 + Spring Boot 3.2 |
| Database | VSAM KSDS + AIX (9 files) | SQLite via JPA/Hibernate |
| Batch | JCL + COBOL batch (12 programs) | REST-triggered batch services |
| Auth | VSAM user file (plaintext) | Token-based session auth |
| Messaging | IBM MQ (optional) | REST APIs |

## Prerequisites

- **Java 17+** (JDK)
- **Maven 3.8+**
- **Node.js 18+** and npm

## Quick Start

### 1. Start the Backend

```bash
cd backend
mvn spring-boot:run
```

The backend starts on http://localhost:8080 and creates `carddemo.db` (SQLite) with seed data automatically.

### 2. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend starts on http://localhost:3000 and proxies API calls to the backend.

### 3. Login

| User ID | Password | Role | Description |
|:--------|:---------|:-----|:------------|
| ADMIN001 | PASSWORD | Admin | Full access (accounts, cards, transactions, users, batch) |
| USER0001 | PASSWORD | User | Standard access (view accounts, cards, transactions, billing) |

## Features Implemented

All 17 original COBOL online programs are reimplemented as React pages + REST endpoints:

### Authentication
- **Login** (COSGN00C) - Token-based auth with case-insensitive password comparison

### Account Management
- **Account List/Search** (COACTVWC) - Search by account ID, role-based visibility
- **Account View** (COACTVWC) - Detail with customer info via cross-reference
- **Account Update** (COACTUPC) - Edit credit limit, status, expiration (admin only)

### Card Management
- **Card List** (COCRDLIC) - Filtered by account, masked card numbers
- **Card Detail** (COCRDSLC) - Full detail with customer/account info
- **Card Update** (COCRDUPC) - Edit name, expiry, status with COBOL validation rules

### Transaction Processing
- **Transaction List** (COTRN00C) - Paginated, filterable by account/card
- **Transaction View** (COTRN01C) - Full detail with type/category descriptions
- **Transaction Add** (COTRN02C) - Full validation, auto-generated IDs, confirmation step

### Billing
- **Bill Payment** (COBIL00C) - Full balance payment with confirmation (rules BIL-01 to BIL-09)

### Reports
- **Transaction Report** (CORPT00C + CBTRN03C) - Monthly/yearly/custom date range

### User Administration (Admin only)
- **User List** (COUSR00C) - Paginated
- **User Add** (COUSR01C) - With validation
- **User Update** (COUSR02C) - With no-change detection
- **User Delete** (COUSR03C) - Hard delete with confirmation

### Batch Operations (Admin only)
- **Post Daily Transactions** (CBTRN02C batch) - Validates per rules BTR-01 to BTR-08
  - Card cross-reference validation (reject code 100)
  - Account existence check (reject code 101)
  - Credit limit enforcement (reject code 102)
  - Account expiration check (reject code 103)
  - Balance and cycle counter updates
  - Category balance upsert
- **Interest Calculation** (CBACT04C) - Per rules INT-01 to INT-13
  - Disclosure group rate lookup with DEFAULT fallback
  - Monthly interest formula: `(category_balance * annual_rate) / 1200`
  - Per-category calculation, account-level aggregation
  - System transaction generation
  - Cycle counter reset

## Database Schema

11 tables mapping to original VSAM files:

| Table | VSAM Equivalent | Copybook |
|:------|:---------------|:---------|
| users | USRSEC.VSAM.KSDS | CSUSR01Y |
| customers | CUSTDATA.VSAM.KSDS | CVCUS01Y |
| accounts | ACCTDATA.VSAM.KSDS | CVACT01Y |
| cards | CARDDATA.VSAM.KSDS | CVACT02Y |
| card_xref | CARDXREF.VSAM.KSDS | CVACT03Y |
| transactions | TRANSACT.VSAM.KSDS | CVTRA05Y |
| transaction_types | TRANTYPE.VSAM.KSDS | CVTRA03Y |
| transaction_categories | TRANCATG.VSAM.KSDS | CVTRA04Y |
| transaction_category_balances | TCATBALF.VSAM.KSDS | CVTRA01Y |
| disclosure_groups | DISCGRP.VSAM.KSDS | CVTRA02Y |
| daily_transactions | DALYTRAN (sequential) | CVTRA06Y |

## Project Structure

```
refactor/
  backend/
    pom.xml
    src/main/java/com/carddemo/
      CardDemoApplication.java
      config/         -- AuthInterceptor, WebConfig (CORS)
      model/          -- 11 JPA entities
      repository/     -- 11 Spring Data repositories
      dto/            -- Request/response records
      service/        -- Business logic (8 services)
      controller/     -- REST endpoints (8 controllers)
    src/main/resources/
      application.properties
      schema.sql      -- DDL for all 11 tables
      data.sql        -- Seed data (users, customers, accounts, cards, transactions)
  frontend/
    package.json
    vite.config.js    -- Dev server proxy to backend
    src/
      main.jsx
      App.jsx          -- Route configuration
      App.css          -- Application styles
      api.js           -- API client (all endpoint functions)
      context/         -- AuthContext (session management)
      components/      -- Layout, ProtectedRoute, Pagination
      pages/           -- 17 page components
```

## API Endpoints

| Method | Path | Auth | Description |
|:-------|:-----|:-----|:------------|
| POST | /api/auth/login | No | Authenticate user |
| POST | /api/auth/logout | Yes | End session |
| GET | /api/accounts | Yes | List/search accounts |
| GET | /api/accounts/{id} | Yes | Account detail with customer info |
| PUT | /api/accounts/{id} | Admin | Update account |
| GET | /api/cards | Yes | List cards (by account) |
| GET | /api/cards/{cardNum} | Yes | Card detail |
| PUT | /api/cards/{cardNum} | Yes | Update card |
| GET | /api/transactions | Yes | List transactions (paginated) |
| GET | /api/transactions/{id} | Yes | Transaction detail |
| POST | /api/transactions | Yes | Add transaction |
| POST | /api/billing/pay | Yes | Pay full account balance |
| POST | /api/reports/transactions | Yes | Generate transaction report |
| GET | /api/users | Admin | List users |
| GET | /api/users/{id} | Admin | Get user |
| POST | /api/users | Admin | Add user |
| PUT | /api/users/{id} | Admin | Update user |
| DELETE | /api/users/{id} | Admin | Delete user |
| POST | /api/batch/post-transactions | Admin | Run batch transaction posting |
| POST | /api/batch/calculate-interest | Admin | Run interest calculation |
