# TEST_CASE.md

Manual frontend test cases for the CardDemo credit card management application (modernized 3270 terminal-style UI).

**Pre-requisites for all tests:** Both servers running — backend on port 8021 (`sample-app/backend: ./mvnw spring-boot:run`), frontend on port 8020 (`sample-app/frontend: npm run dev`), or simply `cd sample-app && docker compose up --build`. Fresh database (delete `sample-app/backend/carddemo.db` before starting the backend so seed data is clean).

**Default credentials:**
- Admin: `ADMIN001` / `PASSWORD`
- Regular user: `USER0001` / `PASSWORD`

---

## MD-1: Sign-on, Main Menu Navigation, Account View, and Card Drill-Down

**Objective:** A user signs on via the terminal-style login screen, navigates the numbered main menu, searches for an account, views account details, drills into associated cards, and views card details.

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Navigate to `http://localhost:8020`. | Terminal-style sign-on screen loads. Black background with green/cyan monospace text. Header shows `Tran: CC00`, `Prog: COSGN00C`, `AWS Mainframe Modernization`, `SysID: AWSA`. ASCII dollar bill art is displayed. Yellow prompt reads "Type your User ID and Password, then press ENTER:". |
| TC-2 | Leave both fields empty. Click **ENTER=Sign-on**. | Red alert: `** Please enter both User ID and Password.` |
| TC-3 | Enter `BADUSER` as User ID, `BADPASS` as Password. Click **ENTER=Sign-on**. | Red alert: `** Invalid credentials` (or similar login failure message). |
| TC-4 | Enter `USER0001` as User ID, `PASSWORD` as Password. Click **ENTER=Sign-on**. | Redirected to Main Menu. Terminal header shows `Tran: CM00`, `Prog: COMEN01C`, live `Date:` and `Time:` on the right. Navigation bar shows Menu, Accounts, Cards, Transactions, Bill-Pay, Reports (no Users or Batch links — regular user). Footer shows `ENTER=Continue  F3=Exit  F7=Backward  F8=Forward`. |
| TC-5 | Observe the Main Menu page. | Page title "Main Menu" displayed in white. Numbered menu items listed vertically: `01. Account View` through `10. Bill Payment`. Yellow prompt "Please select an option :" with a 2-character input field. No admin items (11-13) visible. |
| TC-6 | Type `01` in the option field and press Enter. | Navigated to the Accounts page. Page header shows "ACCOUNTS" in white with subtitle "Search and view credit card accounts". |
| TC-7 | Leave the Account ID field empty. Click **Search**. | Error message displayed (regular users must provide an Account ID to search). |
| TC-8 | Enter `0000000011` in Account ID. Click **Search**. | Account table loads with one row showing Account ID `0000000011`, Status badge (Active/Inactive), Current Balance, Credit Limit, and Open Date. All rendered in terminal green text with cyan column headers. |
| TC-9 | Click on the account row for `0000000011`. | Navigated to Account Details page. Three detail sections displayed: **Account Information** (Account ID, Status, Open Date, Expiration Date, Reissue Date, Group ID), **Financial Information** (Current Balance, Credit Limit, Cash Credit Limit, Current Cycle Credit/Debit), **Customer Information** (Customer Name, FICO Score). Labels in cyan with colon suffix, values in green. |
| TC-10 | Click **View Cards** button. | Navigated to Cards page filtered by Account ID `0000000011`. Card table shows associated cards with columns: Card Number (masked in magenta, e.g., `**** **** **** 1234`), Account ID, Embossed Name, Expiration, Status. |
| TC-11 | Click on any card row. | Navigated to Card Details page. Card Information section shows: Card Number (masked), Account ID, Embossed Name, Expiration Date, Status, CVV (`***`). Account Information section shows: Customer Name, Account Status, Current Balance, Credit Limit. |
| TC-12 | Click **Back**. | Returned to Cards list. Previous search results still displayed. |
| TC-13 | Click **F3=Signoff** in the navigation bar. | Redirected to sign-on screen. Session cleared. |

---

## MD-2: Add Transaction, Confirm, View Details, Generate Report, and Bill Payment

**Objective:** A user adds a new credit card transaction with confirmation, verifies it appears in the transaction list and detail view, generates a transaction report covering the date range, and then pays the account balance.

**Pre-condition:** Seed data present. User `USER0001` exists with associated accounts and cards.

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Navigate to `http://localhost:8020`. Log in as `USER0001` / `PASSWORD`. | Dashboard loads to Main Menu. |
| TC-2 | Click **Transactions** in the navigation bar. | Transactions page loads. Page header: "TRANSACTIONS". Filter form shows Account ID and Card Number fields. Transaction table loads with existing seeded transactions. Columns: Tran ID, Card, Type, Amount, Date, Description. |
| TC-3 | Observe the pagination. | If more than 10 transactions exist, pagination shows `F7=Backward  Page 1 of N  F8=Forward` at the bottom of the table. |
| TC-4 | Click **F8=Forward** (Next page button). | Page advances to page 2. Pagination updates to `Page 2 of N`. Different transactions displayed. |
| TC-5 | Click **F7=Backward** (Previous page button). | Returns to page 1. |
| TC-6 | Click on any transaction row. | Navigated to Transaction Details page. Three sections: **Transaction Information** (Transaction ID, Card Number in magenta, Type Code, Type Description, Category Code, Category Description, Source, Description, Amount — green for positive, red for negative), **Merchant Information** (Merchant ID, Name, City, ZIP), **Timestamps** (Original Date, Processing Date). |
| TC-7 | Click **Back**. Return to Main Menu. Type `08` in the option field and press Enter. | Navigated to Add Transaction page. Header: "ADD TRANSACTION". Form shows fields: Account ID, Card Number, Type Code, Category Code, Source, Amount, Description, Merchant ID/Name/City/ZIP, Original Date, Processing Date. |
| TC-8 | Leave all fields empty. Click **Review Transaction**. | Multiple red field-error messages appear below required fields: "Account ID or Card Number is required", "Type code is required", "Amount is required", etc. |
| TC-9 | Fill in: Account ID = `0000000011`, Type Code = `01`, Category Code = `5411`, Source = `ONLINE`, Description = `Test Purchase`, Amount = `125.50`, Merchant ID = `1234567890`, Merchant Name = `Test Store`, Merchant City = `New York`, Merchant ZIP = `10001`, Original Date = today, Processing Date = today. Click **Review Transaction**. | Confirmation box appears with yellow border. Header: "CONFIRM TRANSACTION". Summary rows list all entered values: Account ID, Card Number, Type Code, Category Code, Source, Description, Amount (`$125.50`), Merchant, Location, dates. Two buttons: "Yes, Submit" and "No, Go Back". |
| TC-10 | Click **No, Go Back**. | Returns to the form with all previously entered values preserved. |
| TC-11 | Click **Review Transaction** again. Then click **Yes, Submit**. | Green alert: `>> Transaction created. ID: <new-tran-id>`. Form clears to empty state. |
| TC-12 | Click **Transactions** in the nav bar. | Transaction list loads. The newly created transaction appears (may be on first page depending on sort order) with Amount `$125.50` and Description `Test Purchase`. |
| TC-13 | Click **Reports** in the navigation bar. | Reports page loads. Form shows: Report Type dropdown (Monthly/Yearly/Custom), Start Date, End Date (pre-filled for current month). |
| TC-14 | Leave Report Type as "Monthly". Click **Generate Report**. | Confirmation box: "Generate a Monthly report from <start> to <end>?" with "Yes, Generate" and "No, Cancel" buttons. |
| TC-15 | Click **Yes, Generate**. | Report table appears with columns: Tran ID, Card, Type, Category, Amount, Date, Merchant. The newly added $125.50 transaction is included (if today falls within the month range). Yellow total row at bottom: "Total Amount: $X,XXX.XX". |
| TC-16 | Click **Bill-Pay** in the nav bar. | Bill Payment page loads. Form shows Account ID input and "Look Up" button. |
| TC-17 | Enter `0000000011` in Account ID. Click **Look Up**. | Account Information section appears showing Account ID and Current Balance. If balance > 0, a "Pay Full Balance" button is displayed with the payment amount shown. |
| TC-18 | Click **Pay Full Balance**. | Yellow-bordered confirmation box: "Are you sure you want to pay $X,XXX.XX for account 0000000011?" with "Yes, Pay Now" and "No, Cancel" buttons. |
| TC-19 | Click **Yes, Pay Now**. | Green alert: `>> Payment successful. Transaction ID: <id>. Amount: $X,XXX.XX`. Account info clears. |
| TC-20 | Enter `0000000011` again. Click **Look Up**. | Current Balance now shows `$0.00` (or reduced amount). Info message: "You have nothing to pay. Your current balance is $0.00." |

---

## MD-3: Admin Sign-on, User Management (CRUD), Account Update, and Batch Operations

**Objective:** An admin signs on, creates a new user, verifies the new user can log in, updates the user, updates an account's credit limit, runs batch operations, and finally deletes the test user.

**Pre-condition:** Seed data present. Admin user `ADMIN001` exists.

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Navigate to `http://localhost:8020`. Log in as `ADMIN001` / `PASSWORD`. | Main Menu loads. Title shows "Admin Menu" (admin-specific). Extra menu items visible: `11. User List (Security)`, `12. User Add (Security)`, `13. Batch Operations`. Navigation bar shows Users and Batch links. User badge shows `ADMIN` in yellow. |
| TC-2 | Click **Users** in the navigation bar. | User Management page loads. Header shows "USER MANAGEMENT" with "Add User" button. Table displays existing users with columns: User ID, First Name, Last Name, Type (Admin=yellow badge, User=cyan badge). Pagination visible if more than 10 users. |
| TC-3 | Click **Add User**. | Add User form loads. Fields: User ID, Password, First Name, Last Name, User Type dropdown (User/Admin). |
| TC-4 | Leave all fields empty. Click **Create User**. | Red field-error messages appear: "User ID is required", "Password is required", "First name is required", "Last name is required". |
| TC-5 | Enter User ID = `TEST001`, Password = `TESTPASS`, First Name = `Test`, Last Name = `Account`, User Type = `User`. Click **Create User**. | Green alert: `>> User "TEST001" created successfully.` Form clears. |
| TC-6 | Click **Cancel** (or **Users** nav link). | User list loads. New user `TEST001` appears in the table with Type badge "User" (cyan). |
| TC-7 | Click on the `TEST001` row. | Update User page loads. Header: "UPDATE USER", subtitle "User ID: TEST001". Form shows: User ID (static/read-only), Password (empty, placeholder "Leave blank to keep current"), First Name = `Test`, Last Name = `Account`, User Type = `User`. Delete User button visible (red). |
| TC-8 | Change First Name to `TestUpdated`, Last Name to `AccountUpdated`, User Type to `Admin`. Click **Update User**. | Green alert: `>> User updated successfully.` |
| TC-9 | Click **F3=Signoff**. Log in as `TEST001` / `TESTPASS`. | Main Menu loads. Title shows "Admin Menu" (user is now admin). Navigation bar includes Users and Batch links. Welcome message reflects `TestUpdated AccountUpdated`. |
| TC-10 | Click **F3=Signoff**. Log in as `ADMIN001` / `PASSWORD`. | Admin Main Menu loads. |
| TC-11 | Click **Accounts** in the nav bar. Leave Account ID empty. Click **Search**. | Full account list loads (admins can list all accounts). Table shows multiple accounts with ID, Status, Balance, Credit Limit, Open Date. |
| TC-12 | Click on account `0000000011`. | Account Details page loads with full account information. |
| TC-13 | Click **Edit Account**. | Update Account form loads. Read-only fields: Account ID, Open Date, Current Balance (displayed in magenta in static fields). Editable fields: Status (dropdown), Credit Limit, Cash Credit Limit, Expiration Date, Group ID. |
| TC-14 | Change Credit Limit to `15000`. Click **Update Account**. | Green alert: `>> Account updated successfully.` |
| TC-15 | Click **Back to Accounts** (or navigate to Accounts). Search for `0000000011`. Click on the account row. | Account Details page shows updated Credit Limit: `$15,000.00`. |
| TC-16 | Click **Batch** in the navigation bar. | Batch Operations page loads. Two sections: **Post Daily Transactions** (with description and "Run Post Transactions" button), **Calculate Interest** (with description and "Run Calculate Interest" button). |
| TC-17 | Click **Run Post Transactions**. | Loading indicator: "Processing transactions...". After completion, results box appears with green border showing: `X transactions processed`, `Y transactions rejected`. If rejections exist, a rejection details table is shown. |
| TC-18 | Click **Run Calculate Interest**. | Loading indicator: "Calculating interest...". After completion, results box shows: `X accounts processed`, `Total interest applied: $X,XXX.XX`. |
| TC-19 | Click **Users** in the nav bar. Click on `TEST001`. | Update User page loads for TEST001. |
| TC-20 | Click **Delete User**. | Yellow-bordered confirmation box: "Are you sure you want to delete user TEST001? This action cannot be undone." with "Yes, Delete" and "No, Cancel" buttons. |
| TC-21 | Click **No, Cancel**. | Confirmation box disappears. User not deleted. |
| TC-22 | Click **Delete User** again. Click **Yes, Delete**. | Redirected to User List. `TEST001` no longer appears in the table. |
| TC-23 | Click **F3=Signoff**. Attempt to log in as `TEST001` / `TESTPASS`. | Red alert: `** Invalid credentials`. Login rejected — user has been deleted. |

---

## MD-4: Card Update Validations and Status Toggle

**Objective:** An admin navigates to a card, tests all field-level validations defined in the SPEC (CRD-V01 through CRD-V06, CRD-01 through CRD-03), and toggles card active status.

**Pre-condition:** Seed data present. Admin `ADMIN001` exists. Account `0000000011` has at least one card.

**SPEC References:** CRD-01, CRD-02, CRD-03, CRD-V01 through CRD-V06

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Cards**. | Cards page loads with full card list (admin sees all cards). |
| TC-2 | Search by Account ID `0000000011`. Click on a card row. | Card Details page loads. Note the current card values (Embossed Name, Expiration Date, Status). |
| TC-3 | Click **Edit Card** (or equivalent edit action). | Card update form loads. Card Number displayed as read-only. Editable fields: Embossed Name, Expiration Month, Expiration Year, Active Status. |
| TC-4 | Clear Embossed Name (leave blank). Click **Update Card**. | Red error: "Name can NOT be empty" (CRD-V02). |
| TC-5 | Enter Embossed Name = `UPDATED NAME`. Set Expiration Month to `13`. Click **Update Card**. | Red error: "Card expiry month must be between 1 and 12" (CRD-V03). |
| TC-6 | Set Expiration Month to `0`. Click **Update Card**. | Red error: same month-range validation (CRD-V03). |
| TC-7 | Set Expiration Month to `06`. Set Expiration Year to `1949`. Click **Update Card**. | Red error: "Invalid card expiry year" — year outside 1950-2099 range (CRD-V04). |
| TC-8 | Set Expiration Year to `2100`. Click **Update Card**. | Red error: same year-range validation (CRD-V04). |
| TC-9 | Set Expiration Year to `2028`. Set Active Status to a blank/invalid value (if possible). Click **Update Card**. | Red error: "Card Status must be YES or NO" (CRD-V05, CRD-03). |
| TC-10 | Reset all fields to their original values (no changes). Click **Update Card**. | Red error or info: "No change detected with respect to values fetched" (CRD-V06). |
| TC-11 | Set Active Status to `N` (inactive). Click **Update Card**. | Green alert: card updated successfully. Status now shows Inactive (CRD-01, CRD-02 — Y->N transition). |
| TC-12 | Click **Edit Card** again. Set Active Status back to `Y`. Click **Update Card**. | Green alert: card updated successfully. Status shows Active (CRD-02 — N->Y transition unconstrained). |
| TC-13 | Navigate to Card Details. Verify Embossed Name, Expiration, Status reflect the final updates. | All fields display the updated values correctly. |

---

## MD-5: Card Access Control — Regular User vs Admin

**Objective:** Verify that regular users can only see cards linked to their account, while admins can browse all cards (CRD-AC1 through CRD-AC3).

**Pre-condition:** Seed data present. `USER0001` is linked to specific account(s). Multiple accounts exist with different cards.

**SPEC References:** CRD-AC1, CRD-AC2, CRD-AC3, CRD-R01

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to **Cards**. | Cards page loads. |
| TC-2 | Observe the card list without any filter. | Only cards linked to `USER0001`'s account(s) are shown. The user cannot see cards belonging to other accounts (CRD-AC2). |
| TC-3 | Note the Account IDs shown in the card list. Try searching by a different Account ID (one not belonging to `USER0001`). | Either an error is returned or no results found — regular user cannot access other accounts' cards. |
| TC-4 | Sign off. Log in as `ADMIN001` / `PASSWORD`. Navigate to **Cards**. | Cards page loads. |
| TC-5 | Observe the card list without any filter. | All cards across all accounts are displayed (CRD-AC1 — admin sees all). |
| TC-6 | Search by different Account IDs. | Cards for each searched account are displayed. Admin has unrestricted access. |

---

## MD-6: Transaction Add — Cross-Reference Validation

**Objective:** Test that transaction add correctly resolves Account ID and Card Number via cross-reference, and rejects when neither is found (TRN-03 through TRN-06).

**Pre-condition:** Seed data present. Account `0000000011` exists with at least one card in cross-reference.

**SPEC References:** TRN-01 through TRN-07

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to Add Transaction (Main Menu option `08` or nav link). | Add Transaction form loads. |
| TC-2 | Leave both Account ID and Card Number empty. Fill all other fields with valid data. Click **Review Transaction**. | Red error: "Account ID or Card Number is required" (TRN-03). |
| TC-3 | Enter Account ID = `9999999999` (non-existent). Leave Card Number empty. Fill other fields. Click **Review Transaction**. | Red error: "Account ID NOT found" (TRN-06). |
| TC-4 | Clear Account ID. Enter Card Number = `9999999999999999` (non-existent). Fill other fields. Click **Review Transaction**. | Red error: "Card Number NOT found" (TRN-06). |
| TC-5 | Enter a valid Account ID = `0000000011`. Leave Card Number empty. Fill other fields validly. Click **Review Transaction**. | Confirmation box appears. Card Number is auto-resolved from the cross-reference (TRN-04). The summary shows the resolved Card Number. |
| TC-6 | Click **No, Go Back**. Clear Account ID. Enter a valid Card Number from seed data. Fill other fields. Click **Review Transaction**. | Confirmation box appears. Account ID is auto-resolved from the cross-reference (TRN-05). The summary shows the resolved Account ID. |
| TC-7 | Click **Yes, Submit**. | Green alert with new Transaction ID. The ID is auto-generated (TRN-01). |
| TC-8 | Navigate to Add Transaction again. Submit an identical transaction (same data). | Either succeeds with a new unique Transaction ID (auto-increment), or if duplicate detection is implemented, error "Tran ID already exist" (TRN-02). |

---

## MD-7: Transaction Add — Field-Level Validations

**Objective:** Test all mandatory field validations for the transaction add form per SPEC section 3.2.1.

**Pre-condition:** Seed data present. Valid Account ID `0000000011` exists.

**SPEC References:** Section 3.2.1 mandatory fields table

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to Add Transaction. | Form loads. |
| TC-2 | Enter Account ID = `0000000011`. Enter Type Code = `ABC` (non-numeric). Click **Review Transaction**. | Red error on Type Code: "is not valid" — must be numeric. |
| TC-3 | Enter Type Code = `01`. Enter Category Code = `ABCD` (non-numeric). Click **Review Transaction**. | Red error on Category Code: "is not valid" — must be numeric. |
| TC-4 | Enter Category Code = `5411`. Leave Source empty. Click **Review Transaction**. | Red error on Source: "can NOT be empty". |
| TC-5 | Enter Source = `ONLINE`. Leave Description empty. Click **Review Transaction**. | Red error on Description: "can NOT be empty". |
| TC-6 | Enter Description = `Test`. Leave Amount empty. Click **Review Transaction**. | Red error on Amount: required/invalid. |
| TC-7 | Enter Amount = `ABC` (non-numeric). Click **Review Transaction**. | Red error on Amount: invalid format. |
| TC-8 | Enter Amount = `125.50`. Enter Original Date = `2026-13-01` (invalid month 13). Click **Review Transaction**. | Red error on date: "is not a valid date". |
| TC-9 | Enter Original Date = `2026-02-30` (Feb 30, invalid day). Click **Review Transaction**. | Red error on date: "is not a valid date". |
| TC-10 | Enter valid Original Date = today. Enter Processing Date = `not-a-date`. Click **Review Transaction**. | Red error on Processing Date: "is not a valid date". |
| TC-11 | Enter valid Processing Date = today. Leave Merchant ID empty. Click **Review Transaction**. | Red error on Merchant ID: required/invalid. |
| TC-12 | Enter Merchant ID = `ABC` (non-numeric). Click **Review Transaction**. | Red error: Merchant ID "is not valid" — must be numeric. |
| TC-13 | Enter Merchant ID = `123456789`. Leave Merchant Name empty. Click **Review Transaction**. | Red error: "can NOT be empty". |
| TC-14 | Enter Merchant Name = `Store`. Leave Merchant City empty. Click **Review Transaction**. | Red error: "can NOT be empty". |
| TC-15 | Enter Merchant City = `NYC`. Leave Merchant ZIP empty. Click **Review Transaction**. | Red error: "can NOT be empty". |
| TC-16 | Enter Merchant ZIP = `10001`. Click **Review Transaction**. | Confirmation box appears — all validations pass. |

---

## MD-8: Transaction Add — Confirmation Flow

**Objective:** Verify the explicit confirmation requirement (TRN-07) — user must confirm before the transaction is written.

**SPEC References:** TRN-07

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in. Navigate to Add Transaction. Fill all fields with valid data. Click **Review Transaction**. | Confirmation box appears with transaction summary. |
| TC-2 | Click **No, Go Back**. | Returns to form. All entered values are preserved. Transaction is NOT created. |
| TC-3 | Navigate to Transactions. Search for the transaction. | Transaction does not exist — it was not submitted. |
| TC-4 | Navigate back to Add Transaction. Fill same valid data. Click **Review Transaction**. | Confirmation box appears again. |
| TC-5 | Click **Yes, Submit**. | Green alert: transaction created with a new Transaction ID. |
| TC-6 | Navigate to Transactions. Search for the new transaction. | Transaction appears in the list with correct details. |

---

## MD-9: Transaction Browse and Pagination

**Objective:** Verify transaction list displays 10 records per page with forward/backward navigation (TRN-B01 through TRN-B05).

**Pre-condition:** Seed data contains more than 20 transactions.

**SPEC References:** TRN-B01 through TRN-B05

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Transactions**. | Transaction list loads. Exactly 10 rows displayed per page (TRN-B01). |
| TC-2 | Note the Transaction IDs on page 1. | IDs are sorted ascending (TRN-B01). |
| TC-3 | Click **F8=Forward**. | Page 2 loads with the next 10 transactions. No overlap with page 1 IDs. Pagination shows "Page 2 of N". |
| TC-4 | Click **F8=Forward** again (if more pages exist). | Page 3 loads. Continues sequentially. |
| TC-5 | Click **F7=Backward**. | Returns to page 2. Same transactions as before. |
| TC-6 | Click **F7=Backward** again. | Returns to page 1. Same original transactions. |
| TC-7 | On page 1, click **F7=Backward**. | No action or stays on page 1 (cannot go before first page). |
| TC-8 | Navigate to the last page. Click **F8=Forward**. | No action or stays on last page (cannot go past last page). Last page may have fewer than 10 records. |
| TC-9 | Click on any transaction row (select with `'S'`). | Navigated to Transaction Details page showing all fields: Transaction ID, Card Number, Type Code, Type Description, Category Code, Category Description, Source, Description, Amount, Merchant ID, Merchant Name, Merchant City, Merchant ZIP, Original Date, Processing Date (TRN-B04, TRN-B05). |

---

## MD-10: Bill Payment — Edge Cases and Validations

**Objective:** Test all bill payment business rules including empty account, zero balance, full balance payment, and confirmation (BIL-01 through BIL-09).

**Pre-condition:** Seed data present. At least one account has a positive balance. At least one account has zero balance.

**SPEC References:** BIL-01 through BIL-10

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to **Bill-Pay**. | Bill Payment page loads. |
| TC-2 | Leave Account ID empty. Click **Look Up**. | Red error: "Acct ID can NOT be empty" (BIL-01). |
| TC-3 | Enter Account ID = `9999999999` (non-existent). Click **Look Up**. | Error: account not found. |
| TC-4 | Enter an Account ID with a zero (or non-positive) current balance. Click **Look Up**. | Account info loads showing $0.00 balance. Message: "You have nothing to pay" (BIL-02). No payment button is displayed. |
| TC-5 | Enter Account ID = `0000000011` (with positive balance). Click **Look Up**. | Account info shows current balance. **Pay Full Balance** button displayed. Payment amount equals the full current balance — no partial payment option (BIL-03). |
| TC-6 | Note the current balance amount (e.g., `$X,XXX.XX`). Click **Pay Full Balance**. | Confirmation box: "Are you sure you want to pay $X,XXX.XX for account 0000000011?" (BIL-08). |
| TC-7 | Click **No, Cancel**. | Confirmation dismissed. No payment made. Account info still shows original balance. |
| TC-8 | Click **Pay Full Balance** again. Click **Yes, Pay Now**. | Green alert: "Payment successful. Transaction ID: <id>." (BIL-09). Transaction created with Type `02`, Description `BILL PAYMENT - ONLINE` (BIL-05). |
| TC-9 | Enter `0000000011` again. Click **Look Up**. | Balance now shows `$0.00`. Balance is fully paid: `ACCT-CURR-BAL - TRAN-AMT = 0` (BIL-04). Message: "You have nothing to pay." |
| TC-10 | Navigate to **Transactions**. Search for the account. | New transaction visible with Description `BILL PAYMENT - ONLINE`, Type `02`, Merchant ID `999999999`, Merchant Name `BILL PAYMENT` (BIL-05, BIL-06). Transaction ID matches the one from the success message (BIL-07). |

---

## MD-11: Account Update — Field Validations and Credit Limit

**Objective:** Test account update validations including credit limit fields, expiration date, and status changes (CLM-05, section 3.5).

**Pre-condition:** Admin user `ADMIN001` exists. Account `0000000011` exists in seed data.

**SPEC References:** CLM-05, CLM-06, RSK-01

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Accounts**. Search for `0000000011`. Click on the account. | Account Details page loads. |
| TC-2 | Click **Edit Account**. | Update form loads. Read-only: Account ID, Open Date, Current Balance. Editable: Status, Credit Limit, Cash Credit Limit, Expiration Date, Group ID. |
| TC-3 | Clear Credit Limit field (leave blank). Click **Update Account**. | Red error: Credit Limit is required (CLM-05). |
| TC-4 | Enter Credit Limit = `ABC` (non-numeric). Click **Update Account**. | Red error: Credit Limit must be a valid numeric value (CLM-05). |
| TC-5 | Enter Credit Limit = `20000`. Clear Cash Credit Limit. Click **Update Account**. | Red error: Cash Credit Limit is required (CLM-05). |
| TC-6 | Enter Cash Credit Limit = `5000`. Enter an invalid Expiration Date (e.g., `2020-13-45`). Click **Update Account**. | Red error: invalid date. |
| TC-7 | Enter Expiration Date = `2028-12-31`. Click **Update Account**. | Green alert: account updated successfully. |
| TC-8 | Navigate back to Account Details for `0000000011`. | Credit Limit = `$20,000.00`, Cash Credit Limit = `$5,000.00`, Expiration Date = `2028-12-31`. |
| TC-9 | Click **Edit Account**. Change Status to inactive/closed. Click **Update Account**. | Green alert: account updated. Status now shows inactive/closed. |
| TC-10 | Click **Edit Account**. Change Status back to active. Click **Update Account**. | Green alert: account updated. Status restored. |

---

## MD-12: Report Generation — All Report Types

**Objective:** Test all three report types (Monthly, Yearly, Custom) with date validation (RPT-01 through RPT-05).

**Pre-condition:** Seed data with transactions spanning different dates.

**SPEC References:** RPT-01 through RPT-05, RPT-D01 through RPT-D05

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to **Reports**. | Reports page loads with Report Type dropdown and date fields. |
| TC-2 | Select Report Type = **Monthly**. | Start Date auto-fills to 1st of current month. End Date auto-fills to last day of current month (RPT-01). |
| TC-3 | Click **Generate Report**. Confirm if prompted. | Report table appears with transactions from the current month. Columns: Tran ID, Card, Type, Category, Amount, Date, Merchant. Total row at bottom (RPT-D01, RPT-D04). |
| TC-4 | Select Report Type = **Yearly**. | Start Date auto-fills to Jan 1 of current year. End Date auto-fills to Dec 31 of current year (RPT-01). |
| TC-5 | Click **Generate Report**. Confirm if prompted. | Report table shows all transactions for the current year. Total row at bottom. |
| TC-6 | Select Report Type = **Custom**. | Date fields become editable (no auto-fill). |
| TC-7 | Enter Start Date month = `13` (invalid). Click **Generate Report**. | Red error: invalid date — month must be 01-12 (RPT-02). |
| TC-8 | Enter Start Date = `2025-01-01`, End Date day = `32` (invalid). Click **Generate Report**. | Red error: invalid date — day must be 01-31 (RPT-02). |
| TC-9 | Enter Start Date = `2025-01-01`, End Date = `2025-12-31`. Click **Generate Report**. | Confirmation box: "Generate a Custom report from 2025-01-01 to 2025-12-31?" (RPT-05). |
| TC-10 | Click **No, Cancel**. | Confirmation dismissed. No report generated. |
| TC-11 | Click **Generate Report** again. Click **Yes, Generate**. | Report table loads with transactions in the specified range. If transaction type/category descriptions are available, they appear in the table (RPT-D02, RPT-D03). |
| TC-12 | Verify total row. | Total amount equals sum of all displayed transaction amounts (RPT-D04). |

---

## MD-13: User Management — Duplicate and Edge Cases

**Objective:** Test user creation edge cases including duplicate User ID, field validations, and password behavior.

**Pre-condition:** Admin `ADMIN001` exists in seed data.

**SPEC References:** SEC-01 through SEC-09

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Users**. Click **Add User**. | Add User form loads. |
| TC-2 | Enter User ID = `ADMIN001` (already exists), Password = `NEWPASS`, First Name = `Dup`, Last Name = `User`. Click **Create User**. | Red error: user already exists (duplicate User ID). |
| TC-3 | Enter User ID = `EDGE001`, Password = `PASS1`, First Name = `Edge`, Last Name = `Test`, User Type = `User`. Click **Create User**. | Green alert: user created. |
| TC-4 | Navigate to Users. Click on `EDGE001`. | Update User page loads with First Name = `Edge`, Last Name = `Test`, Type = `User`. |
| TC-5 | Clear Password field (leave blank to keep current). Change First Name to `Updated`. Click **Update User**. | Green alert: user updated. Password remains unchanged (original `PASS1` still works). |
| TC-6 | Sign off. Log in as `EDGE001` / `PASS1`. | Login succeeds — password was preserved. |
| TC-7 | Sign off. Log in as `ADMIN001` / `PASSWORD`. Navigate to Users. Click on `EDGE001`. | Update User page loads. |
| TC-8 | Enter new Password = `NEWPASS`. Click **Update User**. | Green alert: user updated. |
| TC-9 | Sign off. Log in as `EDGE001` / `PASS1` (old password). | Red alert: invalid credentials — old password no longer works. |
| TC-10 | Log in as `EDGE001` / `NEWPASS` (new password). | Login succeeds with new password. |
| TC-11 | Sign off. Log in as `ADMIN001` / `PASSWORD`. Delete user `EDGE001`. | User deleted successfully. |
| TC-12 | Sign off. Attempt to log in as `EDGE001` / `NEWPASS`. | Red alert: invalid credentials — deleted user cannot log in (SEC-08: hard delete). |

---

## MD-14: Authentication — Sign-on Edge Cases

**Objective:** Test authentication boundary conditions per SPEC security findings (SEC-01 through SEC-07).

**SPEC References:** SEC-01 through SEC-07

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Navigate to `http://localhost:8020`. Enter User ID = `USER0001`, Password = `password` (lowercase). Click **ENTER=Sign-on**. | Login succeeds — password comparison is case-insensitive (SEC-02: both input and stored value converted to UPPER-CASE). |
| TC-2 | Sign off. Enter User ID = `user0001` (lowercase). Password = `PASSWORD`. Click **ENTER=Sign-on**. | Login succeeds or fails depending on whether User ID comparison is also case-insensitive. Document actual behavior. |
| TC-3 | Sign off. Enter User ID = `USER0001`, Password = ` ` (single space). Click **ENTER=Sign-on**. | Red alert: invalid credentials. |
| TC-4 | Enter User ID = `USER0001`, Password = `PASSWORD` with trailing spaces. Click **ENTER=Sign-on**. | Login succeeds (trailing spaces typically trimmed in 8-character PIC X(08) field). |
| TC-5 | Sign off. Attempt login 5 times with wrong password for `USER0001`. | All 5 attempts return "Invalid credentials". No lockout occurs (SEC-05: no account lockout after failed attempts). 6th attempt with correct password succeeds. |
| TC-6 | Log in as `USER0001` / `PASSWORD`. Leave the session idle. | Session persists indefinitely — no idle timeout (SEC-06). |
| TC-7 | Navigate to sign-on screen directly (e.g., type the login URL). | Session state clears and sign-on screen loads. |

---

## MD-15: Role-Based Access Control — Route Protection

**Objective:** Verify that regular users cannot access admin-only features and that unauthenticated users are redirected to login.

**SPEC References:** CRD-AC1, CRD-AC2, Section 4.1.1 navigation rules

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Without logging in, navigate directly to `http://localhost:8020/accounts`. | Redirected to sign-on screen. Unauthenticated access blocked. |
| TC-2 | Without logging in, navigate to `http://localhost:8020/users`. | Redirected to sign-on screen. |
| TC-3 | Log in as `USER0001` / `PASSWORD`. | Main Menu loads. Navigation bar does NOT show "Users" or "Batch" links. |
| TC-4 | Attempt to navigate directly to `http://localhost:8020/users`. | Either redirected to Main Menu with an error, or a "403 Forbidden" / "Access Denied" message. Regular users cannot access user management. |
| TC-5 | Attempt to navigate directly to `http://localhost:8020/batch`. | Same as above — batch operations are admin-only. |
| TC-6 | Navigate to **Accounts**. Attempt to access another user's account by entering a different Account ID. | Either no results returned or error — regular users are scoped to their own accounts. |
| TC-7 | Sign off. Log in as `ADMIN001` / `PASSWORD`. | Admin Menu loads. Navigation bar shows "Users" and "Batch" links. |
| TC-8 | Navigate to `http://localhost:8020/users`. | User Management page loads — admin access allowed. |
| TC-9 | Navigate to `http://localhost:8020/batch`. | Batch Operations page loads — admin access allowed. |
| TC-10 | Navigate to **Accounts**. Search without Account ID. | Full account list shown — admin can view all accounts (CRD-AC1). |

---

## MD-16: Batch Transaction Posting — Rejection Scenarios

**Objective:** Verify that batch posting validates transactions and generates proper rejection codes (BTR-01 through BTR-08).

**Pre-condition:** Admin `ADMIN001` logged in. Seed data includes daily transactions. For rejection testing, test transactions need to trigger validation failures.

**SPEC References:** BTR-01 through BTR-08

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Accounts**. Search for `0000000011`. Note the Current Balance and Credit Limit. | Account details loaded. Record starting balance. |
| TC-2 | Navigate to **Batch**. Click **Run Post Transactions**. | Processing completes. Results show: transactions processed count, rejected count. |
| TC-3 | If rejections exist, examine the rejection details table. | Each rejected transaction shows a reject code and reason: `100` = "INVALID CARD NUMBER FOUND" (BTR-01), `101` = "ACCOUNT RECORD NOT FOUND" (BTR-02), `102` = "OVERLIMIT TRANSACTION" (BTR-03), `103` = "TRANSACTION RECEIVED AFTER ACCT EXPIRATION" (BTR-04). |
| TC-4 | Navigate to **Accounts**. Search for `0000000011`. | Current Balance has been updated by the sum of posted transactions (BTR-05). |
| TC-5 | Compare balance change to expected: positive amounts added as credits (BTR-06), negative amounts added as debits (BTR-07). | Balance reflects `old_balance + SUM(posted transaction amounts)`. |
| TC-6 | Run **Post Transactions** again immediately. | Second run processes 0 or minimal transactions (daily transactions already consumed). No errors. |

---

## MD-17: Interest Calculation — Verification

**Objective:** Verify interest calculation updates account balances correctly (INT-01 through INT-13).

**Pre-condition:** Admin `ADMIN001` logged in. Batch posting has been run (transactions posted, category balances exist).

**SPEC References:** INT-01 through INT-13, FEE-01

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Accounts**. Search for an account with a positive balance. Note the Current Balance. | Record starting balance. |
| TC-2 | Navigate to **Batch**. Click **Run Calculate Interest**. | Processing completes. Results show: accounts processed count, total interest applied amount. |
| TC-3 | Navigate to **Accounts**. Search for the same account. | Current Balance has increased by the interest amount: `new_balance = old_balance + interest_charged` (INT-07). |
| TC-4 | Navigate to **Transactions**. Search for the account. | New system-generated transaction(s) visible with Type = `01`, Category = `05`, Source = `System`, Description containing `Int. for a/c` + Account ID (INT-09, INT-10). |
| TC-5 | Verify the interest transaction amount. | Interest = `(category_balance * annual_rate) / 1200` (INT-05, monthly formula). |
| TC-6 | Run **Calculate Interest** again immediately. | Second run either processes 0 accounts (cycle counters were reset — INT-08) or charges minimal interest on the newly posted interest itself. |

---

## MD-18: Account View — Customer Information and Cross-Reference

**Objective:** Verify the account view correctly resolves the card-account-customer relationship chain (CRD-R01, CRD-R02).

**Pre-condition:** Seed data present with linked customer, account, and card records.

**SPEC References:** CRD-R01, CRD-R02, CRD-R03, Section 2.4.3

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Accounts**. Search for `0000000011`. Click on the account. | Account Details page loads with three sections: Account Information, Financial Information, Customer Information. |
| TC-2 | Verify Account Information section. | Displays: Account ID, Status (Active/Inactive), Open Date, Expiration Date, Reissue Date, Group ID. |
| TC-3 | Verify Financial Information section. | Displays: Current Balance (formatted as currency), Credit Limit, Cash Credit Limit, Current Cycle Credit, Current Cycle Debit. |
| TC-4 | Verify Customer Information section. | Displays: Customer Name (resolved from CUSTDAT via XREF), FICO Score (3-digit, range 300-850 — RSK-01). The customer name matches the linked customer record. |
| TC-5 | Click **View Cards**. | Cards list shows cards whose Account ID matches `0000000011`. Each card maps to exactly one account and one customer (CRD-R01). |
| TC-6 | Click on a card. Verify Account Information section in Card Details. | Shows Customer Name, Account Status, Current Balance, Credit Limit — all resolved through the XREF chain: Card -> XREF -> Account + Customer (CRD-R02). |

---

## MD-19: Credit Limit Enforcement Gap — Online Transaction Add

**Objective:** Document that online transaction add does NOT enforce credit limits (CLM-03), per the SPEC's identified gap.

**Pre-condition:** Account `0000000011` exists with a known Credit Limit (e.g., `$10,000`). Current Balance is below the limit.

**SPEC References:** CLM-03, CLM-04

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to **Accounts**. Check `0000000011` balance and credit limit. | Note: Current Balance = `$X`, Credit Limit = `$Y`. |
| TC-2 | Navigate to Add Transaction. Enter Account ID = `0000000011`. Fill all fields. Set Amount to a value that would exceed the credit limit (e.g., `$999999.99`). Click **Review Transaction**. | Confirmation box appears — **no credit limit check is performed** (CLM-03). |
| TC-3 | Click **Yes, Submit**. | Transaction created successfully despite exceeding credit limit. |
| TC-4 | Navigate to **Accounts**. Search for `0000000011`. | Current Balance reflects the over-limit amount. No warning or block was applied. |
| TC-5 | Navigate to **Bill-Pay**. Enter `0000000011`. Click **Look Up**. Pay the balance. | Bill payment succeeds regardless of balance amount — **no credit limit check on bill payment** (CLM-04). |

---

## MD-20: Sign-on Routing — Admin vs Regular User

**Objective:** Verify that sign-on correctly routes admin users to Admin Menu and regular users to User Menu (Section 4.1.1 navigation rules).

**SPEC References:** Section 4.1.1 navigation rules

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. | Redirected to Main Menu. Title shows "Main Menu". Menu items: `01` through `10` (user functions). No admin items (11-13). Nav bar has: Menu, Accounts, Cards, Transactions, Bill-Pay, Reports. No Users or Batch links. |
| TC-2 | Verify menu options listed. | Includes: Account View, Account Update (if permitted), Credit Card List, Credit Card View, Credit Card Update, Transaction List, Transaction View, Transaction Add, Bill Payment, Transaction Reports. |
| TC-3 | Sign off. Log in as `ADMIN001` / `PASSWORD`. | Redirected to Admin Menu. Title shows "Admin Menu". Additional menu items visible: `11. User List`, `12. User Add`, `13. Batch Operations`. Nav bar includes Users and Batch links. User badge shows `ADMIN` in yellow. |
| TC-4 | Verify admin-specific menu options. | Items 11-13 visible. User management and batch operations accessible. |

---

## MD-21: Card List — Masked Display and Pagination

**Objective:** Verify card list displays masked card numbers and paginates correctly.

**Pre-condition:** Seed data with more than 10 cards.

**SPEC References:** CRD-AC3, Section 3.8.3 (PAN masking), TRN-B01 analogy

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Cards**. | Card list loads with all cards (admin view). |
| TC-2 | Observe card number column. | Card numbers are masked (e.g., `**** **** **** 1234`). Full PAN is NOT displayed in the list view. |
| TC-3 | If more than 10 cards, verify pagination. | Pagination controls show page number. 10 cards per page. F7/F8 navigation works. |
| TC-4 | Click on a card row. | Card Details loads. Card Number is still masked. CVV shows `***`. |
| TC-5 | Verify no full PAN or CVV is exposed anywhere in the UI. | PAN always masked. CVV never shown in cleartext. This aligns with PCI-DSS requirements (Section 3.8.2). |

---

## MD-22: User List — Pagination and Type Badges

**Objective:** Verify user list displays correct type badges and paginates properly.

**Pre-condition:** Admin `ADMIN001` logged in. Seed data has multiple users.

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Users**. | User Management page loads with user table. |
| TC-2 | Observe User Type column. | Admin users show yellow "Admin" badge. Regular users show cyan "User" badge. |
| TC-3 | Verify columns: User ID, First Name, Last Name, Type. | All columns populated for each user. |
| TC-4 | If more than 10 users, verify pagination. | 10 users per page. Pagination controls (F7/F8) functional. |
| TC-5 | Click on any user row. | Navigated to Update User page for that user. User ID displayed as read-only. |

---

## MD-23: Session and Navigation — F3=Exit Behavior

**Objective:** Verify F3=Exit/Signoff behavior from various screens.

**SPEC References:** Section 4.1.1 (PF3 exit returns to caller or falls back to menu/signon)

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `USER0001` / `PASSWORD`. Navigate to **Accounts**. Search and click on an account. | Account Details page. |
| TC-2 | Click **Back** (or F3 equivalent). | Returns to Account list (previous screen). |
| TC-3 | Click **Back** again (or F3). | Returns to Main Menu (or Accounts search page). |
| TC-4 | Navigate to Cards > Card Details > Edit Card. Click **Cancel** or **Back**. | Returns to Card Details (previous screen). |
| TC-5 | Navigate deeply: Accounts > Account Details > View Cards > Card Details. Click **Back** repeatedly. | Each click goes up one level: Card Details -> Card List -> Account Details -> Account List. Navigation stack is preserved. |
| TC-6 | From Main Menu, click **F3=Signoff**. | Redirected to sign-on screen. Session terminated. |
| TC-7 | Click browser Back button after sign-off. | Does NOT return to authenticated content. Redirected to sign-on screen (session is cleared). |

---

## MD-24: Batch Operations — Sequential Dependency

**Objective:** Verify batch operations run in correct order and that interest calculation depends on posted transactions (Section 2.3 batch pipeline).

**Pre-condition:** Fresh seed data. Admin `ADMIN001` logged in.

**SPEC References:** Section 2.3 batch cycle, INT-05 through INT-08

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Batch**. | Batch Operations page shows Post Transactions and Calculate Interest sections. |
| TC-2 | Click **Run Calculate Interest** FIRST (before posting transactions). | Interest calculation completes. Result shows accounts processed count. If no transactions have been posted (TCATBALF empty/zeroed), interest should be $0.00 or minimal. |
| TC-3 | Navigate to **Accounts**. Check an account balance. | Balance unchanged or minimally changed (no category balances to charge interest on). |
| TC-4 | Navigate to **Batch**. Click **Run Post Transactions**. | Transactions posted. Result shows count of processed and rejected. |
| TC-5 | Click **Run Calculate Interest**. | Interest calculated on the newly posted category balances. Total interest applied is > $0.00. |
| TC-6 | Navigate to **Accounts**. Check the same account. | Balance increased by the interest amount. |
| TC-7 | Navigate to **Transactions**. Search the account. | System-generated interest transactions visible (Type `01`, Category `05`, Source `System`). |

---

## MD-25: Data Integrity — Cross-Reference Consistency

**Objective:** Verify that the application correctly handles cross-reference lookups and displays consistent data across views.

**SPEC References:** CRD-R01 through CRD-R03, Section 4.2.1

| TC | Action | Expected Result |
|------|--------|-----------------|
| TC-1 | Log in as `ADMIN001` / `PASSWORD`. Navigate to **Accounts**. Search `0000000011`. Click to view details. Note Customer Name. | Customer name displayed (e.g., "John Smith"). |
| TC-2 | Click **View Cards**. Click on a card. Note the Customer Name in Account Information section. | Same customer name as in step 1. Data is consistent through XREF chain. |
| TC-3 | Navigate to **Transactions**. Filter by the card number from step 2. | Transactions for that card are displayed. Card Number matches. |
| TC-4 | Navigate to Add Transaction. Enter Account ID `0000000011`. Submit a valid transaction. | Transaction created. Card Number auto-resolved from cross-reference. |
| TC-5 | Navigate to **Transactions**. Find the new transaction. | Transaction shows the auto-resolved Card Number matching the XREF record for account `0000000011`. |
| TC-6 | Navigate to **Bill-Pay**. Enter `0000000011`. Look up. | Account info displayed with correct balance reflecting the transaction from step 4. |
