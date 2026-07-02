-- Seed data for CardDemo modernized application
-- Mirrors the original COBOL/VSAM data structures

-- Users (from USRSEC VSAM - CSUSR01Y)
INSERT OR IGNORE INTO users (user_id, password, first_name, last_name, user_type) VALUES
('ADMIN001', 'PASSWORD', 'Admin', 'User', 'A'),
('USER0001', 'PASSWORD', 'Regular', 'User', 'U'),
('USER0002', 'PASSWORD', 'Jane', 'Operator', 'U'),
('ADMIN002', 'PASSWORD', 'Super', 'Admin', 'A');

-- Customers (from CUSTDATA VSAM - CVCUS01Y)
INSERT OR IGNORE INTO customers (customer_id, first_name, middle_name, last_name, address_line1, city, state_code, zip_code, country_code, phone1, phone2, ssn, dob, fico_score) VALUES
(1, 'John', 'M', 'Smith', '123 Main Street', 'Seattle', 'WA', '98101', 'US', '2065551234', '2065555678', '123456789', '1985-06-15', 750),
(2, 'Jane', 'A', 'Doe', '456 Oak Avenue', 'Portland', 'OR', '97201', 'US', '5035551234', '', '987654321', '1990-03-22', 680),
(3, 'Bob', 'R', 'Johnson', '789 Pine Road', 'San Francisco', 'CA', '94102', 'US', '4155551234', '4155559876', '456789123', '1978-11-03', 820),
(4, 'Alice', '', 'Williams', '321 Elm Street', 'Denver', 'CO', '80201', 'US', '3035551234', '', '321654987', '1992-08-30', 710),
(5, 'Charlie', 'B', 'Brown', '654 Maple Drive', 'Austin', 'TX', '73301', 'US', '5125551234', '5125554321', '654321789', '1988-01-17', 690);

-- Accounts (from ACCTDATA VSAM - CVACT01Y)
INSERT OR IGNORE INTO accounts (account_id, active_status, current_balance, credit_limit, cash_credit_limit, open_date, expiration_date, reissue_date, current_cycle_credit, current_cycle_debit, group_id) VALUES
('00000000001', 'Y', 1250.50, 5000.00, 1000.00, '2020-01-15', '2027-01-15', '2025-01-15', 500.00, -1750.50, 'DEFAULT'),
('00000000002', 'Y', 3750.75, 10000.00, 2500.00, '2019-06-01', '2026-06-01', '2024-06-01', 1200.00, -4950.75, 'PREMIUM'),
('00000000003', 'Y', 500.00, 7500.00, 1500.00, '2021-03-10', '2028-03-10', '2026-03-10', 0.00, -500.00, 'DEFAULT'),
('00000000004', 'Y', 0.00, 3000.00, 500.00, '2022-09-20', '2029-09-20', '2027-09-20', 200.00, -200.00, 'BASIC'),
('00000000005', 'N', 8500.25, 15000.00, 3000.00, '2018-12-01', '2025-12-01', '2023-12-01', 0.00, -8500.25, 'PREMIUM');

-- Cards (from CARDDATA VSAM - CVACT02Y)
INSERT OR IGNORE INTO cards (card_num, account_id, cvv_code, embossed_name, expiration_date, active_status) VALUES
('4111111111111111', '00000000001', '123', 'JOHN M SMITH', '2027-01-15', 'Y'),
('4222222222222222', '00000000002', '456', 'JANE A DOE', '2026-06-01', 'Y'),
('4333333333333333', '00000000003', '789', 'BOB R JOHNSON', '2028-03-10', 'Y'),
('4444444444444444', '00000000001', '321', 'JOHN SMITH BUSINESS', '2027-01-15', 'N'),
('4555555555555555', '00000000004', '654', 'ALICE WILLIAMS', '2029-09-20', 'Y'),
('4666666666666666', '00000000005', '987', 'CHARLIE B BROWN', '2025-12-01', 'Y'),
('4777777777777777', '00000000002', '111', 'JANE DOE TRAVEL', '2026-06-01', 'Y');

-- Card Cross-References (from CARDXREF VSAM - CVACT03Y)
INSERT OR IGNORE INTO card_xref (card_num, account_id, customer_id) VALUES
('4111111111111111', '00000000001', 1),
('4222222222222222', '00000000002', 2),
('4333333333333333', '00000000003', 3),
('4444444444444444', '00000000001', 1),
('4555555555555555', '00000000004', 4),
('4666666666666666', '00000000005', 5),
('4777777777777777', '00000000002', 2);

-- Transaction Types (from TRANTYPE VSAM - CVTRA03Y)
INSERT OR IGNORE INTO transaction_types (type_code, type_description) VALUES
('01', 'Purchase'),
('02', 'Payment'),
('03', 'Cash Advance'),
('04', 'Balance Transfer'),
('05', 'Interest Charge'),
('06', 'Fee'),
('07', 'Refund'),
('08', 'Adjustment');

-- Transaction Categories (from TRANCATG VSAM - CVTRA04Y)
INSERT OR IGNORE INTO transaction_categories (type_code, category_code, category_description) VALUES
('01', '0001', 'Retail Purchase'),
('01', '0002', 'Online Purchase'),
('01', '0003', 'Recurring Purchase'),
('01', '0004', 'International Purchase'),
('02', '0001', 'Bill Payment'),
('02', '0002', 'Auto Payment'),
('03', '0001', 'ATM Cash Advance'),
('03', '0002', 'Over-Counter Cash Advance'),
('04', '0001', 'Standard Balance Transfer'),
('05', '0001', 'Monthly Interest'),
('06', '0001', 'Annual Fee'),
('06', '0002', 'Late Payment Fee'),
('07', '0001', 'Merchant Refund'),
('08', '0001', 'Credit Adjustment');

-- Transaction Category Balances (from TCATBALF VSAM - CVTRA01Y)
INSERT OR IGNORE INTO transaction_category_balances (account_id, type_code, category_code, balance) VALUES
('00000000001', '01', '0001', 800.50),
('00000000001', '01', '0002', 450.00),
('00000000002', '01', '0001', 2200.00),
('00000000002', '01', '0002', 1550.75),
('00000000003', '01', '0001', 500.00),
('00000000005', '01', '0001', 5000.00),
('00000000005', '03', '0001', 3500.25);

-- Disclosure Groups / Interest Rates (from DISCGRP VSAM - CVTRA02Y)
INSERT OR IGNORE INTO disclosure_groups (group_id, type_code, category_code, interest_rate) VALUES
('DEFAULT', '01', '0001', 18.99),
('DEFAULT', '01', '0002', 18.99),
('DEFAULT', '01', '0003', 18.99),
('DEFAULT', '01', '0004', 21.99),
('DEFAULT', '03', '0001', 24.99),
('DEFAULT', '03', '0002', 24.99),
('DEFAULT', '04', '0001', 15.99),
('DEFAULT', '05', '0001', 0.00),
('PREMIUM', '01', '0001', 14.99),
('PREMIUM', '01', '0002', 14.99),
('PREMIUM', '01', '0003', 14.99),
('PREMIUM', '01', '0004', 17.99),
('PREMIUM', '03', '0001', 21.99),
('PREMIUM', '04', '0001', 12.99),
('BASIC', '01', '0001', 22.99),
('BASIC', '01', '0002', 22.99),
('BASIC', '03', '0001', 27.99);

-- Sample Transactions (from TRANSACT VSAM - CVTRA05Y)
INSERT OR IGNORE INTO transactions (tran_id, card_num, type_code, category_code, source, description, amount, merchant_id, merchant_name, merchant_city, merchant_zip, orig_timestamp, proc_timestamp) VALUES
('0000000000000001', '4111111111111111', '01', '0001', 'POS TERM', 'GROCERY STORE PURCHASE', -45.67, '100000001', 'WHOLE FOODS MARKET', 'SEATTLE', '98101', '2026-03-01 10:30:00', '2026-03-01 23:00:00'),
('0000000000000002', '4111111111111111', '01', '0002', 'ONLINE', 'ONLINE ELECTRONICS ORDER', -299.99, '100000002', 'AMAZON.COM', 'SEATTLE', '98109', '2026-03-02 14:15:00', '2026-03-02 23:00:00'),
('0000000000000003', '4111111111111111', '02', '0001', 'POS TERM', 'BILL PAYMENT - ONLINE', 500.00, '999999999', 'BILL PAYMENT', 'N/A', 'N/A', '2026-03-03 09:00:00', '2026-03-03 23:00:00'),
('0000000000000004', '4222222222222222', '01', '0001', 'POS TERM', 'RESTAURANT DINNER', -87.50, '200000001', 'THE FRENCH LAUNDRY', 'PORTLAND', '97201', '2026-03-01 19:45:00', '2026-03-01 23:00:00'),
('0000000000000005', '4222222222222222', '01', '0002', 'ONLINE', 'SOFTWARE SUBSCRIPTION', -49.99, '200000002', 'ADOBE SYSTEMS', 'SAN JOSE', '95110', '2026-03-02 08:00:00', '2026-03-02 23:00:00'),
('0000000000000006', '4222222222222222', '03', '0001', 'ATM', 'ATM CASH WITHDRAWAL', -200.00, '200000003', 'CHASE ATM #4521', 'PORTLAND', '97201', '2026-03-04 12:30:00', '2026-03-04 23:00:00'),
('0000000000000007', '4333333333333333', '01', '0001', 'POS TERM', 'GAS STATION', -55.00, '300000001', 'SHELL STATION', 'SAN FRANCISCO', '94102', '2026-03-01 07:15:00', '2026-03-01 23:00:00'),
('0000000000000008', '4333333333333333', '01', '0004', 'POS TERM', 'INTERNATIONAL HOTEL', -350.00, '300000002', 'MARRIOTT INTL', 'LONDON', 'EC1A', '2026-03-05 16:00:00', '2026-03-05 23:00:00'),
('0000000000000009', '4555555555555555', '01', '0001', 'POS TERM', 'BOOKSTORE PURCHASE', -32.99, '400000001', 'BARNES AND NOBLE', 'DENVER', '80201', '2026-03-03 11:20:00', '2026-03-03 23:00:00'),
('0000000000000010', '4666666666666666', '01', '0001', 'POS TERM', 'ELECTRONICS STORE', -899.99, '500000001', 'BEST BUY #1234', 'AUSTIN', '73301', '2026-03-02 15:45:00', '2026-03-02 23:00:00'),
('0000000000000011', '4666666666666666', '01', '0002', 'ONLINE', 'STREAMING SERVICE', -15.99, '500000002', 'NETFLIX INC', 'LOS GATOS', '95032', '2026-03-01 00:01:00', '2026-03-01 23:00:00'),
('0000000000000012', '4777777777777777', '01', '0001', 'POS TERM', 'CLOTHING STORE', -175.50, '200000004', 'NORDSTROM', 'PORTLAND', '97201', '2026-03-06 13:00:00', '2026-03-06 23:00:00'),
('0000000000000013', '4111111111111111', '05', '0001', 'SYSTEM', 'Int. for a/c 00000000001', -19.77, '000000000', '', '', '', '2026-02-28 23:59:59', '2026-02-28 23:59:59'),
('0000000000000014', '4222222222222222', '05', '0001', 'SYSTEM', 'Int. for a/c 00000000002', -46.82, '000000000', '', '', '', '2026-02-28 23:59:59', '2026-02-28 23:59:59');

-- Daily Transactions for batch posting demo
INSERT OR IGNORE INTO daily_transactions (tran_id, card_num, type_code, category_code, source, description, amount, merchant_id, merchant_name, merchant_city, merchant_zip, orig_timestamp, proc_timestamp) VALUES
('DAILY00000000001', '4111111111111111', '01', '0001', 'POS TERM', 'COFFEE SHOP', -5.75, '100000010', 'STARBUCKS #9876', 'SEATTLE', '98101', '2026-03-17 08:00:00', '2026-03-17 23:00:00'),
('DAILY00000000002', '4222222222222222', '01', '0002', 'ONLINE', 'BOOK ORDER', -24.99, '200000010', 'AMAZON.COM', 'SEATTLE', '98109', '2026-03-17 10:30:00', '2026-03-17 23:00:00'),
('DAILY00000000003', '4333333333333333', '01', '0001', 'POS TERM', 'LUNCH', -18.50, '300000010', 'CHIPOTLE #5432', 'SAN FRANCISCO', '94102', '2026-03-17 12:15:00', '2026-03-17 23:00:00'),
('DAILY00000000004', '9999999999999999', '01', '0001', 'POS TERM', 'INVALID CARD TXN', -100.00, '999000001', 'TEST MERCHANT', 'NOWHERE', '00000', '2026-03-17 14:00:00', '2026-03-17 23:00:00'),
('DAILY00000000005', '4666666666666666', '01', '0001', 'POS TERM', 'OVERLIMIT PURCHASE', -20000.00, '500000010', 'LUXURY STORE', 'AUSTIN', '73301', '2026-03-17 16:00:00', '2026-03-17 23:00:00');
