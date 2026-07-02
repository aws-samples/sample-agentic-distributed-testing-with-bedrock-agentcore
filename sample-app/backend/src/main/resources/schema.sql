CREATE TABLE IF NOT EXISTS users (
    user_id         TEXT PRIMARY KEY,
    password        TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    user_type       TEXT NOT NULL DEFAULT 'U'
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id     INTEGER PRIMARY KEY,
    first_name      TEXT,
    middle_name     TEXT,
    last_name       TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    address_line3   TEXT,
    city            TEXT,
    state_code      TEXT,
    zip_code        TEXT,
    country_code    TEXT,
    phone1          TEXT,
    phone2          TEXT,
    ssn             TEXT,
    govt_id_type    TEXT,
    govt_id         TEXT,
    dob             TEXT,
    fico_score      INTEGER DEFAULT 0,
    eft_account_id  TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    account_id              TEXT PRIMARY KEY,
    active_status           TEXT DEFAULT 'Y',
    current_balance         REAL DEFAULT 0,
    credit_limit            REAL DEFAULT 0,
    cash_credit_limit       REAL DEFAULT 0,
    open_date               TEXT,
    expiration_date         TEXT,
    reissue_date            TEXT,
    current_cycle_credit    REAL DEFAULT 0,
    current_cycle_debit     REAL DEFAULT 0,
    group_id                TEXT DEFAULT 'DEFAULT'
);

CREATE TABLE IF NOT EXISTS cards (
    card_num            TEXT PRIMARY KEY,
    account_id          TEXT NOT NULL,
    cvv_code            TEXT,
    embossed_name       TEXT,
    expiration_date     TEXT,
    active_status       TEXT DEFAULT 'Y',
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS card_xref (
    card_num        TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    customer_id     INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    tran_id             TEXT PRIMARY KEY,
    card_num            TEXT NOT NULL,
    type_code           TEXT,
    category_code       TEXT,
    source              TEXT,
    description         TEXT,
    amount              REAL DEFAULT 0,
    merchant_id         TEXT,
    merchant_name       TEXT,
    merchant_city       TEXT,
    merchant_zip        TEXT,
    orig_timestamp      TEXT,
    proc_timestamp      TEXT,
    FOREIGN KEY (card_num) REFERENCES cards(card_num)
);

CREATE TABLE IF NOT EXISTS transaction_types (
    type_code           TEXT PRIMARY KEY,
    type_description    TEXT
);

CREATE TABLE IF NOT EXISTS transaction_categories (
    type_code               TEXT NOT NULL,
    category_code           TEXT NOT NULL,
    category_description    TEXT,
    PRIMARY KEY (type_code, category_code)
);

CREATE TABLE IF NOT EXISTS transaction_category_balances (
    account_id      TEXT NOT NULL,
    type_code       TEXT NOT NULL,
    category_code   TEXT NOT NULL,
    balance         REAL DEFAULT 0,
    PRIMARY KEY (account_id, type_code, category_code)
);

CREATE TABLE IF NOT EXISTS disclosure_groups (
    group_id        TEXT NOT NULL,
    type_code       TEXT NOT NULL,
    category_code   TEXT NOT NULL,
    interest_rate   REAL DEFAULT 0,
    PRIMARY KEY (group_id, type_code, category_code)
);

CREATE TABLE IF NOT EXISTS daily_transactions (
    tran_id             TEXT PRIMARY KEY,
    card_num            TEXT NOT NULL,
    type_code           TEXT,
    category_code       TEXT,
    source              TEXT,
    description         TEXT,
    amount              REAL DEFAULT 0,
    merchant_id         TEXT,
    merchant_name       TEXT,
    merchant_city       TEXT,
    merchant_zip        TEXT,
    orig_timestamp      TEXT,
    proc_timestamp      TEXT
);
