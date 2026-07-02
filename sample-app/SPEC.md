# CardDemo Modernization -- Technical Specification

> Documents the "as-is" mainframe COBOL/CICS/VSAM system that `sample-app/` modernizes, and the analysis (business logic, dependencies, risk) that informed the migration to Spring Boot + React.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
   - 1.1 [Purpose and Scope of This Document](#11-purpose-and-scope-of-this-document)
   - 1.2 [Business Drivers for Modernization](#12-business-drivers-for-modernization)
   - 1.3 [Document Conventions and Audience](#13-document-conventions-and-audience)
2. [Current System Inventory ("As-Is")](#2-current-system-inventory-as-is)
   - 2.1 System Overview and History
   - 2.2 COBOL Codebase Inventory
     - 2.2.1 Program/Module Listing (LOC, complexity scores)
     - 2.2.2 Copybooks and Data Structures
     - 2.2.3 Dead Code and Redundancy Analysis
   - 2.3 Job Control Language (JCL) and Batch Processes
   - 2.4 Data Layer
     - 2.4.1 VSAM / Flat File Structures
     - 2.4.2 Relational Database Schema (DB2, IMS if applicable)
     - 2.4.3 Data Flows and Lineage
   - 2.5 Infrastructure and Platform
     - 2.5.1 Mainframe Environment (IBM Z / MF specs)
     - 2.5.2 CICS / IMS Transaction Processing
     - 2.5.3 TPM, schedulers (TWS, CA7)
   - 2.6 Integration and Interfaces
     - 2.6.1 External Network Connections (Visa/Mastercard, ISO 8583 messaging)
     - 2.6.2 Internal System Interfaces (Core Banking, GL, Fraud)
     - 2.6.3 3rd-Party Vendors and APIs
3. [Business Logic Extraction and Documentation](#3-business-logic-extraction-and-documentation)
   - 3.1 Credit Card Lifecycle Rules (Issuance, Activation, Closure)
   - 3.2 Transaction Processing Rules (Authorization, Clearing, Settlement)
   - 3.3 Billing and Statement Generation Logic
   - 3.4 Interest, Fees, and Penalties Computation
   - 3.5 Credit Limit Management and Risk Controls
   - 3.6 Fraud Detection and AML Rules
   - 3.7 Dispute and Chargeback Processing
   - 3.8 Regulatory Compliance Logic (PCI-DSS, local regulations)
4. [Dependency and Impact Analysis](#4-dependency-and-impact-analysis)
   - 4.1 Program-to-Program Call Graph
   - 4.2 Data Dependency Map
   - 4.3 Upstream / Downstream System Dependencies
   - 4.4 Technical Debt Quantification (developer-days)
   - 4.5 Risk and "Blast Radius" Assessment per Module

---

## 1. Executive Summary

### 1.1 Purpose and Scope of This Document

This Technical Specification documents the complete "as-is" state of the **CardDemo** credit card management system and provides the analytical foundation required before any modernization refactoring begins. It is the authoritative reference that all subsequent modernization work -- target architecture design, migration planning, sprint backlogs, and test-strategy documents -- will be derived from.

**In scope:**

| Area | Coverage |
|:-----|:---------|
| Core COBOL application | 29 online and batch programs (~19,500 LOC) across `app/cbl/` |
| Optional extension modules | 10 additional programs (~8,500 LOC) in `app-authorization-ims-db2-mq/`, `app-transaction-type-db2/`, `app-vsam-mq/` |
| Copybooks and data structures | 29 shared copybooks (`app/cpy/`) + 17 BMS-generated copybooks (`app/cpy-bms/`) + 8 module-specific copybooks |
| Screen definitions | 17 core BMS maps + 4 optional-module BMS maps (`app/bms/`) |
| Batch processing | 38 core JCL jobs + 8 optional-module JCL jobs (`app/jcl/`) |
| Infrastructure artifacts | 2 assembler utilities, 1 CSD resource definition, 2 scheduler files (CA7, Control-M), JCL procedures, VSAM catalog |
| Data layer | VSAM KSDS files with AIX, optional DB2 tables, optional IMS DB segments |
| Integration points | MQ messaging (optional), FTP-based batch submission, CICS inter-program communication |

**Out of scope (deferred to subsequent documents):**

- Target-state architecture and technology selection
- Migration execution plan, timeline, and staffing
- Cloud infrastructure design (AWS, Azure, etc.)
- Vendor selection and commercial terms

### 1.2 Business Drivers for Modernization

The following drivers motivate the modernization of CardDemo from its current mainframe COBOL/CICS/VSAM platform:

#### 1.2.1 Operational Risk and Workforce

| Driver | Detail |
|:-------|:-------|
| **Skills scarcity** | The COBOL developer talent pool is shrinking. Fewer than 2% of computer science graduates are exposed to COBOL, making recruitment and knowledge retention an escalating risk. |
| **Key-person dependency** | Mainframe systems typically concentrate institutional knowledge in a small number of senior staff. Loss of any one expert creates disproportionate operational risk. |
| **Mean-time-to-change** | Mainframe change cycles (compile, link-edit, CICS newcopy, regression test) are measured in days to weeks, compared to minutes-to-hours for modern CI/CD pipelines. |

#### 1.2.2 Cost and Scalability

| Driver | Detail |
|:-------|:-------|
| **MIPS-based licensing** | Mainframe cost scales with consumption (MIPS/MSU). Growing transaction volumes directly increase operating expense with limited elasticity. |
| **Vertical scaling limits** | Capacity upgrades require hardware procurement cycles. Cloud-native architectures offer horizontal auto-scaling with pay-per-use economics. |
| **Batch window pressure** | The nightly batch cycle (close files -> post transactions -> interest calc -> statements -> reindex -> reopen) competes with a shrinking offline window as business demands 24/7 availability. |

#### 1.2.3 Business Agility

| Driver | Detail |
|:-------|:-------|
| **Feature velocity** | Adding a new card product, fee structure, or regulatory report requires changes across COBOL programs, copybooks, BMS maps, JCL, and VSAM definitions -- a high coordination cost. |
| **API economy** | Modern partners and fintechs expect RESTful/event-driven APIs. CardDemo's current integration surface is limited to 3270 screens, batch files, and optional MQ messaging. |
| **Regulatory cadence** | PCI-DSS, PSD2, open-banking, and local consumer-protection regulations evolve faster than the current change cycle can absorb. |

#### 1.2.4 Technology Debt

| Driver | Detail |
|:-------|:-------|
| **Monolithic coupling** | All 29 core programs share a single COMMAREA structure (`COCOM01Y.cpy`). Any field change ripples across the entire online application. |
| **Mixed coding standards** | The codebase intentionally uses varied coding styles and patterns, increasing cognitive load and defect risk during maintenance. |
| **Dead code** | At least one copybook (`UNUSED1Y.cpy`) is explicitly unused; further dead-code analysis is required across programs. |
| **Limited observability** | No structured logging, metrics, or tracing; diagnostics rely on CICS auxiliary trace and CEDF. |

### 1.3 Document Conventions and Audience

#### Conventions

| Convention | Meaning |
|:-----------|:--------|
| `MONOSPACE` | Program names, file names, dataset names, copybook names, transaction codes |
| *Italics* | Terms defined on first use or used in a non-standard sense |
| **Bold** | Key findings, risk flags, or action items |
| (opt) | Feature depends on an optional extension module being installed |
| LOC | Lines of Code -- counted as total physical lines in source file including comments and blank lines |
| HLQ | High Level Qualifier for mainframe datasets, assumed to be `AWS.M2` throughout |

#### Quantitative Metrics in This Document

All code metrics in this specification are derived from static analysis of the repository as of commit `59cc6c2` (branch: `main`). Specific measurements:

| Metric | Source | Value |
|:-------|:-------|------:|
| Core COBOL programs | `app/cbl/*.cbl` | 29 |
| Core COBOL LOC | `wc -l app/cbl/*.cbl` | 19,496 |
| Optional module programs | `app/app-*/cbl/*.cbl` | 10 |
| Optional module LOC | `wc -l app/app-*/cbl/*.cbl` | 8,473 |
| **Total COBOL LOC** | | **27,969** |
| Copybooks (data structures) | `app/cpy/*.cpy` | 29 |
| Copybook LOC | `wc -l app/cpy/*.cpy` | 2,748 |
| BMS copybooks | `app/cpy-bms/` | 17 |
| BMS screen maps | `app/bms/*.bms` | 17 (core) + 4 (opt) |
| JCL jobs | `app/jcl/` | 38 (core) + 8 (opt) |
| EXEC CICS calls (core) | grep count | 174 |
| VSAM I/O operations (core) | EXEC CICS READ/WRITE/REWRITE/DELETE/STARTBR | 43 |
| Unique COPY references (core) | distinct copybook inclusions | 47 |
| CICS transactions defined | CSD + optional | 25 |
| Assembler utilities | `app/asm/` | 2 |
| Scheduler definitions | `app/scheduler/` | 2 (CA7, Control-M) |

#### Intended Audience

| Audience | Relevant Sections |
|:---------|:------------------|
| **Executive sponsors / Product owners** | 1.1, 1.2 (business drivers), 4.4 (tech debt quantification), 4.5 (risk assessment) |
| **Enterprise architects** | 2.1-2.6 (as-is inventory), 4.1-4.3 (dependency analysis) |
| **Application developers** (COBOL and target-platform) | 2.2 (codebase inventory), 3.x (business logic extraction), 4.1 (call graph) |
| **Data engineers / DBAs** | 2.4 (data layer), 4.2 (data dependency map) |
| **QA / Test leads** | 3.x (business rules for test-case derivation), 4.5 (blast radius per module) |
| **Program / Project managers** | 1.2 (drivers), 4.4 (effort estimates), 4.5 (risk matrix) |
| **Security and compliance officers** | 3.6 (fraud/AML), 3.8 (PCI-DSS/regulatory), 2.4 (data at rest) |

---

## 2. Current System Inventory ("As-Is")

### 2.1 System Overview and History

CardDemo is a credit card management application built on classic IBM mainframe technology. It provides end-to-end card lifecycle capabilities including customer on-boarding, account management, credit card issuance, transaction processing, interest calculation, billing/statement generation, and user administration.

**Technology stack:**

| Layer | Technology | Role |
|:------|:-----------|:-----|
| Language | COBOL (COBOL 85 / Enterprise COBOL) | All business logic |
| Transaction monitor | CICS TS | Online transaction processing, screen I/O, file control |
| Data storage (primary) | VSAM KSDS with AIX | Accounts, cards, customers, transactions, cross-references, security |
| Data storage (optional) | DB2, IMS DB | Transaction types (DB2), pending authorizations (IMS) |
| Messaging (optional) | IBM MQ | Authorization request/response, account/date inquiry |
| Presentation | BMS (Basic Mapping Support) | 3270 terminal screen maps |
| Batch | JCL + IDCAMS + SORT + COBOL batch programs | Nightly processing cycle |
| Scheduling | CA7, Control-M | Job dependency management |
| Assembler utilities | MVSWAIT, COBDATFT | Timer control, date format conversion |
| Security | VSAM-based user file (USRSEC) | Authentication and role (Admin/User) |

**Application scale summary:**

| Metric | Count |
|:-------|------:|
| Total COBOL programs | 40 (30 core + 10 optional) |
| Total COBOL LOC | ~29,817 (20,420 core + 8,473 optional + 924 statement generation) |
| Copybooks | 37 (29 core + 8 optional) |
| BMS screen maps | 21 (17 core + 4 optional) |
| JCL jobs | 46 (38 core + 8 optional) |
| CICS transactions | 25 |
| VSAM files | 9 primary clusters + 3 alternate index paths |

### 2.2 COBOL Codebase Inventory

#### 2.2.1 Program/Module Listing (LOC, complexity scores)

**Complexity scoring methodology:** Each program is scored on a 1-5 scale derived from weighted indicators: IF-statement density, EVALUATE count, EXEC CICS call count, PERFORM count, and total LOC. Scores map as: 1=Trivial, 2=Low, 3=Medium, 4=High, 5=Very High.

##### Core Online Programs (18 programs, CICS-based)

| Program | LOC | Trans ID | Function | IFs | EVALs | EXEC CICS | PERFORMs | Complexity |
|:--------|----:|:---------|:---------|----:|------:|----------:|---------:|:----------:|
| `COACTUPC` | 4,236 | CAUP | Account update | 164 | 10 | 17 | 61 | **5 - Very High** |
| `COCRDUPC` | 1,560 | CCUP | Credit card update | 72 | 8 | 12 | 26 | **4 - High** |
| `COCRDLIC` | 1,459 | CCLI | Credit card list | 59 | 9 | 18 | 30 | **4 - High** |
| `COACTVWC` | 941 | CAVW | Account view | 28 | 5 | 15 | 18 | **3 - Medium** |
| `COCRDSLC` | 887 | CCDL | Card detail view | 33 | 4 | 14 | 19 | **3 - Medium** |
| `COTRN02C` | 783 | CT02 | Transaction add | 14 | 13 | 11 | 61 | **3 - Medium** |
| `COTRN00C` | 699 | CT00 | Transaction list | 26 | 8 | 10 | 42 | **3 - Medium** |
| `COUSR00C` | 695 | CU00 | User list | 25 | 8 | 11 | 41 | **3 - Medium** |
| `CORPT00C` | 649 | CR00 | Transaction reports | 20 | 5 | 7 | 34 | **3 - Medium** |
| `COBIL00C` | 572 | CB00 | Bill payment | 10 | 9 | 13 | 38 | **3 - Medium** |
| `COUSR02C` | 414 | CU02 | User update | 13 | 5 | 6 | 31 | **2 - Low** |
| `COUSR03C` | 359 | CU03 | User delete | 8 | 5 | 6 | 26 | **2 - Low** |
| `COTRN01C` | 330 | CT01 | Transaction view | 7 | 3 | 5 | 17 | **2 - Low** |
| `COMEN01C` | 308 | CM00 | Main menu router | 7 | 3 | 7 | 13 | **2 - Low** |
| `COUSR01C` | 299 | CU01 | User add | 4 | 3 | 5 | 20 | **2 - Low** |
| `COADM01C` | 288 | CA00 | Admin menu router | 6 | 2 | 7 | 13 | **2 - Low** |
| `COSGN00C` | 260 | CC00 | Signon (entry point) | 4 | 3 | 10 | 11 | **2 - Low** |
| `CSUTLDTC` | 157 | -- | Date validation utility | 0 | 1 | 0 | 1 | **1 - Trivial** |

##### Core Batch Programs (12 programs, no CICS)

| Program | LOC | JCL Job | Function | IFs | EVALs | PERFORMs | Complexity |
|:--------|----:|:--------|:---------|----:|------:|---------:|:----------:|
| `CBSTM03A` | 924 | CREASTMT | Statement generation | -- | -- | -- | **3 - Medium** |
| `CBTRN02C` | 731 | POSTTRAN | Post daily transactions | 48 | 0 | 61 | **4 - High** |
| `CBTRN03C` | 649 | TRANREPT | Transaction report | 38 | 2 | 72 | **3 - Medium** |
| `CBEXPORT` | 582 | CBEXPORT | Data export (EBCDIC) | 16 | 0 | 45 | **3 - Medium** |
| `COBIL00C` | -- | -- | (see online) | -- | -- | -- | -- |
| `CBTRN01C` | 494 | -- | Transaction lookup | 33 | 0 | 42 | **3 - Medium** |
| `CBIMPORT` | 487 | CBIMPORT | Data import (EBCDIC) | 14 | 1 | 29 | **3 - Medium** |
| `CBACT01C` | 430 | -- | Account file reader | 22 | 0 | 35 | **2 - Low** |
| `CBACT04C` | 652 | INTCALC | Interest calculation | 43 | 0 | 56 | **4 - High** |
| `CBACT02C` | 178 | -- | Card data reader | 11 | 0 | 10 | **1 - Trivial** |
| `CBACT03C` | 178 | -- | Cross-ref reader | 11 | 0 | 10 | **1 - Trivial** |
| `CBCUS01C` | 178 | -- | Customer data reader | 11 | 0 | 10 | **1 - Trivial** |
| `COBSWAIT` | 41 | WAITSTEP | Timer wait (calls ASM) | 0 | 0 | 0 | **1 - Trivial** |

##### Optional Module Programs (10 programs)

| Program | LOC | Module | Function | Complexity |
|:--------|----:|:-------|:---------|:----------:|
| `COTRTLIC` | 2,098 | DB2 Tran Types | Transaction type list/delete (DB2 cursor) | **4 - High** |
| `COTRTUPC` | 1,702 | DB2 Tran Types | Transaction type add/edit (DB2 DML) | **4 - High** |
| `COPAUS0C` | 1,032 | IMS-DB2-MQ Auth | Pending authorization summary (IMS read) | **4 - High** |
| `COPAUA0C` | 1,026 | IMS-DB2-MQ Auth | Authorization request processing (MQ + IMS + DB2) | **5 - Very High** |
| `COACCT01` | 620 | VSAM-MQ | Account inquiry via MQ | **3 - Medium** |
| `COPAUS1C` | 604 | IMS-DB2-MQ Auth | Pending authorization detail (IMS update + DB2 insert) | **4 - High** |
| `CODATE01` | 524 | VSAM-MQ | System date inquiry via MQ | **2 - Low** |
| `CBPAUP0C` | 386 | IMS-DB2-MQ Auth | Batch purge expired authorizations | **3 - Medium** |
| `COPAUS2C` | 244 | IMS-DB2-MQ Auth | Pending authorization navigation | **2 - Low** |
| `COBTUPDT` | 237 | DB2 Tran Types | Batch transaction type maintenance (embedded SQL) | **2 - Low** |

#### 2.2.2 Copybooks and Data Structures

##### VSAM Record Layouts

| Copybook | LOC | Record Name | Size (B) | Key | Key Len | Purpose |
|:---------|----:|:------------|:--------:|:----|--------:|:--------|
| `CVACT01Y` | 20 | ACCOUNT-RECORD | 300 | ACCT-ID (PIC 9(11)) | 11 | Account master |
| `CVACT02Y` | 14 | CARD-RECORD | 150 | CARD-NUM (PIC X(16)) | 16 | Card master |
| `CVCUS01Y` | 26 | CUSTOMER-RECORD | 500 | CUST-ID (PIC 9(09)) | 9 | Customer master |
| `CVACT03Y` | 11 | CARD-XREF-RECORD | 50 | XREF-CARD-NUM (PIC X(16)) | 16 | Card-account-customer cross-reference |
| `CVTRA05Y` | 21 | TRAN-RECORD | 350 | TRAN-ID (PIC X(16)) | 16 | Online transaction master |
| `CVTRA06Y` | 21 | DALYTRAN-RECORD | 350 | DALYTRAN-ID | 16 | Daily transaction input |
| `CVTRA01Y` | 13 | TRAN-CAT-BAL-RECORD | 50 | Composite (acct+type+cat) | 17 | Transaction category balance |
| `CVTRA02Y` | 13 | DIS-GROUP-RECORD | 50 | Composite (group+type+cat) | 16 | Disclosure group (interest rate mapping) |
| `CVTRA03Y` | 10 | TRAN-TYPE-RECORD | 60 | TRAN-TYPE (PIC X(02)) | 2 | Transaction type master |
| `CVTRA04Y` | 12 | TRAN-CAT-RECORD | 60 | Composite (type+cat) | 6 | Transaction category type master |
| `CSUSR01Y` | 26 | SEC-USER-DATA | 80 | SEC-USR-ID (PIC X(08)) | 8 | User security/authentication |

##### Communication and Navigation Structures

| Copybook | LOC | Purpose | Key Fields |
|:---------|----:|:--------|:-----------|
| `COCOM01Y` | 47 | CICS COMMAREA -- shared across all 17 online programs | FROM/TO-TRANID, FROM/TO-PROGRAM, USER-ID, USER-TYPE, CUST-ID, ACCT-ID, CARD-NUM, PGM-CONTEXT |
| `COMEN02Y` | 101 | Main menu option table (OCCURS 12) | Option number, name, program name, user type filter |
| `COADM02Y` | 62 | Admin menu option table (OCCURS 9) | Option number, name, program name |
| `CVCRD01Y` | 46 | AID key mapping + card work areas | CCARD-AID with 88-level PF-key conditions, REDEFINES for numeric card/acct IDs |

##### Utility and Shared Copybooks

| Copybook | LOC | Type | Purpose |
|:---------|----:|:-----|:--------|
| `CSLKPCDY` | 1,318 | Data | **Largest copybook** -- lookup tables (US phone area codes, state codes, state+zip combos) |
| `CSUTLDPY` | 375 | Data | Date validation working storage (COMP-3, COMP, BINARY types, 88-level conditions) |
| `CVEXPORT` | 103 | Data | Multi-record export layout with REDEFINES over 5 record types (COMP, COMP-3, OCCURS) |
| `CSUTLDWY` | 89 | **Procedure** | Date validation logic (leap year, DoB, reasonableness checks) -- included via COPY in PROCEDURE DIVISION |
| `CSSTRPFY` | 85 | **Procedure** | AID-to-PFKey mapping EVALUATE block -- included via COPY in 5 programs |
| `CSDAT01Y` | 58 | Data | Current date/time work area with REDEFINES for multiple display formats |
| `CODATECN` | 52 | Data | Date conversion I/O record (YYYYMMDD <-> YYYY-MM-DD) |
| `CVTRA07Y` | 73 | Data | Transaction report formatting layouts (headers, detail lines, totals with edit masks) |
| `COTTL01Y` | 27 | Constants | Screen title literals |
| `CSMSG01Y` | 24 | Constants | Common message strings |
| `CSMSG02Y` | 35 | Data | Abend routine work area |
| `CSSETATY` | 30 | **Procedure** | Screen attribute setting snippet -- COPY REPLACING used 39 times in `COACTUPC` alone |

##### BMS Map Copybooks (17 files in `app/cpy-bms/`, auto-generated)

Each maps 1:1 to a BMS source map and defines the symbolic field names used in SEND MAP / RECEIVE MAP operations:

`COACTUP`, `COACTVW`, `COADM01`, `COBIL00`, `COCRDLI`, `COCRDSL`, `COCRDUP`, `COMEN01`, `CORPT00`, `COSGN00`, `COTRN00`, `COTRN01`, `COTRN02`, `COUSR00`, `COUSR01`, `COUSR02`, `COUSR03`

##### Optional Module Copybooks (8 files)

| Copybook | LOC | Module | Purpose |
|:---------|----:|:-------|:--------|
| `CIPAUDTY` | 54 | IMS-DB2-MQ | IMS segment: pending authorization detail (COMP-3 keys, 88-level match status) |
| `CIPAUSMY` | 31 | IMS-DB2-MQ | IMS segment: pending authorization summary (COMP-3 balances, OCCURS 5) |
| `CCPAURQY` | 36 | IMS-DB2-MQ | MQ authorization request (ISO-8583-like fields) |
| `CCPAURLY` | 24 | IMS-DB2-MQ | MQ authorization reply |
| `CCPAUERY` | 40 | IMS-DB2-MQ | Error log record (88-level severity/subsystem codes) |
| `IMSFUNCS` | 26 | IMS-DB2-MQ | IMS DL/I function codes (GU, GHU, GN, ISRT, DLET, REPL) |
| `CSDB2RWY` | 46 | DB2 Tran Types | DB2 working storage (SQLCODE, DSNTIAC formatting, OCCURS 10 message lines) |
| `CSDB2RPY` | 89 | DB2 Tran Types | DB2 procedure code (priming query, error formatting via DSNTIAC) |

##### Copybook Fan-Out (most referenced copybooks across core programs)

| Copybook | # Programs Using It | Role |
|:---------|--------------------:|:-----|
| `CSSETATY` | 39 invocations (in 1 program via REPLACING) | Screen attribute setter |
| `COCOM01Y` | 17 | COMMAREA (all online programs) |
| `DFHBMSCA` | 17 | BMS symbolic attributes |
| `DFHAID` | 17 | CICS AID key constants |
| `CSMSG01Y` | 17 | Common messages |
| `CSDAT01Y` | 17 | Date/time work area |
| `COTTL01Y` | 17 | Screen titles |
| `CVACT03Y` | 13 | Cross-reference record |
| `CVACT01Y` | 12 | Account record |
| `CSUSR01Y` | 12 | User security record |

#### 2.2.3 Dead Code and Redundancy Analysis

##### Confirmed Dead Code

| Artifact | Type | Evidence | Recommendation |
|:---------|:-----|:---------|:---------------|
| `UNUSED1Y.cpy` | Copybook | Zero references in any `.cbl` file. Structure mirrors `CSUSR01Y` (80-byte user record with renamed fields). | **Remove.** Verified dead. |
| `CUSTREC.cpy` | Copybook | Referenced only by `CBSTM03A.CBL`. Identical structure to `CVCUS01Y.cpy` (500-byte CUSTOMER-RECORD). | **Consolidate.** Replace with COPY CVCUS01Y to eliminate duplication. |

##### Commented-Out COPY Statements (latent dead references)

| Program | Commented-Out Copy | Notes |
|:--------|:-------------------|:------|
| `COCRDLIC` | `*COPY COCRDSL`, `*COPY CSMSG02Y` | Previously used card-search and abend copybooks, now removed |
| `COCRDSLC` | `*COPY CVACT01Y`, `*COPY CVACT03Y` | Account/cross-ref records no longer directly used (accessed via other paths) |
| `COCRDUPC` | `*COPY CVACT01Y`, `*COPY CVACT03Y` | Same as above |
| `COSGN00C` | `*COPY DFHATTR` | Legacy attribute constants, replaced by `DFHBMSCA` |
| `COUSR01C` | `*COPY DFHATTR` | Same as above |

##### Redundancy Patterns

| Pattern | Instances | Impact |
|:--------|:----------|:-------|
| **Duplicated CSUTLDTC parameter block** | `COTRN02C` (lines 62-69) and `CORPT00C` (lines 129-136) define identical inline `CSUTLDTC-PARM` structures instead of using a shared copybook | Low risk but adds maintenance burden; should be extracted to a shared copybook |
| **CUSTREC vs CVCUS01Y** | Two copybooks with identical 500-byte CUSTOMER-RECORD layout | `CBSTM03A` should switch to `CVCUS01Y` |
| **CSSETATY x39 REPLACING** | `COACTUPC` includes `CSSETATY` 39 times with COPY REPLACING for each screen field | Inflates effective LOC; a table-driven approach would reduce ~120 lines to ~15 |
| **Batch reader programs** | `CBACT02C`, `CBACT03C`, `CBCUS01C` are structurally identical (178 LOC each) differing only in record layout and file name | Could be parameterized into a single generic reader |

### 2.3 Job Control Language (JCL) and Batch Processes

#### Batch Job Inventory

##### Data Initialization Jobs (executed once or on environment refresh)

| Job | Program | Datasets Affected | Purpose |
|:----|:--------|:------------------|:--------|
| `DUSRSECJ` | IEBGENER + IDCAMS | USRSEC.VSAM.KSDS | Create user security file from inline JCL data |
| `DEFGDGB` | IDCAMS | GDG bases | Define Generation Data Group bases for backups |
| `DEFGDGD` | IDCAMS | GDG bases (DB2) | Define additional GDG bases for DB2 module |
| `ESDSRRDS` | IDCAMS | ESDS, RRDS files | Create ESDS and RRDS VSAM file types |

##### Nightly Batch Cycle (critical path, executed in sequence)

The full batch cycle runs as a sequential pipeline gated by CLOSEFIL (start) and OPENFIL (end). CICS online access is **unavailable** during this window.

```
CLOSEFIL ──> Data Refresh Phase ──> Core Processing Phase ──> OPENFIL
                                         │
              ┌──────────────────────────┘
              ▼
   POSTTRAN ──> INTCALC ──> COMBTRAN ──> CREASTMT ──> TRANIDX
```

**Phase 1 -- File Close (gate)**

| Job | Program | Purpose |
|:----|:--------|:--------|
| `CLOSEFIL` | CEMT (SDSF) | Close all VSAM files in CICS to allow batch exclusive access |

**Phase 2 -- Data Refresh (parallelizable)**

| Job | Program | Input | Output | Purpose |
|:----|:--------|:------|:-------|:--------|
| `ACCTFILE` | IDCAMS | ACCTDATA.PS | ACCTDATA.VSAM.KSDS | Delete/define/load account VSAM |
| `CARDFILE` | IDCAMS | CARDDATA.PS | CARDDATA.VSAM.KSDS + AIX | Delete/define/load card VSAM + build AIX |
| `CUSTFILE` | IDCAMS | CUSTDATA.PS | CUSTDATA.VSAM.KSDS | Delete/define/load customer VSAM |
| `XREFFILE` | IDCAMS | CARDXREF.PS | CARDXREF.VSAM.KSDS + AIX | Delete/define/load cross-ref VSAM + build AIX |
| `TRANBKP` | IDCAMS (REPROC) | TRANSACT.VSAM.KSDS | TRANSACT.BKUP (GDG) | Unload and backup transaction master |
| `TRANFILE` | IDCAMS | DALYTRAN.PS.INIT | TRANSACT.VSAM.KSDS | Reload transaction master from init data |
| `DISCGRP` | IDCAMS | DISCGRP.PS | DISCGRP.VSAM.KSDS | Refresh disclosure group reference |
| `TCATBALF` | IDCAMS | TCATBALF.PS | TCATBALF.VSAM.KSDS | Refresh transaction category balance |
| `TRANTYPE` | IDCAMS | TRANTYPE.PS | TRANTYPE.VSAM.KSDS | Refresh transaction type reference |
| `TRANCATG` | IDCAMS | TRANCATG.PS | TRANCATG.VSAM.KSDS | Refresh transaction category reference |
| `DUSRSECJ` | IEBGENER + IDCAMS | Inline data | USRSEC.VSAM.KSDS | Refresh user security |

**Phase 3 -- Core Processing (strictly sequential)**

| Job | Program | Inputs | Outputs | Purpose |
|:----|:--------|:-------|:--------|:--------|
| `POSTTRAN` | `CBTRN02C` | DALYTRAN, TRANSACT, CARDXREF, ACCTDATA | Updated TRANSACT, ACCTDATA; DALYREJS; TCATBALF | Post daily transactions, update account balances, reject invalid records |
| `INTCALC` | `CBACT04C` | TCATBALF, CARDXREF, ACCTDATA, DISCGRP | SYSTRAN (GDG), updated ACCTDATA | Calculate interest and fees, generate system transactions |
| `COMBTRAN` | SORT | TRANSACT.BKUP, SYSTRAN | TRANSACT.COMBINED | Merge backup + system-generated transactions |
| `CREASTMT` | `CBSTM03A` | TRANSACT.COMBINED, CUSTDATA | Statement output | Generate customer statements |
| `TRANIDX` | IDCAMS | TRANSACT.VSAM.KSDS | AIX + PATH | Rebuild alternate index on transaction file |

**Phase 4 -- File Open (gate)**

| Job | Program | Purpose |
|:----|:--------|:--------|
| `OPENFIL` | CEMT (SDSF) | Reopen all VSAM files in CICS, restoring online access |
| `WAITSTEP` | `COBSWAIT` (ASM) | Timer delay (36 seconds) between phases for synchronization |

##### Reporting and Utility Jobs

| Job | Program | Purpose |
|:----|:--------|:--------|
| `TRANREPT` | `CBTRN03C` (via TRANREPT.prc) | Generate transaction detail report (date-filtered, sorted by card) |
| `PRTCATBL` | SORT (via REPROC.prc) | Print transaction category balance report |
| `READACCT` | IDCAMS REPRO | Diagnostic: dump account VSAM to sequential |
| `READCARD` | IDCAMS REPRO | Diagnostic: dump card VSAM to sequential |
| `READCUST` | IDCAMS REPRO | Diagnostic: dump customer VSAM to sequential |
| `READXREF` | IDCAMS REPRO | Diagnostic: dump cross-ref VSAM to sequential |
| `CBEXPORT` | `CBEXPORT` | Export data to EBCDIC flat file (multi-record format) |
| `CBIMPORT` | `CBIMPORT` | Import data from EBCDIC flat file with validation |
| `FTPJCL` | TCPIP FTP | Transfer files to/from remote systems |
| `TXT2PDF1` | TXT2PDF | Convert text reports to PDF |
| `INTRDRJ1/2` | Internal Reader | Submit JCL from within JCL |
| `DALYREJS` | IEFBR14 | Allocate daily rejection file (empty step) |

##### Optional Module Batch Jobs

| Job | Program | Module | Purpose |
|:----|:--------|:-------|:--------|
| `CREADB21` | DSNTEP4 | DB2 Tran Types | Create DB2 database and load transaction type tables |
| `TRANEXTR` | DSNTIAUL | DB2 Tran Types | Extract latest DB2 data for transaction types/categories |
| `MNTTRDB2` | `COBTUPDT` (via IKJEFT01) | DB2 Tran Types | Batch maintenance of transaction type table (add/delete/update) |
| `CBPAUP0J` | `CBPAUP0C` (via DFSRRC00 BMP) | IMS-DB2-MQ Auth | Purge expired authorizations from IMS DB |

##### JCL Procedures (reusable, in `app/proc/`)

| Procedure | Parameters | Used By | Purpose |
|:----------|:-----------|:--------|:--------|
| `REPROC.prc` | FILEIN, FILEOUT, CNTLLIB | TRANBKP, PRTCATBL, TRANREPT | Generic IDCAMS REPRO (VSAM unload) |
| `TRANREPT.prc` | CNTLLIB, FILEIN, FILEOUT, date filters | TRANREPT | Three-step pipeline: REPRO -> SORT (filter/sort) -> CBTRN03C (format) |

#### Scheduler Definitions

Two scheduler configurations define production job dependencies:

**Control-M** (`app/scheduler/CardDemo.controlm` -- XML format):

| Folder | Frequency | Job Chain | Purpose |
|:-------|:----------|:----------|:--------|
| DAILY-TransactionBackup | Daily | CLOSEFIL -> TRANBKP -> WAITSTEP -> OPENFIL | Nightly backup |
| WEEKLY-TransactionTypesDBRefresh | Weekly | MNTTRDB2 -> (triggers DisclosureGroupsRefresh) | DB2 type maintenance |
| WEEKLY-DisclosureGroupsRefresh | Weekly (triggered) | CLOSEFIL -> DISCGRP -> WAITSTEP -> OPENFIL | Reference data refresh |
| MONTHLY-InterestCalculation | Monthly | CLOSEFIL -> INTCALC -> COMBTRAN -> WAITSTEP -> OPENFIL | Interest computation cycle |

**CA7** (`app/scheduler/CardDemo.ca7`):

Defines the same job set with CA7-native dependency syntax. Features a multi-branch flow: CLOSEFIL triggers parallel paths (CBPAUP0J and POSTTRAN), converging at WAITSTEP before OPENFIL, with secondary branches for TRANTYPE/TRANCATG/TCATBALF.

### 2.4 Data Layer

#### 2.4.1 VSAM / Flat File Structures

##### Primary VSAM KSDS Clusters

| CICS File | Dataset Name | Key Field | Key Len | Key Pos | Rec Size | Copybook | Purpose |
|:----------|:-------------|:----------|--------:|--------:|---------:|:---------|:--------|
| `ACCTDAT` | AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS | ACCT-ID | 11 | 0 | 300 | CVACT01Y | Account master |
| `CARDDAT` | AWS.M2.CARDDEMO.CARDDATA.VSAM.KSDS | CARD-NUM | 16 | 0 | 150 | CVACT02Y | Card master |
| `CUSTDAT` | AWS.M2.CARDDEMO.CUSTDATA.VSAM.KSDS | CUST-ID | 9 | 0 | 500 | CVCUS01Y | Customer master |
| `CCXREF` | AWS.M2.CARDDEMO.CARDXREF.VSAM.KSDS | XREF-CARD-NUM | 16 | 0 | 50 | CVACT03Y | Card-account-customer xref |
| `TRANSACT` | AWS.M2.CARDDEMO.TRANSACT.VSAM.KSDS | TRAN-ID | 16 | 0 | 350 | CVTRA05Y | Transaction master |
| `USRSEC` | AWS.M2.CARDDEMO.USRSEC.VSAM.KSDS | SEC-USR-ID | 8 | 0 | 80 | CSUSR01Y | User security |
| -- | AWS.M2.CARDDEMO.DISCGRP.VSAM.KSDS | Composite | 16 | 0 | 50 | CVTRA02Y | Disclosure groups |
| -- | AWS.M2.CARDDEMO.TRANTYPE.VSAM.KSDS | TRAN-TYPE | 2 | 0 | 60 | CVTRA03Y | Transaction types |
| -- | AWS.M2.CARDDEMO.TCATBALF.VSAM.KSDS | Composite | 17 | 0 | 50 | CVTRA01Y | Category balances |

All files: SHAREOPTIONS(2,3), LSR Pool 1, READINTEG(UNCOMMITTED), UPDATEMODEL(LOCKING).

##### Alternate Indexes (AIX)

| Base Cluster | AIX Dataset | AIX Key | Key Len | Key Pos | Unique | Purpose |
|:-------------|:------------|:--------|--------:|--------:|:-------|:--------|
| CARDDATA | AWS.M2.CARDDEMO.CARDDATA.VSAM.AIX | CARD-ACCT-ID | 11 | 16 | No | Find all cards for an account |
| CARDXREF | AWS.M2.CARDDEMO.CARDXREF.VSAM.AIX | XREF-ACCT-ID | 11 | 25 | No | Find all xrefs for an account |
| TRANSACT | AWS.M2.CARDDEMO.TRANSACT.VSAM.AIX | TRAN-PROC-TS | 26 | 304 | No | Browse transactions by processed timestamp |

CICS path names for AIX access: `CARDAIX`, `CXACAIX` (TRANSACT AIX has no separate CICS file definition; rebuilt by TRANIDX job).

##### Flat File / GDG Datasets

| Dataset | Format | Rec Len | Purpose |
|:--------|:-------|--------:|:--------|
| AWS.M2.CARDDEMO.*.PS | FB | Varies | Sequential load files (account, card, customer, etc.) |
| AWS.M2.CARDDEMO.TRANSACT.BKUP | FB 350 | 350 | GDG: transaction backup generations |
| AWS.M2.CARDDEMO.SYSTRAN | FB 350 | 350 | GDG: system-generated transactions (interest, fees) |
| AWS.M2.CARDDEMO.TRANSACT.COMBINED | FB 350 | 350 | GDG: merged transactions (backup + system) |
| AWS.M2.CARDDEMO.DALYREJS | FB 350 | 350 | Daily rejected transactions from POSTTRAN |

#### 2.4.2 Relational Database Schema (DB2, IMS)

##### DB2 (optional -- app-transaction-type-db2)

**Table: CARDDEMO.TRANSACTION_TYPE**

| Column | Type | Description |
|:-------|:-----|:------------|
| TRAN_TYPE | CHAR(2) | Transaction type code (primary key) |
| TRAN_TYPE_DESC | VARCHAR(50) | Description |

- Accessed via embedded static SQL in `COTRTLIC`, `COTRTUPC`, `COBTUPDT`
- Cursor-based browsing (OPEN/FETCH/CLOSE) for list screen
- DML: INSERT, UPDATE, DELETE with SQLCA error handling
- DB2 Plan: `CARDDEMO`
- Error formatting: DSNTIAC utility for human-readable SQL error messages

##### IMS DB (optional -- app-authorization-ims-db2-mq)

**Hierarchical structure (two databases):**

```
PADFL (Pending Authorization File)
└── Root segment: Authorization detail
    ├── PA-AUTHORIZATION-KEY (COMP-3 date+time composite)
    ├── PA-CARD-NUM, PA-AUTH-TYPE, PA-TRANSACTION-AMT
    ├── PA-AUTH-RESP-CODE (88: APPROVED = '00')
    ├── PA-MATCH-STATUS (88: PENDING/DECLINED/EXPIRED/MATCHED)
    └── PA-AUTH-FRAUD (88: CONFIRMED/REMOVED)

PAUT (Pending Authorization Summary)
└── Root segment: Account-level summary
    ├── PA-ACCT-ID (COMP-3), PA-CUST-ID
    ├── PA-CREDIT-LIMIT, PA-CASH-LIMIT (COMP-3)
    ├── PA-CREDIT-BALANCE, PA-CASH-BALANCE (COMP-3)
    ├── PA-ACCOUNT-STATUS OCCURS 5 TIMES
    └── PA-APPROVED/DECLINED-AUTH-CNT/AMT
```

- PSB: `PSBPAUTB` (used by both online COPAUS* and batch CBPAUP0C)
- DL/I calls: GU, GHU, GN, GHN, GNP, ISRT, DLET, REPL (defined in `IMSFUNCS.cpy`)
- Batch execution via BMP (DFSRRC00)

#### 2.4.3 Data Flows and Lineage

##### Entity-Relationship Summary

```
CUSTOMER (CVCUS01Y, 500B)
    │
    │ 1:N via CUST-ID
    ▼
CARD-XREF (CVACT03Y, 50B) ───── links ─────> ACCOUNT (CVACT01Y, 300B)
    │ XREF-CARD-NUM                              ACCT-ID
    │ XREF-CUST-ID                               │
    │ XREF-ACCT-ID                               │ 1:N
    │                                             ▼
    │ 1:1                                  TRAN-CAT-BAL (CVTRA01Y, 50B)
    ▼                                      DIS-GROUP (CVTRA02Y, 50B)
CARD (CVACT02Y, 150B)
    │ CARD-NUM, CARD-ACCT-ID
    │
    │ 1:N via TRAN-CARD-NUM
    ▼
TRANSACTION (CVTRA05Y, 350B)
    │ TRAN-TYPE-CD ──> TRAN-TYPE (CVTRA03Y, 60B)
    │ TRAN-CAT-CD ──> TRAN-CAT (CVTRA04Y, 60B)
```

##### Program-to-File Access Matrix (core programs)

| Program | ACCTDAT | CARDDAT | CUSTDAT | CCXREF | TRANSACT | USRSEC | CARDAIX | CXACAIX |
|:--------|:-------:|:-------:|:-------:|:------:|:--------:|:------:|:-------:|:-------:|
| COSGN00C | | | | | | R | | |
| COMEN01C | | | | | | | | |
| COADM01C | | | | | | | | |
| COACTVWC | R | R | R | R | | | | R |
| COACTUPC | RW | | R | R | | | | |
| COCRDLIC | | R | | | | | R | |
| COCRDSLC | | R | R | R | | | | |
| COCRDUPC | | RW | R | | | | | |
| COTRN00C | | | | | R | | | |
| COTRN01C | | | | | R | | | |
| COTRN02C | R | | | R | W | | | |
| COBIL00C | RW | | | R | W | | | |
| CORPT00C | | | | | R | | | |
| COUSR00C | | | | | | R | | |
| COUSR01C | | | | | | W | | |
| COUSR02C | | | | | | RW | | |
| COUSR03C | | | | | | RW | | |
| CBTRN02C | RW | | | R | RW | | | |
| CBACT04C | RW | | | R | W | | | |
| CBTRN03C | | | | R | R | | | |
| CBSTM03A | | | R | | R | | | |

*R = READ/BROWSE, W = WRITE/ADD, RW = READ + REWRITE/UPDATE*

### 2.5 Infrastructure and Platform

#### 2.5.1 Mainframe Environment (IBM Z / MF Specs)

CardDemo is designed for and tested on the **AWS Mainframe Modernization** managed runtime (Micro Focus or Blu Age engine), which emulates an IBM Z mainframe environment. The application is also compatible with native IBM Z hardware running z/OS.

**Dataset conventions:**

| Convention | Value |
|:-----------|:------|
| High Level Qualifier (HLQ) | `AWS.M2` |
| Source library format | FB (Fixed Block), LRECL 80 |
| Load library | `AWS.M2.CARDDEMO.LOADLIB` |
| COBOL source | `AWS.M2.CARDDEMO.CBL` |
| Copybooks | `AWS.M2.CARDDEMO.CPY` |
| BMS maps | `AWS.M2.CARDDEMO.BMS` |
| JCL | `AWS.M2.CARDDEMO.JCL` |
| Assembler | `AWS.M2.CARDDEMO.ASM` |
| Macro library | `AWS.M2.CARDDEMO.MACLIB` |

#### 2.5.2 CICS / IMS Transaction Processing

##### CICS Resource Definitions (from `CARDDEMO.CSD`)

**Transactions (21 defined):**

| Trans ID | Program | Function | Category |
|:---------|:--------|:---------|:---------|
| CC00 | COSGN00C | Signon (application entry) | Auth |
| CM00 | COMEN01C | Main menu | Navigation |
| CA00 | COADM01C | Admin menu | Navigation |
| CAVW | COACTVWC | Account view | Account |
| CAUP | COACTUPC | Account update | Account |
| CCLI | COCRDLIC | Card list | Card |
| CCDL | COCRDSLC | Card detail | Card |
| CCUP | COCRDUPC | Card update | Card |
| CT00 | COTRN00C | Transaction list | Transaction |
| CT01 | COTRN01C | Transaction view | Transaction |
| CT02 | COTRN02C | Transaction add | Transaction |
| CR00 | CORPT00C | Reports | Reporting |
| CB00 | COBIL00C | Bill payment | Billing |
| CU00 | COUSR00C | User list | Admin |
| CU01 | COUSR01C | User add | Admin |
| CU02 | COUSR02C | User update | Admin |
| CU03 | COUSR03C | User delete | Admin |
| CDV1 | COCRDSEC | Card search (developer) | Card |
| CPVS | COPAUS0C | Pending auth summary (opt) | Auth (opt) |
| CPVD | COPAUS1C | Pending auth detail (opt) | Auth (opt) |
| CP00 | COPAUA0C | Process auth requests (opt) | Auth (opt) |

All transactions: TASKDATALOC(ANY), ISOLATE(YES), WAIT(YES), DUMP(YES), TRACE(YES).

**CICS Files (8 file resources + 2 AIX paths):**

All files in group `CARDDEMO`, LSR Pool 1, full CRUD enabled (ADD, BROWSE, DELETE, READ, UPDATE).

**Transient Data Queue:**

| Queue | Type | DD Name | Purpose |
|:------|:-----|:--------|:--------|
| JOBS | Extrapartition | INREADER | Submit JCL to JES for batch execution from online programs |

**CICS Libraries:**

| Library | Dataset | Ranking | Status |
|:--------|:--------|--------:|:-------|
| CARDDLIB | AWS.M2.CARDDEMO.LOADLIB | 50 | Enabled |
| COM2DOLL | AWS.M2.CARDDEMO.LOADLIB | 50 | Disabled |

##### Inter-Program Communication Pattern

All online programs follow a **pseudo-conversational** model:

1. Program receives control via EXEC CICS XCTL (transfer) or EXEC CICS RETURN TRANSID (re-entry)
2. On first entry (PGM-CONTEXT=0): initialize map, send blank screen
3. On re-entry (PGM-CONTEXT=1): RECEIVE MAP, process input, access VSAM, SEND MAP with results
4. Return control: EXEC CICS RETURN TRANSID(self) COMMAREA(CARDDEMO-COMMAREA) to re-invoke, or EXEC CICS XCTL to navigate to another program

The `CARDDEMO-COMMAREA` (COCOM01Y, ~192 bytes) is the sole inter-program state carrier. It contains: routing info (FROM/TO program/transaction), user context (ID, type), and selected business entity keys (customer ID, account ID, card number).

##### Assembler Utilities

| Utility | Source | Called By | Purpose |
|:--------|:-------|:----------|:--------|
| `MVSWAIT` | `app/asm/MVSWAIT.asm` | `COBSWAIT` (via CALL) | Interval timer using MVS WAIT macro; parameter = centiseconds |
| `COBDATFT` | `app/asm/COBDATFT.asm` | COBOL date routines (via CALL) | Date format converter: Type 1 = MMDDYY->YYYY-MM-DD, Type 2 = YYYY-MM-DD->YYYYMMDD |

#### 2.5.3 TPM, Schedulers (TWS, CA7)

See Section 2.3 "Scheduler Definitions" for the full Control-M and CA7 job dependency chains. Summary:

| Scheduler | Config File | Format | Job Chains Defined |
|:----------|:------------|:-------|:-------------------|
| **Control-M** | `app/scheduler/CardDemo.controlm` | XML | 4 folders: Daily backup, Weekly type refresh, Weekly disclosure refresh, Monthly interest calc |
| **CA7** | `app/scheduler/CardDemo.ca7` | CA7 native | Multi-branch: CLOSEFIL -> parallel CBPAUP0J + POSTTRAN -> WAITSTEP -> OPENFIL, with secondary TRANTYPE/TRANCATG/TCATBALF branches |

**Key scheduling constraints:**
- CLOSEFIL must complete before any batch job that accesses VSAM files
- OPENFIL must be the final job to restore CICS online access
- POSTTRAN must complete before INTCALC (interest needs updated balances)
- INTCALC must complete before COMBTRAN (system transactions must be generated first)
- TRANIDX must run after COMBTRAN (AIX built on final transaction file)

### 2.6 Integration and Interfaces

#### 2.6.1 External Network Connections (Visa/Mastercard, ISO 8583 messaging)

CardDemo does **not** implement direct connections to external card networks (Visa, Mastercard, etc.) or ISO 8583 messaging. However, the optional authorization module (`app-authorization-ims-db2-mq`) provides a **simulated** authorization request/response pattern via IBM MQ that mirrors the structure of real-world card network integration:

| Field in `CCPAURQY.cpy` | ISO 8583 Equivalent | Purpose |
|:-------------------------|:--------------------|:--------|
| PA-RQ-MESSAGE-TYPE | Message Type Indicator (MTI) | Request type identifier |
| PA-RQ-PROCESSING-CODE | Processing Code (Field 3) | Transaction processing type |
| PA-RQ-TRANSACTION-AMT | Amount, Transaction (Field 4) | Authorization amount |
| PA-RQ-MERCHANT-CATAGORY-CODE | Merchant Category Code (Field 18) | MCC classification |
| PA-RQ-ACQR-COUNTRY-CODE | Acquiring Country Code (Field 19) | Originating country |
| PA-RQ-POS-ENTRY-MODE | POS Entry Mode (Field 22) | Card-present/not-present indicator |

This structure would need to be mapped to actual ISO 8583 or ISO 20022 message formats in a production deployment.

#### 2.6.2 Internal System Interfaces (Core Banking, GL, Fraud)

CardDemo is a **self-contained demo application** and does not integrate with external core banking, general ledger, or fraud systems. The following interfaces are internal:

| Interface | Mechanism | From | To | Data |
|:----------|:----------|:-----|:---|:-----|
| Online -> Batch | TDQ `JOBS` (INREADER) | `CORPT00C` | JES (TRANREPT job) | JCL for report submission |
| Batch -> VSAM | Sequential file I/O | POSTTRAN, INTCALC | VSAM files | Updated account balances, transactions |
| MQ Account Inquiry (opt) | MQ GET/PUT | External requester | `COACCT01` | Account lookup request/response |
| MQ Date Inquiry (opt) | MQ GET/PUT | External requester | `CODATE01` | System date request/response |
| MQ Auth Request (opt) | MQ GET/PUT + IMS DL/I | External requester | `COPAUA0C` | Authorization decision with IMS + DB2 |
| COBOL -> ASM | CALL 'MVSWAIT' | `COBSWAIT` | ASM utility | Timer delay parameter |
| COBOL -> ASM | CALL 'COBDATFT' | Date routines | ASM utility | Date format conversion |
| COBOL -> LE | CALL 'CSUTLDTC' / CEEDAYS | `COTRN02C`, `CORPT00C` | LE runtime | Date validation |

##### MQ Queue Topology (optional modules)

| Queue Name | Direction | Program | Purpose |
|:-----------|:----------|:--------|:--------|
| CARD.DEMO.REPLY.ACCOUNT | PUT (response) | COACCT01 | Account inquiry reply |
| CARD.DEMO.REPLY.DATE | PUT (response) | CODATE01 | Date inquiry reply |
| CARD.DEMO.ERROR | PUT (error) | COACCT01, CODATE01 | Error responses |
| (trigger queue) | GET (request) | COPAUA0C | Authorization request input |
| (reply queue) | PUT (response) | COPAUA0C | Authorization decision output |

MQ interface uses: MQOPEN, MQGET (with SYNCPOINT, 5000ms timeout), MQPUT (MQFMT-STRING), MQCLOSE.

#### 2.6.3 3rd-Party Vendors and APIs

CardDemo has **no direct 3rd-party API integrations**. All external connectivity is limited to:

| Interface | Technology | Purpose | Direction |
|:----------|:-----------|:--------|:----------|
| FTP (operational) | `scripts/` shell + FTPJCL.JCL | Upload source / submit JCL to mainframe | Outbound |
| Internal Reader | INTRDRJ1/J2 JCL | Submit JCL from within JCL | Internal |
| TXT2PDF | TXT2PDF1.JCL | Convert text reports to PDF format | Internal |
| DSNTIAC | DB2 utility | Format DB2 error messages (in DB2 optional module) | Internal |
| DFSRRC00 | IMS BMP | Execute IMS batch programs (in IMS optional module) | Internal |

**Modernization note:** In a production card management system, this section would enumerate connections to: card network gateways (Visa/MC/Amex), fraud scoring engines (FICO, Featurespace), credit bureaus (Experian, TransUnion, Equifax), core banking platforms, general ledger systems, document management, and regulatory reporting APIs. CardDemo's clean integration boundary is an advantage for modernization -- new integrations can be designed from scratch rather than reverse-engineered.

---

## 3. Business Logic Extraction and Documentation

This section catalogs every business rule implemented in COBOL source code, organized by functional domain. Each rule is traceable to its source program and, where applicable, the specific validation or computation logic. These rules form the **functional requirements baseline** that the modernized system must replicate or consciously supersede.

### 3.1 Credit Card Lifecycle Rules (Issuance, Activation, Closure)

#### 3.1.1 Card Data Model

Each card is represented as a 150-byte VSAM record (`CVACT02Y`):

| Field | PIC | Constraints | Source |
|:------|:----|:------------|:-------|
| CARD-NUM | X(16) | Primary key. Must be 16-digit numeric, non-zero. | `COCRDUPC` |
| CARD-ACCT-ID | 9(11) | Foreign key to ACCOUNT-RECORD. Must exist in ACCTDAT. | `COCRDUPC` |
| CARD-CVV-CD | 9(03) | 3-digit numeric. | `COCRDUPC` |
| CARD-EMBOSSED-NAME | X(50) | Mandatory. Cannot be blank/all-spaces after trim. | `COCRDUPC` |
| CARD-EXPIRAION-DATE | X(10) | YYYY-MM-DD. Month 1-12, Year 1950-2099, valid calendar day. | `COCRDUPC` |
| CARD-ACTIVE-STATUS | X(01) | `'Y'` (active) or `'N'` (inactive). No other values accepted. | `COCRDUPC` |

#### 3.1.2 Card Status Rules

| Rule ID | Rule | Program | Notes |
|:--------|:-----|:--------|:------|
| CRD-01 | Card active status is a binary toggle: `'Y'` or `'N'` only. | `COCRDUPC` | No multi-state lifecycle (e.g., no "suspended", "blocked", "stolen" states). |
| CRD-02 | Status transitions are unconstrained -- `'Y'`->`'N'` and `'N'`->`'Y'` both allowed without precondition. | `COCRDUPC` | No state machine enforced. |
| CRD-03 | Blank status is rejected with error "Card Status must be YES or NO". | `COCRDUPC` | |
| CRD-04 | **No card issuance program exists.** Cards are loaded via batch (CARDFILE JCL/IDCAMS REPRO). Online system only supports update. | -- | Gap: issuance workflow must be designed for target system. |
| CRD-05 | **No card closure/cancellation program exists.** Closure is modeled as setting CARD-ACTIVE-STATUS = `'N'`. | `COCRDUPC` | No downstream effects (e.g., no account closure trigger, no notification). |

#### 3.1.3 Card Update Validations

| Rule ID | Field | Validation | Error Message |
|:--------|:------|:-----------|:-------------|
| CRD-V01 | CARD-NUM | 16-digit numeric, non-zero | "CARD ID FILTER, IF SUPPLIED MUST BE A 16 DIGIT NUMBER" |
| CRD-V02 | CARD-EMBOSSED-NAME | Non-blank after trim | "Name can NOT be empty" |
| CRD-V03 | CARD-EXPIRY-MONTH | Range 1-12 | "Card expiry month must be between 1 and 12" |
| CRD-V04 | CARD-EXPIRY-YEAR | Range 1950-2099 | "Invalid card expiry year" |
| CRD-V05 | CARD-ACTIVE-STATUS | `'Y'` or `'N'` | "Card Status must be YES or NO" |
| CRD-V06 | (all fields) | No-change detection: if new values = old values, reject update | "No change detected with respect to values fetched" |

#### 3.1.4 Card Access Control

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| CRD-AC1 | **Admin users** (USER-TYPE = `'A'`) can browse/update all cards in the system. | `COCRDLIC` |
| CRD-AC2 | **Regular users** (USER-TYPE = `'U'`) can only see cards linked to their account via COMMAREA ACCT-ID. | `COCRDLIC` |
| CRD-AC3 | Card browse uses CARDAIX (alternate index on CARD-ACCT-ID) to list all cards for an account. | `COCRDLIC` |

#### 3.1.5 Card-Account-Customer Relationship

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| CRD-R01 | Every card must map to exactly one account and one customer via CARD-XREF-RECORD (CCXREF file). | `COCRDSLC`, `COACTVWC` |
| CRD-R02 | The XREF lookup chain is: CARD-NUM -> XREF-CARD-NUM -> XREF-ACCT-ID -> ACCTDAT, XREF-CUST-ID -> CUSTDAT. | `COCRDSLC` |
| CRD-R03 | If cross-reference not found, error "Account ID NOT found" or "Card Number NOT found". | `COTRN02C` |

### 3.2 Transaction Processing Rules (Authorization, Clearing, Settlement)

#### 3.2.1 Online Transaction Entry (`COTRN02C`)

##### Mandatory Fields

All fields below are required for a new transaction:

| Field | Format | Validation | Error |
|:------|:-------|:-----------|:------|
| Transaction Type Code | Numeric | Must be numeric | "is not valid" |
| Transaction Category Code | Numeric (4 digits) | Must be numeric | "is not valid" |
| Transaction Source | X(10) | Non-blank | "can NOT be empty" |
| Transaction Amount | `[+/-]99999999.99` | Sign char + 8 numeric + `.` + 2 numeric | Format-level check |
| Description | X(100) | Non-blank | "can NOT be empty" |
| Original Date | YYYY-MM-DD | Validated via `CSUTLDTC` (LE CEEDAYS API) | "is not a valid date" |
| Processing Date | YYYY-MM-DD | Validated via `CSUTLDTC` | "is not a valid date" |
| Merchant ID | 9(09) | Must be numeric, non-blank | "is not valid" |
| Merchant Name | X(50) | Non-blank | "can NOT be empty" |
| Merchant City | X(50) | Non-blank | "can NOT be empty" |
| Merchant ZIP | X(10) | Non-blank | "can NOT be empty" |

##### Transaction ID Generation

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| TRN-01 | Transaction IDs are auto-generated by browsing TRANSACT at HIGH-VALUES, reading the last (highest) TRAN-ID via READPREV, and adding 1. | `COTRN02C` |
| TRN-02 | If DUPKEY/DUPREC on write: error "Tran ID already exist". | `COTRN02C` |

##### Cross-Reference Validation

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| TRN-03 | User must provide either Account ID or Card Number (at least one). | `COTRN02C` |
| TRN-04 | If Account ID provided: lookup CXACAIX (AIX by account) to resolve card number. | `COTRN02C` |
| TRN-05 | If Card Number provided: lookup CCXREF (primary key) to resolve account ID. | `COTRN02C` |
| TRN-06 | If neither found: error "Account ID NOT found" or "Card Number NOT found". | `COTRN02C` |

##### Confirmation

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| TRN-07 | User must explicitly confirm with `'Y'` or `'y'` before the transaction is written. `'N'`/`'n'`/blank = cancel. Any other value = error "Invalid value. Valid values are (Y/N)". | `COTRN02C` |

#### 3.2.2 Batch Transaction Posting (`CBTRN02C`)

This is the **core nightly processing program**. It reads daily transactions (DALYTRAN), validates each one, updates account balances, and writes posted transactions to the master file.

##### Validation Pipeline (sequential -- first failure rejects)

| Rule ID | Check | Reject Code | Error Message | Source |
|:--------|:------|:-----------:|:--------------|:-------|
| BTR-01 | Card number must exist in XREF-FILE | **100** | "INVALID CARD NUMBER FOUND" | `CBTRN02C` |
| BTR-02 | XREF-ACCT-ID must exist in ACCOUNT-FILE | **101** | "ACCOUNT RECORD NOT FOUND" | `CBTRN02C` |
| BTR-03 | Credit limit check: `ACCT-CREDIT-LIMIT >= (ACCT-CURR-CYC-CREDIT - ACCT-CURR-CYC-DEBIT + DALYTRAN-AMT)` | **102** | "OVERLIMIT TRANSACTION" | `CBTRN02C` |
| BTR-04 | Account expiration check: `ACCT-EXPIRAION-DATE >= DALYTRAN-ORIG-TS(1:10)` | **103** | "TRANSACTION RECEIVED AFTER ACCT EXPIRATION" | `CBTRN02C` |

Rejected transactions are written to DALYREJS-FILE with the original record plus a trailer containing the reject code and description.

##### Account Balance Update (on valid transactions)

| Rule ID | Rule | Computation |
|:--------|:-----|:------------|
| BTR-05 | Current balance always updated. | `ACCT-CURR-BAL = ACCT-CURR-BAL + DALYTRAN-AMT` |
| BTR-06 | If DALYTRAN-AMT >= 0 (credit): add to cycle credit. | `ACCT-CURR-CYC-CREDIT = ACCT-CURR-CYC-CREDIT + DALYTRAN-AMT` |
| BTR-07 | If DALYTRAN-AMT < 0 (debit): add to cycle debit. | `ACCT-CURR-CYC-DEBIT = ACCT-CURR-CYC-DEBIT + DALYTRAN-AMT` |
| BTR-08 | Transaction category balance (TCATBALF) created or updated. Key = ACCT-ID + TYPE-CD + CAT-CD. | `TRAN-CAT-BAL = TRAN-CAT-BAL + DALYTRAN-AMT` |

##### Batch Statistics

- WS-TRANSACTION-COUNT: total transactions read
- WS-REJECT-COUNT: total rejections
- Return code = 4 if any rejections occurred; 0 otherwise

#### 3.2.3 Authorization Decision (optional -- `COPAUA0C`)

The optional authorization module processes real-time authorization requests via MQ.

##### Authorization Decision Flow

```
1. Receive MQ request (MQGET with 5000ms timeout)
2. Read CCXREF by card number
   └── Not found -> DECLINE 3100 "INVALID CARD"
3. Read Account Master by XREF-ACCT-ID
   └── Not found -> DECLINE 3100 "INVALID CARD"
4. Read Customer Master by XREF-CUST-ID
   └── Not found -> DECLINE 3100 "INVALID CARD"
5. Read Pending Auth Summary from IMS (or initialize new)
6. Check card active status
   └── Not active -> DECLINE 4200 "CARD NOT ACTIVE"
7. Check account status
   └── Closed -> DECLINE 4300 "ACCOUNT CLOSED"
8. Check fraud flags
   └── Card fraud -> DECLINE 5100 "CARD FRAUD"
   └── Merchant fraud -> DECLINE 5200 "MERCHANT FRAUD"
9. Calculate available credit:
   Available = CREDIT-LIMIT - CREDIT-BALANCE
   └── Transaction amount > Available -> DECLINE 4100 "INSUFFICIENT FUND"
10. APPROVE (Response Code '00')
11. Store auth detail in IMS, update summary counters
12. Send MQ response (MQPUT)
```

##### Authorization Response Codes

| Code | Meaning | Condition |
|:-----|:--------|:----------|
| `'00'` | Approved | All checks pass, within credit limit |
| `'05'` | Declined | Any check fails (see reason codes below) |

##### Decline Reason Codes

| Reason Code | Meaning |
|:-----------:|:--------|
| 3100 | Invalid card (not in XREF, account/customer not found) |
| 4100 | Insufficient funds (exceeds available credit) |
| 4200 | Card not active |
| 4300 | Account closed |
| 5100 | Card flagged for fraud |
| 5200 | Merchant flagged for fraud |
| 9000 | Unknown/other error |

#### 3.2.4 Transaction Browse and View

| Rule ID | Rule | Program |
|:--------|:-----|:--------|
| TRN-B01 | Transaction list displays 10 records per page, sorted by TRAN-ID ascending. | `COTRN00C` |
| TRN-B02 | Forward pagination: STARTBR + READNEXT x 11 (10 display + 1 next-page probe). | `COTRN00C` |
| TRN-B03 | Backward pagination: STARTBR + READPREV x 11. | `COTRN00C` |
| TRN-B04 | User selects a transaction with `'S'` or `'s'` to view details. | `COTRN00C` |
| TRN-B05 | Transaction detail view displays all 14 fields of TRAN-RECORD. | `COTRN01C` |

### 3.3 Billing and Statement Generation Logic

#### 3.3.1 Bill Payment (`COBIL00C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| BIL-01 | Account ID is required. Error: "Acct ID can NOT be empty". | `COBIL00C` |
| BIL-02 | Payment is only allowed if `ACCT-CURR-BAL > 0`. Error: "You have nothing to pay". | `COBIL00C` |
| BIL-03 | **Payment amount is always the full current balance.** No partial payment supported. `TRAN-AMT = ACCT-CURR-BAL`. | `COBIL00C` |
| BIL-04 | After payment: `ACCT-CURR-BAL = ACCT-CURR-BAL - TRAN-AMT`, which results in zero balance. | `COBIL00C` |
| BIL-05 | Payment creates a transaction record with hard-coded values: Type `'02'`, Category `2`, Source `'POS TERM'`, Description `'BILL PAYMENT - ONLINE'`. | `COBIL00C` |
| BIL-06 | Merchant fields: ID = `999999999`, Name = `'BILL PAYMENT'`, City/ZIP = `'N/A'`. | `COBIL00C` |
| BIL-07 | Transaction ID generated same way as TRN-01 (READPREV at HIGH-VALUES + 1). | `COBIL00C` |
| BIL-08 | User must confirm with `'Y'`/`'y'`. | `COBIL00C` |
| BIL-09 | Success message: "Payment successful. Your Transaction ID is {TRAN-ID}." | `COBIL00C` |
| BIL-10 | **Category balance (TCATBALF) is NOT updated** for bill payments (unlike batch posting). | `COBIL00C` |

**Modernization gap:** BIL-03 and BIL-10 represent significant functional limitations. A modern system should support partial payments and consistently maintain category balances.

#### 3.3.2 Statement Generation (`CBSTM03A`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| STM-01 | Statements are assembled per-customer by traversing XREF-FILE sequentially. | `CBSTM03A` |
| STM-02 | For each cross-reference record: fetch customer (CUSTDAT), fetch account (ACCTDAT), collect up to 10 transactions per card. | `CBSTM03A` |
| STM-03 | In-memory table: up to 51 cards x 10 transactions per card. | `CBSTM03A` |
| STM-04 | Statement header includes: customer name, address, account ID, current balance (formatted as `9(9).99-`), FICO score. | `CBSTM03A` |
| STM-05 | Statement footer: `Total EXP = SUM(all transaction amounts)`. | `CBSTM03A` |
| STM-06 | Dual output: plain text (80-char lines) and HTML table format with inline CSS styling. | `CBSTM03A` |
| STM-07 | HTML branding: "Bank of XYZ, 410 Terry Ave N, Seattle WA 99999". | `CBSTM03A` |

#### 3.3.3 Report Submission (`CORPT00C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| RPT-01 | Three report types: Monthly (auto 1st-to-last of current month), Yearly (Jan 1 to Dec 31), Custom (user-specified date range). | `CORPT00C` |
| RPT-02 | Custom date ranges validated per-component: month (01-12), day (01-31), year (4-digit), then full-date via `CSUTLDTC`. | `CORPT00C` |
| RPT-03 | Report JCL submitted to TDQ `'JOBS'` queue, which routes to JES INREADER. | `CORPT00C` |
| RPT-04 | JCL template invokes PROC=TRANREPT with symbolic date parameters. | `CORPT00C` |
| RPT-05 | User must confirm with `'Y'`/`'y'` before submission. | `CORPT00C` |

#### 3.3.4 Transaction Detail Report (`CBTRN03C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| RPT-D01 | Report organized by account, with page-level and grand totals. | `CBTRN03C` |
| RPT-D02 | Detail line includes: TRAN-ID, Account ID, Type+Description, Category+Description, Source, Amount. | `CBTRN03C` |
| RPT-D03 | Type/category descriptions resolved by lookup in TRANTYPE-FILE and TRANCATG-FILE. | `CBTRN03C` |
| RPT-D04 | Three-level total hierarchy: page total -> account total -> grand total. | `CBTRN03C` |
| RPT-D05 | Date range filtering via external parameter file (DATEPARM). | `CBTRN03C` |

### 3.4 Interest, Fees, and Penalties Computation

#### 3.4.1 Interest Calculation Algorithm (`CBACT04C`)

This is the core financial computation in the system.

##### Interest Rate Determination

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| INT-01 | Interest rates are stored in DISCGRP-FILE (disclosure group), keyed by `ACCT-GROUP-ID + TRAN-TYPE-CD + TRAN-CAT-CD`. | `CBACT04C` |
| INT-02 | If no rate found for the account's group: fall back to group `'DEFAULT'` with the same type+category key. | `CBACT04C` |
| INT-03 | If DIS-INT-RATE = 0, no interest is charged for that category. Skip. | `CBACT04C` |
| INT-04 | Rate field (DIS-INT-RATE) is PIC S9(04)V99, representing an **annual percentage rate** (e.g., 1899 = 18.99%). | `CVTRA02Y` |

##### Interest Formula

```
MONTHLY-INTEREST = (TRAN-CAT-BAL * DIS-INT-RATE) / 1200
```

Where:
- `TRAN-CAT-BAL` = outstanding balance for a specific transaction category (from TCATBALF)
- `DIS-INT-RATE` = annual interest rate from disclosure group
- Division by 1200 = annual-to-monthly conversion (/ 12) combined with percentage-to-decimal (/ 100)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| INT-05 | Interest is calculated **per transaction category** (type+category combination), not as a single flat rate per account. | `CBACT04C` |
| INT-06 | All category-level interest charges for one account are summed into WS-TOTAL-INT before applying. | `CBACT04C` |
| INT-07 | Account balance update: `ACCT-CURR-BAL = ACCT-CURR-BAL + WS-TOTAL-INT`. | `CBACT04C` |
| INT-08 | Cycle counters (ACCT-CURR-CYC-CREDIT, ACCT-CURR-CYC-DEBIT) are reset to 0 after interest posting. | `CBACT04C` |

##### System Transaction Generation

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| INT-09 | For each interest charge, a system transaction is created in TRANSACT-FILE. | `CBACT04C` |
| INT-10 | System transaction fields: Type = `'01'`, Category = `'05'`, Source = `'System'`, Description = `'Int. for a/c ' + ACCT-ID`. | `CBACT04C` |
| INT-11 | Transaction ID = processing date (PARM-DATE) + auto-incrementing suffix. | `CBACT04C` |
| INT-12 | Merchant fields: ID = 0, Name/City/ZIP = spaces (system-generated). | `CBACT04C` |
| INT-13 | Card number for the interest transaction sourced from XREF cross-reference. | `CBACT04C` |

#### 3.4.2 Fee Calculation

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| FEE-01 | **Fee calculation is not implemented.** The paragraph `1400-COMPUTE-FEES` exists as a stub (contains only EXIT). | `CBACT04C` |

**Modernization note:** This is an intentional placeholder. The target system should implement late-payment fees, over-limit fees, annual fees, cash-advance fees, etc.

### 3.5 Credit Limit Management and Risk Controls

#### 3.5.1 Credit Limit Fields

| Field | PIC | Record | Source |
|:------|:----|:-------|:-------|
| ACCT-CREDIT-LIMIT | S9(10)V99 | ACCOUNT-RECORD | `CVACT01Y` |
| ACCT-CASH-CREDIT-LIMIT | S9(10)V99 | ACCOUNT-RECORD | `CVACT01Y` |

#### 3.5.2 Credit Limit Rules

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| CLM-01 | Credit limit enforced during batch posting only: reject if projected balance exceeds limit (see BTR-03). | `CBTRN02C` |
| CLM-02 | Credit limit enforced during authorization: available = limit - balance (see Section 3.2.3). | `COPAUA0C` |
| CLM-03 | Credit limit **not enforced** during online transaction add (`COTRN02C`). | `COTRN02C` |
| CLM-04 | Credit limit **not enforced** during bill payment (`COBIL00C`). | `COBIL00C` |
| CLM-05 | Credit and cash limits are updated via account update screen. Validation: must be supplied, valid signed numeric format. | `COACTUPC` |
| CLM-06 | **No automated credit limit adjustment logic** exists. All changes are manual via admin/operator. | -- |

#### 3.5.3 Risk Scoring

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| RSK-01 | FICO credit score stored on customer record: `CUST-FICO-CREDIT-SCORE PIC 9(03)`. Valid range: **300-850**. | `COACTUPC` |
| RSK-02 | FICO score displayed on statements (`CBSTM03A`). | `CBSTM03A` |
| RSK-03 | **FICO score is not used in any decision logic** (no automated credit-limit adjustment, no risk-based pricing). | -- |

### 3.6 Fraud Detection and AML Rules

#### 3.6.1 Authorization-Time Fraud Checks (optional -- `COPAUA0C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| FRD-01 | Card fraud flag checked during authorization. If PA-AUTH-FRAUD = `'F'`: DECLINE 5100 "CARD FRAUD". | `COPAUA0C` |
| FRD-02 | Merchant fraud flag checked during authorization. If flagged: DECLINE 5200 "MERCHANT FRAUD". | `COPAUA0C` |
| FRD-03 | Fraud detection is **rule-based** (flag lookup), not model-based (no scoring, no ML). | `COPAUA0C` |

#### 3.6.2 Fraud Flagging and Management (optional -- `COPAUS1C`, `COPAUS2C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| FRD-04 | Fraud flag is toggled via PF5 key in authorization detail view. | `COPAUS1C` |
| FRD-05 | Flag values: `'F'` = Fraud Confirmed, `'R'` = Fraud Removed, `SPACE` = No flag. | `CIPAUDTY` |
| FRD-06 | When fraud is reported, PA-FRAUD-RPT-DATE is set to current date. | `COPAUS1C` |
| FRD-07 | Fraud toggle updates IMS segment via REPL (replace) with SYNCPOINT. ROLLBACK on failure. | `COPAUS1C` |

#### 3.6.3 Pending Authorization Match Status

| Status | Value | Meaning |
|:-------|:------|:--------|
| PENDING | `'P'` | Approved auth awaiting settlement match |
| DECLINED | `'D'` | Authorization was declined |
| EXPIRED | `'E'` | Auth not matched within retention period |
| MATCHED | `'M'` | Auth matched with actual posted transaction |

#### 3.6.4 Authorization Expiration and Purge (`CBPAUP0C`)

| Rule ID | Rule | Source |
|:--------|:-----|:-------|
| FRD-08 | Default expiry period: **5 days** (configurable via SYSIN parameter P-EXPIRY-DAYS). | `CBPAUP0C` |
| FRD-09 | Expiration calculated using Julian day arithmetic: `CURRENT-YYDDD - AUTH-DATE >= EXPIRY-DAYS`. | `CBPAUP0C` |
| FRD-10 | Expired auth details are deleted from IMS (DLET). Summary counters decremented accordingly. | `CBPAUP0C` |
| FRD-11 | If an account's summary has zero approved AND zero declined auths, the summary segment itself is deleted. | `CBPAUP0C` |
| FRD-12 | Batch checkpoint frequency configurable (default: every 5 deletes) for IMS recovery. | `CBPAUP0C` |

#### 3.6.5 AML (Anti-Money Laundering)

| Rule ID | Rule |
|:--------|:-----|
| AML-01 | **No AML rules are implemented.** No transaction velocity checks, no large-transaction reporting (CTR), no suspicious activity detection (SAR), no sanctions screening. |

**Modernization note:** A production system requires real-time AML monitoring, velocity checks, sanctions screening (OFAC/EU), and automated SAR filing.

### 3.7 Dispute and Chargeback Processing

| Rule ID | Rule |
|:--------|:-----|
| DSP-01 | **No dispute or chargeback processing is implemented.** There are no programs, screens, or data structures for dispute initiation, investigation, provisional credit, representment, or arbitration. |

**Modernization note:** This is a critical functional gap. A production card system requires full dispute lifecycle management per Visa/Mastercard network rules (e.g., Visa Claims Resolution, Mastercard Chargeback Guide).

### 3.8 Regulatory Compliance Logic (PCI-DSS, Local Regulations)

#### 3.8.1 Current Security Posture

| Rule ID | Finding | Severity | Source |
|:--------|:--------|:---------|:-------|
| SEC-01 | **Passwords stored in plaintext** in USRSEC VSAM file (SEC-USR-PWD, PIC X(08)). No hashing, salting, or encryption. | **Critical** | `COSGN00C`, `CSUSR01Y` |
| SEC-02 | Password comparison is case-insensitive (both input and stored value converted to UPPER-CASE via `FUNCTION UPPER-CASE`). | High | `COSGN00C` |
| SEC-03 | **No password complexity rules.** Any 1-8 character string is accepted. | High | `COUSR01C` |
| SEC-04 | **No password expiry or rotation.** Passwords persist indefinitely. | High | -- |
| SEC-05 | **No account lockout** after failed login attempts. Users can retry indefinitely. | High | `COSGN00C` |
| SEC-06 | **No session timeout.** CICS pseudo-conversational model persists as long as the user has a terminal session. | Medium | -- |
| SEC-07 | **No audit trail** for authentication events (successful/failed logins). | Medium | `COSGN00C` |
| SEC-08 | **User deletion is hard-delete** (physical removal from VSAM). No soft-delete, no audit log of deletion. | Medium | `COUSR03C` |
| SEC-09 | **No orphan check** on user deletion (user may still be referenced in transaction history). | Low | `COUSR03C` |

#### 3.8.2 PCI-DSS Gap Analysis

| PCI-DSS Requirement | Current State | Gap |
|:--------------------|:-------------|:----|
| **Req 3.4**: Render PAN unreadable | Card numbers stored in plaintext (PIC X(16)) in VSAM. | **Non-compliant.** Must encrypt or tokenize at rest. |
| **Req 3.2**: Do not store CVV after authorization | CVV stored in CARD-RECORD (CARD-CVV-CD PIC 9(03)). | **Non-compliant.** CVV must not be persisted post-authorization. |
| **Req 8.2.3**: Passwords must meet complexity | No complexity rules enforced. | **Non-compliant.** Must enforce minimum length, mixed characters. |
| **Req 8.1.6**: Lock out after 6 failed attempts | No lockout mechanism. | **Non-compliant.** |
| **Req 8.1.4**: Password change every 90 days | No password expiry. | **Non-compliant.** |
| **Req 8.2.1**: Strong cryptography for password storage | Plaintext storage. | **Non-compliant.** Must hash with bcrypt/scrypt/Argon2. |
| **Req 10**: Track all access to network resources | No audit logging. | **Non-compliant.** Must log all auth events, data access, admin actions. |
| **Req 6.5**: Address common coding vulnerabilities | No input sanitization beyond type/range checks. | **Partial.** COBOL/CICS inherently avoids injection, but missing modern controls. |

#### 3.8.3 Data Privacy Considerations

| Data Element | Field | Storage | Sensitivity |
|:-------------|:------|:--------|:------------|
| Social Security Number | CUST-SSN, PIC 9(09) | Plaintext in VSAM | **PII -- requires encryption at rest** |
| Date of Birth | CUST-DOB-YYYY-MM-DD | Plaintext in VSAM | PII |
| Card Number (PAN) | CARD-NUM, PIC X(16) | Plaintext in VSAM | **PCI-DSS scope -- must tokenize or encrypt** |
| CVV | CARD-CVV-CD, PIC 9(03) | Plaintext in VSAM | **PCI-DSS prohibits post-auth storage** |
| Password | SEC-USR-PWD, PIC X(08) | Plaintext in VSAM | **Must be hashed** |
| Customer Name | CUST-FIRST/LAST-NAME | Plaintext in VSAM | PII |
| Customer Address | CUST-ADDR-* | Plaintext in VSAM | PII |
| Phone Numbers | CUST-PHONE-NUM-1/2 | Plaintext in VSAM | PII |

**Modernization imperative:** The target system **must** address all PCI-DSS gaps before handling production cardholder data. This includes at-rest encryption, tokenization, proper authentication, comprehensive audit logging, and data retention policies.

---

## 4. Dependency and Impact Analysis

### 4.1 Program-to-Program Call Graph

#### 4.1.1 Online Program Navigation (XCTL -- Transfer Control)

All online navigation uses `EXEC CICS XCTL` with the shared `CARDDEMO-COMMAREA`. The COMMAREA fields `CDEMO-FROM-PROGRAM` and `CDEMO-TO-PROGRAM` carry the routing context.

```
                                COSGN00C (CC00)
                               /  Signon  \
                              /             \
                    COADM01C (CA00)      COMEN01C (CM00)
                     Admin Menu           User Menu
                    /    |    \          /  |  |  |  \   \   \
              COUSR00C  ...  COTRTLIC  COACTVWC  |  COBIL00C  CORPT00C
               (CU00)        (CTLI)    (CAVW)    |   (CB00)    (CR00)
              /  |  \                             |              |
        COUSR01C |  COUSR03C               COTRN00C         [TDQ->JES]
         (CU01)  |   (CU03)                (CT00)           TRANREPT
              COUSR02C                    /        \
               (CU02)              COTRN01C    COTRN02C
                                    (CT01)      (CT02)

                    COCRDLIC (CCLI) --> COCRDSLC (CCDL) --> COCRDUPC (CCUP)
                     Card List           Card Detail          Card Update

                    COACTUPC (CAUP) -- Account Update (standalone)
```

##### Navigation Rules

| From Program | To Program(s) | Mechanism | Condition |
|:-------------|:-------------|:----------|:----------|
| `COSGN00C` | `COADM01C` | XCTL | USER-TYPE = 'A' (admin) |
| `COSGN00C` | `COMEN01C` | XCTL | USER-TYPE = 'U' (regular) |
| `COMEN01C` | *dynamic* | XCTL PROGRAM(CDEMO-MENU-OPT-PGMNAME) | Menu option selection (INQUIRE PROGRAM first) |
| `COADM01C` | *dynamic* | XCTL PROGRAM(CDEMO-ADMIN-OPT-PGMNAME) | Admin option selection |
| `COCRDLIC` | `COCRDSLC` | XCTL | Card selected from list |
| `COCRDLIC` | `COMEN01C` | XCTL | PF3 (return to menu) |
| `COCRDSLC` | `COCRDUPC` | XCTL | PF key to edit card |
| All functional programs | `CDEMO-TO-PROGRAM` | XCTL | PF3 exit: returns to caller or falls back to `COMEN01C`/`COADM01C`/`COSGN00C` |

##### Pseudo-Conversational Self-Loop

Every online program loops back to itself via `EXEC CICS RETURN TRANSID(WS-TRANID) COMMAREA(CARDDEMO-COMMAREA)`. This is the CICS pseudo-conversational pattern -- the program terminates after each screen interaction and is re-invoked when the user presses a key.

| Program | Self-Loop TRANSID |
|:--------|:------------------|
| `COSGN00C` | CC00 |
| `COMEN01C` | CM00 |
| `COADM01C` | CA00 |
| `COACTVWC` | CAVW |
| `COACTUPC` | CAUP |
| `COCRDLIC` | CCLI |
| `COCRDSLC` | CCDL |
| `COCRDUPC` | CCUP |
| `COTRN00C` | CT00 |
| `COTRN01C` | CT01 |
| `COTRN02C` | CT02 |
| `CORPT00C` | CR00 |
| `COBIL00C` | CB00 |
| `COUSR00C` | CU00 |
| `COUSR01C` | CU01 |
| `COUSR02C` | CU02 |
| `COUSR03C` | CU03 |

#### 4.1.2 Subroutine Calls (CALL -- with return)

| Caller | Callee | Interface | Purpose |
|:-------|:-------|:----------|:--------|
| `COTRN02C` | `CSUTLDTC` | CSUTLDTC-DATE, CSUTLDTC-DATE-FORMAT, CSUTLDTC-RESULT | Date validation (2 calls: orig + proc date) |
| `CORPT00C` | `CSUTLDTC` | Same as above | Date validation (2 calls: start + end date) |
| `CSUTLDTC` | `CEEDAYS` (LE runtime) | LE callable service | Julian day conversion |
| `CBSTM03A` | `CBSTM03B` | WS-M03B-AREA | Statement output writer (13 calls) |
| `CBACT01C` | `COBDATFT` (ASM) | CODATECN-REC | Date format conversion |
| `COBSWAIT` | `MVSWAIT` (ASM) | MVSWAIT-TIME | Timer delay |
| `COPAUS1C` | `COPAUS2C` | EXEC CICS LINK | Fraud flag handler (IMS update) |
| Multiple batch | `CEE3ABD` (LE runtime) | ABCODE, TIMING | Abnormal termination handler |

#### 4.1.3 Batch Program Dependencies (JCL-driven)

Batch programs do not call each other directly. Dependencies are enforced through JCL job sequencing and scheduler chains.

```
POSTTRAN (CBTRN02C)  ──depends on──>  INTCALC (CBACT04C)
    │                                      │
    ├── reads: DALYTRAN, CARDXREF,         ├── reads: TCATBALF (from POSTTRAN),
    │          ACCTDATA                    │          CARDXREF, ACCTDATA, DISCGRP
    ├── writes: TRANSACT, ACCTDATA,        ├── writes: SYSTRAN, ACCTDATA
    │           DALYREJS, TCATBALF         │
    │                                      ▼
    │                               COMBTRAN (SORT)
    │                                      │
    │                                      ▼
    │                               CREASTMT (CBSTM03A -> CBSTM03B)
    │                                      │
    │                                      ├── reads: XREF, CUSTDATA, ACCTDATA,
    │                                      │          TRANSACT (combined)
    │                                      └── writes: Statement output
    ▼
TRANREPT (CBTRN03C via TRANREPT.prc)
    ├── reads: TRANSACT, CARDXREF, TRANTYPE, TRANCATG
    └── writes: Report output
```

#### 4.1.4 Optional Module Calls

| Caller | Callee | Mechanism | Module |
|:-------|:-------|:----------|:-------|
| `COPAUS1C` | `COPAUS2C` | EXEC CICS LINK | IMS-DB2-MQ Auth |
| `COPAUA0C` | IMS DL/I (PSBPAUTB) | CALL (DL/I) | IMS-DB2-MQ Auth |
| `COPAUA0C` | MQ API | CALL 'MQOPEN/GET/PUT/CLOSE' | IMS-DB2-MQ Auth |
| `COACCT01` | MQ API | CALL 'MQOPEN/GET/PUT/CLOSE' | VSAM-MQ |
| `CODATE01` | MQ API | CALL 'MQOPEN/GET/PUT/CLOSE' | VSAM-MQ |
| `COTRTLIC` | DB2 (embedded SQL) | EXEC SQL | DB2 Tran Types |
| `COTRTUPC` | DB2 (embedded SQL) | EXEC SQL | DB2 Tran Types |
| `COBTUPDT` | DB2 (embedded SQL) | EXEC SQL | DB2 Tran Types |
| `COBTUPDT` | `DSNTIAC` (DB2 utility) | CALL | DB2 error formatting |

### 4.2 Data Dependency Map

#### 4.2.1 Entity Dependency Chain

The following diagram shows which VSAM files must be consistent for each operation to succeed:

```
USRSEC ─────────────────────────────────────────────── Authentication
                                                         │
CUSTDAT ──┐                                              │
          │                                              ▼
CCXREF ───┼── ACCTDAT ──┬── TRANSACT                   All Online
          │             │                              Programs
CARDDAT ──┘             ├── TCATBALF ── DISCGRP ────── Interest Calc
                        │
                        └── DALYTRAN ──────────────── Batch Posting
```

**Critical dependency:** CCXREF (cross-reference) is the **linchpin** of the data model. If XREF data is inconsistent with CARDDAT, ACCTDAT, or CUSTDAT, multiple programs will fail:

| If XREF is inconsistent with... | Affected Programs | Failure Mode |
|:---------------------------------|:-----------------|:-------------|
| CARDDAT (card not in xref) | COTRN02C, COBIL00C, CBTRN02C, CBACT04C | "Card Number NOT found" |
| ACCTDAT (account not in xref) | COACTVWC, COCRDSLC, CBTRN02C | "Account ID NOT found" |
| CUSTDAT (customer not in xref) | COACTVWC, COCRDSLC, COPAUA0C | "Customer not found" |

#### 4.2.2 Write Conflict Matrix

Programs that write to the same file create potential conflict zones during modernization (must maintain atomicity guarantees):

| File | Writers (Online) | Writers (Batch) | Conflict Risk |
|:-----|:----------------|:----------------|:-------------|
| ACCTDAT | COACTUPC, COBIL00C | CBTRN02C, CBACT04C | **High** -- batch and online both update balances |
| CARDDAT | COCRDUPC | (none) | Low |
| TRANSACT | COTRN02C, COBIL00C | CBTRN02C, CBACT04C | **High** -- concurrent transaction writes |
| USRSEC | COUSR01C, COUSR02C, COUSR03C | DUSRSECJ (JCL) | Medium -- batch reload clobbers online changes |
| TCATBALF | (none) | CBTRN02C | Low -- batch only |

**Key insight:** The current system avoids write conflicts by **closing all CICS files** before batch runs (CLOSEFIL/OPENFIL gate). A modernized system must implement proper concurrent access control (row-level locking, optimistic concurrency, or event sourcing).

### 4.3 Upstream / Downstream System Dependencies

#### 4.3.1 Upstream Dependencies (systems that feed CardDemo)

| Source | Interface | Data | Current State |
|:-------|:----------|:-----|:-------------|
| Flat file loads (.PS files) | FTP + IDCAMS REPRO | Account, card, customer, transaction seed data | Manual upload; no automated feed |
| SYSIN parameters | JCL inline data | Processing date (CBACT04C), expiry days (CBPAUP0C) | Operator-supplied per run |
| MQ request queues (opt) | MQGET | Authorization requests, account/date inquiries | External system must exist to send requests |
| User security data | DUSRSECJ inline JCL | User credentials | Hard-coded in JCL; no external identity provider |

#### 4.3.2 Downstream Dependencies (systems that consume CardDemo output)

| Target | Interface | Data | Current State |
|:-------|:----------|:-----|:-------------|
| Statement output | CBSTM03A sequential file | Customer statements (text + HTML) | File output; no delivery mechanism (email, portal) |
| Transaction reports | CBTRN03C sequential file | Detail reports with totals | File output; TXT2PDF conversion available |
| Rejected transactions | DALYREJS sequential file | Failed transactions with reason codes | File output; no alerting or retry |
| MQ reply queues (opt) | MQPUT | Authorization responses, inquiry results | External system must consume replies |
| JES (batch submission) | TDQ JOBS -> INREADER | Report JCL | Internal mainframe only |

#### 4.3.3 Dependency Summary

CardDemo is **largely self-contained** with minimal external dependencies. This is favorable for modernization -- external integration points can be designed cleanly rather than reverse-engineered from existing connections. The main risk is that the batch file-exchange patterns (flat files in, flat files out) must be replaced with API-based or event-driven interfaces.

### 4.4 Technical Debt Quantification (Developer-Days)

The following estimates assume a **senior developer** familiar with both COBOL source and the target platform. Estimates include analysis, coding, unit testing, and integration testing. They do **not** include project management, infrastructure provisioning, or UAT.

#### 4.4.1 Code Complexity Debt

| Debt Item | Affected Artifact | Effort (dev-days) | Rationale |
|:----------|:-----------------|-------------------:|:----------|
| `COACTUPC` monolith | 4,236 LOC, 164 IFs, 39x COPY REPLACING | **12-15** | Largest program; must be decomposed into account-update, customer-update, and validation services |
| COMMAREA coupling | `COCOM01Y` shared by all 17 online programs | **8-10** | Replacing single 192-byte shared state with proper API contracts between services |
| Duplicated date validation | `CSUTLDTC-PARM` defined inline in 2 programs | **1** | Extract to shared module/library |
| `CUSTREC` / `CVCUS01Y` duplication | 2 identical 500-byte copybooks | **0.5** | Consolidate to single definition |
| `UNUSED1Y.cpy` dead code | Orphaned copybook | **0.25** | Remove and verify no hidden references |
| Commented-out COPY statements | 8 occurrences across 5 programs | **0.5** | Clean up, verify no regression |
| Triplicated batch readers | `CBACT02C`, `CBACT03C`, `CBCUS01C` (178 LOC x 3) | **2** | Parameterize into single generic reader |
| `CSSETATY` x 39 REPLACING pattern | ~120 lines of repetitive COPY REPLACING in `COACTUPC` | **2** | Replace with table-driven attribute logic |
| `CBSTM03B` hidden dependency | Called 13 times from `CBSTM03A` but not in main `app/cbl/*.cbl` glob | **1** | Document and consolidate into statement module |
| Mixed coding styles | Intentionally varied across codebase | **5-8** | Normalize to consistent patterns during migration |
| **Subtotal: Code Complexity** | | **32-40** | |

#### 4.4.2 Functional Gap Debt

| Gap | Section Ref | Effort (dev-days) | Rationale |
|:----|:------------|-------------------:|:----------|
| Card issuance workflow | 3.1 (CRD-04) | **8-10** | Design and build issuance, activation, and replacement flows |
| Partial bill payment | 3.3 (BIL-03) | **3-5** | Extend payment to support partial amounts and minimum payments |
| Fee calculation | 3.4 (FEE-01) | **10-15** | Implement late fees, over-limit fees, annual fees, cash advance fees |
| Credit limit enforcement (online) | 3.5 (CLM-03, CLM-04) | **3-5** | Add real-time limit checks to online transaction add and bill payment |
| Dispute/chargeback processing | 3.7 (DSP-01) | **30-40** | Full dispute lifecycle per network rules (design, build, integrate) |
| AML monitoring | 3.6 (AML-01) | **20-30** | Velocity checks, CTR, SAR, sanctions screening |
| Category balance consistency | 3.3 (BIL-10) | **2-3** | Update TCATBALF during online bill payment |
| **Subtotal: Functional Gaps** | | **76-108** | |

#### 4.4.3 Security and Compliance Debt

| Item | Section Ref | Effort (dev-days) | Rationale |
|:-----|:------------|-------------------:|:----------|
| Password hashing | 3.8 (SEC-01) | **3-5** | Implement bcrypt/Argon2, migrate existing plaintext passwords |
| Password complexity & expiry | 3.8 (SEC-03, SEC-04) | **2-3** | Policy engine for length, character requirements, 90-day rotation |
| Account lockout | 3.8 (SEC-05) | **2-3** | Failed-attempt counter, lockout duration, unlock workflow |
| Session management | 3.8 (SEC-06) | **3-5** | Idle timeout, concurrent session control, forced logout |
| Audit logging | 3.8 (SEC-07) | **8-12** | Comprehensive event logging: auth, data access, admin actions, changes |
| PAN tokenization/encryption | 3.8 (PCI Req 3.4) | **10-15** | Tokenization service, key management, data migration |
| CVV removal from storage | 3.8 (PCI Req 3.2) | **2-3** | Remove CVV field from card record, adjust all referencing programs |
| PII encryption at rest | 3.8 (SSN, DoB) | **5-8** | Encrypt sensitive fields, implement access controls |
| **Subtotal: Security/Compliance** | | **35-54** | |

#### 4.4.4 Infrastructure and Migration Debt

| Item | Effort (dev-days) | Rationale |
|:-----|-------------------:|:----------|
| VSAM-to-RDBMS data migration | **15-20** | Schema design, ETL, data validation for 9 VSAM files + 3 AIX |
| BMS-to-modern-UI conversion | **20-30** | 17 screens to web UI (forms, lists, navigation) |
| JCL/batch-to-modern-scheduler | **8-12** | Convert 46 JCL jobs to cloud-native batch (Step Functions, Airflow, etc.) |
| CICS transaction removal | **10-15** | Replace pseudo-conversational model with stateless API layer |
| IMS DB migration (opt) | **8-10** | Migrate hierarchical data to relational or document store |
| DB2 migration (opt) | **3-5** | Straightforward; embedded SQL maps to modern SQL |
| MQ replacement (opt) | **5-8** | Replace MQ with modern messaging (SQS, EventBridge, Kafka) |
| Assembler utility replacement | **2-3** | Replace MVSWAIT (timer) and COBDATFT (date conversion) with platform equivalents |
| **Subtotal: Infrastructure** | | **71-103** | |

#### 4.4.5 Total Effort Summary

| Category | Low Estimate | High Estimate |
|:---------|------------:|--------------:|
| Code Complexity Debt | 32 | 40 |
| Functional Gap Debt | 76 | 108 |
| Security/Compliance Debt | 35 | 54 |
| Infrastructure/Migration Debt | 71 | 103 |
| **Total** | **214** | **305** |

**Range: 214-305 developer-days** (approximately 10-15 developer-months for a single developer, or 3-5 calendar months for a team of 3-4).

*Note: These estimates cover the full modernization scope. A phased approach (lift-and-shift first, then refactor) would front-load ~100 dev-days for the initial migration and spread the remainder across subsequent sprints.*

### 4.5 Risk and "Blast Radius" Assessment per Module

#### 4.5.1 Risk Scoring Methodology

Each module is scored across four dimensions:

| Dimension | Weight | Scale |
|:----------|-------:|:------|
| **Complexity** (LOC, IFs, file access) | 30% | 1-5 |
| **Coupling** (programs that depend on it, shared data) | 30% | 1-5 |
| **Business Criticality** (revenue impact if broken) | 25% | 1-5 |
| **Data Sensitivity** (PII, PCI scope) | 15% | 1-5 |

Composite risk = weighted sum. Blast radius = number of programs and files directly affected if the module is modified incorrectly.

#### 4.5.2 Module Risk Matrix

| Module | LOC | Complexity | Coupling | Business Crit. | Data Sens. | **Composite Risk** | Blast Radius |
|:-------|----:|:----------:|:--------:|:--------------:|:----------:|:------------------:|:-------------|
| **Account Update** (`COACTUPC`) | 4,236 | 5 | 5 | 5 | 4 | **4.85** | 17 programs (all online via COMMAREA), ACCTDAT, CUSTDAT, CCXREF |
| **Batch Transaction Posting** (`CBTRN02C`) | 731 | 4 | 4 | 5 | 3 | **4.15** | ACCTDAT, TRANSACT, TCATBALF, DALYREJS, downstream INTCALC + COMBTRAN |
| **Interest Calculation** (`CBACT04C`) | 652 | 4 | 3 | 5 | 3 | **3.90** | ACCTDAT balances, SYSTRAN, downstream COMBTRAN + statements |
| **Signon** (`COSGN00C`) | 260 | 2 | 5 | 4 | 5 | **3.85** | All programs (authentication gate), USRSEC, COMMAREA |
| **COMMAREA** (`COCOM01Y`) | 47 | 1 | 5 | 5 | 3 | **3.80** | All 17 online programs -- any field change ripples to every program |
| **Authorization** (`COPAUA0C`) (opt) | 1,026 | 5 | 3 | 5 | 4 | **4.20** | IMS (PADFL, PAUT), DB2, MQ, CCXREF, ACCTDAT, CUSTDAT |
| **Cross-Reference** (`CCXREF` / `CVACT03Y`) | 11 | 1 | 5 | 4 | 3 | **3.50** | 13 programs read CCXREF; data integrity failure cascades to all |
| **Card List/Update** (`COCRDLIC` + `COCRDUPC`) | 3,019 | 4 | 3 | 3 | 4 | **3.45** | CARDDAT, CARDAIX, CUSTDAT |
| **Statement Generation** (`CBSTM03A` + `CBSTM03B`) | 1,154 | 3 | 2 | 4 | 3 | **3.05** | XREF, CUSTDAT, ACCTDAT, TRANSACT (read-only, low write risk) |
| **Bill Payment** (`COBIL00C`) | 572 | 3 | 3 | 5 | 3 | **3.60** | ACCTDAT (balance update), TRANSACT (new record), CCXREF |
| **Transaction Add** (`COTRN02C`) | 783 | 3 | 3 | 4 | 3 | **3.30** | TRANSACT, CCXREF, CXACAIX |
| **User Management** (`COUSR00C`-`03C`) | 1,767 | 2 | 2 | 3 | 4 | **2.60** | USRSEC only; isolated from business data |
| **Transaction Report** (`CBTRN03C`) | 649 | 3 | 2 | 2 | 2 | **2.30** | Read-only; no write risk |
| **Menu Routers** (`COMEN01C` + `COADM01C`) | 596 | 2 | 4 | 2 | 1 | **2.55** | Navigation only; no data writes |
| **Batch Readers** (`CBACT01C`-`03C`, `CBCUS01C`) | 964 | 1 | 1 | 1 | 2 | **1.15** | Read-only utilities; minimal risk |

#### 4.5.3 Risk Heat Map Summary

```
                    Low Coupling ◄──────────────────────► High Coupling

 High        ┌─────────────────────────────────────────────────────────┐
 Complexity  │                                    COACTUPC [4.85]     │
             │  COPAUA0C [4.20]                   CBTRN02C [4.15]     │
             │                                                         │
             │  COCRDLIC/UPC [3.45]               CBACT04C [3.90]     │
             │                                    COBIL00C [3.60]     │
             │  CBSTM03A [3.05]   COTRN02C [3.30]                    │
             │                                    COSGN00C [3.85]     │
             │                                    COCOM01Y [3.80]     │
             │  CBTRN03C [2.30]   COUSR00-03 [2.60]                  │
             │                    COMEN/ADM [2.55]                    │
 Low         │  Batch Readers [1.15]               CCXREF [3.50]      │
 Complexity  └─────────────────────────────────────────────────────────┘
```

#### 4.5.4 Recommended Migration Sequence (risk-informed)

Based on the risk analysis, the recommended migration order is:

| Phase | Modules | Rationale |
|:------|:--------|:----------|
| **Phase 0: Foundation** | COMMAREA (`COCOM01Y`), CCXREF data model, USRSEC | Must be migrated first; all other modules depend on these |
| **Phase 1: Low-Risk Leaf Nodes** | Batch readers (`CBACT01C`-`03C`, `CBCUS01C`), Menu routers (`COMEN01C`, `COADM01C`), Transaction report (`CBTRN03C`) | Read-only or navigation-only; lowest blast radius; builds team confidence |
| **Phase 2: Medium-Risk Modules** | User management (`COUSR00C`-`03C`), Transaction browse/view (`COTRN00C`, `COTRN01C`), Transaction add (`COTRN02C`) | Isolated write scope (USRSEC or TRANSACT only); moderate complexity |
| **Phase 3: High-Risk Core** | Bill payment (`COBIL00C`), Card management (`COCRDLIC`, `COCRDSLC`, `COCRDUPC`), Account view (`COACTVWC`) | Moderate blast radius but manageable; validates data migration |
| **Phase 4: Critical Path** | Batch posting (`CBTRN02C`), Interest calculation (`CBACT04C`), Statement generation (`CBSTM03A`/`B`), Account update (`COACTUPC`) | Highest risk and complexity; requires thorough parallel testing with production data |
| **Phase 5: Optional Modules** | Authorization (`COPAUA0C`, `COPAUS*`), DB2 transaction types (`COTRTLIC`, `COTRTUPC`), MQ bridges (`COACCT01`, `CODATE01`) | Can be migrated independently; adds IMS/DB2/MQ decommissioning complexity |

#### 4.5.5 Critical Risk Items Requiring Mitigation

| Risk | Impact | Probability | Mitigation |
|:-----|:-------|:------------|:-----------|
| **COMMAREA field change cascade** | All 17 online programs break | High (any schema change triggers it) | Define versioned API contracts early; migrate to request/response DTOs |
| **Account balance consistency** | Financial data corruption | Medium (concurrent access during cutover) | Implement dual-write with reconciliation during parallel run period |
| **Batch window elimination** | Interest calculation accuracy | Medium (24/7 system has no offline window) | Move to event-driven balance updates; eliminate batch-only interest calc |
| **VSAM-to-RDBMS data fidelity** | Silent data corruption | Medium (EBCDIC encoding, packed decimals, COMP-3) | Automate conversion validation with record-level checksums; 100% regression test |
| **Cross-reference integrity** | Cascading lookup failures | Low (stable data model) | Enforce referential integrity via foreign keys in target RDBMS |
| **PCI-DSS compliance gap** | Regulatory penalty, data breach | High (plaintext PAN and CVV at rest) | Address in Phase 0; tokenize before any production data enters target system |
| **Missing CBSTM03B in inventory** | Statement generation fails silently | Low | Locate or rebuild; add to CI/CD artifact pipeline |

---

*End of Technical Specification*
