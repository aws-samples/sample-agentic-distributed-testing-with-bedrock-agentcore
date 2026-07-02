package com.carddemo.service;

import com.carddemo.dto.BatchResult;
import com.carddemo.model.Account;
import com.carddemo.model.CardXref;
import com.carddemo.model.DailyTransaction;
import com.carddemo.model.DisclosureGroup;
import com.carddemo.model.Transaction;
import com.carddemo.model.TransactionCategoryBalance;
import com.carddemo.repository.AccountRepository;
import com.carddemo.repository.CardXrefRepository;
import com.carddemo.repository.DailyTransactionRepository;
import com.carddemo.repository.DisclosureGroupRepository;
import com.carddemo.repository.TransactionCategoryBalanceRepository;
import com.carddemo.repository.TransactionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class BatchService {

    private final DailyTransactionRepository dailyTransactionRepository;
    private final TransactionRepository transactionRepository;
    private final CardXrefRepository cardXrefRepository;
    private final AccountRepository accountRepository;
    private final TransactionCategoryBalanceRepository categoryBalanceRepository;
    private final DisclosureGroupRepository disclosureGroupRepository;
    private final TransactionService transactionService;

    public BatchService(DailyTransactionRepository dailyTransactionRepository,
                        TransactionRepository transactionRepository,
                        CardXrefRepository cardXrefRepository,
                        AccountRepository accountRepository,
                        TransactionCategoryBalanceRepository categoryBalanceRepository,
                        DisclosureGroupRepository disclosureGroupRepository,
                        TransactionService transactionService) {
        this.dailyTransactionRepository = dailyTransactionRepository;
        this.transactionRepository = transactionRepository;
        this.cardXrefRepository = cardXrefRepository;
        this.accountRepository = accountRepository;
        this.categoryBalanceRepository = categoryBalanceRepository;
        this.disclosureGroupRepository = disclosureGroupRepository;
        this.transactionService = transactionService;
    }

    @Transactional
    public BatchResult postTransactions() {
        // BTR-01: Read all daily_transactions
        List<DailyTransaction> dailyTxns = dailyTransactionRepository.findAll();

        int processed = 0;
        int rejected = 0;
        List<String> rejections = new ArrayList<>();

        for (DailyTransaction dt : dailyTxns) {
            // BTR-02: Validate card exists in xref (reject code 100)
            Optional<CardXref> xrefOpt = cardXrefRepository.findById(dt.getCardNum());
            if (xrefOpt.isEmpty()) {
                rejected++;
                rejections.add("Reject 100: Card " + dt.getCardNum() + " not found in cross-reference (tran: " + dt.getTranId() + ")");
                dailyTransactionRepository.deleteById(dt.getTranId());
                continue;
            }

            CardXref xref = xrefOpt.get();

            // BTR-03: Account must exist (reject code 101)
            Optional<Account> accountOpt = accountRepository.findById(xref.getAccountId());
            if (accountOpt.isEmpty()) {
                rejected++;
                rejections.add("Reject 101: Account " + xref.getAccountId() + " not found (tran: " + dt.getTranId() + ")");
                dailyTransactionRepository.deleteById(dt.getTranId());
                continue;
            }

            Account account = accountOpt.get();

            // BTR-04: Credit limit check (reject code 102) - only for debits (negative amounts)
            if (dt.getAmount() != null && dt.getAmount() < 0) {
                double newBalance = account.getCurrentBalance() + Math.abs(dt.getAmount());
                if (newBalance > account.getCreditLimit()) {
                    rejected++;
                    rejections.add("Reject 102: Transaction exceeds credit limit for account " + account.getAccountId() +
                            " (balance would be " + String.format("%.2f", newBalance) + ", limit is " +
                            String.format("%.2f", account.getCreditLimit()) + ") (tran: " + dt.getTranId() + ")");
                    dailyTransactionRepository.deleteById(dt.getTranId());
                    continue;
                }
            }

            // BTR-04b: Account expiration check (reject code 103)
            if (account.getExpirationDate() != null && !account.getExpirationDate().isBlank()) {
                try {
                    LocalDate expDate = LocalDate.parse(account.getExpirationDate(), DateTimeFormatter.ISO_LOCAL_DATE);
                    if (expDate.isBefore(LocalDate.now())) {
                        rejected++;
                        rejections.add("Reject 103: Account " + account.getAccountId() +
                                " is expired (exp: " + account.getExpirationDate() + ") (tran: " + dt.getTranId() + ")");
                        dailyTransactionRepository.deleteById(dt.getTranId());
                        continue;
                    }
                } catch (Exception e) {
                    // If date parse fails, skip the expiration check
                }
            }

            // BTR-05/06/07: Update account balance
            if (dt.getAmount() != null) {
                double amount = dt.getAmount();
                account.setCurrentBalance(account.getCurrentBalance() + Math.abs(amount));

                if (amount < 0) {
                    // Debit
                    account.setCurrentCycleDebit(
                            (account.getCurrentCycleDebit() != null ? account.getCurrentCycleDebit() : 0.0) + amount);
                } else {
                    // Credit
                    account.setCurrentCycleCredit(
                            (account.getCurrentCycleCredit() != null ? account.getCurrentCycleCredit() : 0.0) + amount);
                }
                accountRepository.save(account);
            }

            // BTR-08: Upsert category balance
            if (dt.getTypeCode() != null && dt.getCategoryCode() != null && dt.getAmount() != null) {
                TransactionCategoryBalance.TransactionCategoryBalanceId balId =
                        new TransactionCategoryBalance.TransactionCategoryBalanceId(
                                xref.getAccountId(), dt.getTypeCode(), dt.getCategoryCode());

                TransactionCategoryBalance catBal = categoryBalanceRepository.findById(balId)
                        .orElseGet(() -> {
                            TransactionCategoryBalance newBal = new TransactionCategoryBalance();
                            newBal.setAccountId(xref.getAccountId());
                            newBal.setTypeCode(dt.getTypeCode());
                            newBal.setCategoryCode(dt.getCategoryCode());
                            newBal.setBalance(0.0);
                            return newBal;
                        });

                catBal.setBalance(catBal.getBalance() + Math.abs(dt.getAmount()));
                categoryBalanceRepository.save(catBal);
            }

            // Copy to transactions table with new tranId
            String newTranId = transactionService.generateNextTranId();
            Transaction txn = new Transaction();
            txn.setTranId(newTranId);
            txn.setCardNum(dt.getCardNum());
            txn.setTypeCode(dt.getTypeCode());
            txn.setCategoryCode(dt.getCategoryCode());
            txn.setSource(dt.getSource());
            txn.setDescription(dt.getDescription());
            txn.setAmount(dt.getAmount());
            txn.setMerchantId(dt.getMerchantId());
            txn.setMerchantName(dt.getMerchantName());
            txn.setMerchantCity(dt.getMerchantCity());
            txn.setMerchantZip(dt.getMerchantZip());
            txn.setOrigTimestamp(dt.getOrigTimestamp());
            txn.setProcTimestamp(LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
            transactionRepository.save(txn);

            // Delete processed daily_transaction
            dailyTransactionRepository.deleteById(dt.getTranId());
            processed++;
        }

        return new BatchResult(processed, rejected, rejections);
    }

    @Transactional
    public Map<String, Object> calculateInterest() {
        // INT-01 through INT-13: Interest calculation per CBACT04C rules
        List<Account> accounts = accountRepository.findAll();
        int accountsProcessed = 0;
        double totalInterestCharged = 0.0;
        List<String> details = new ArrayList<>();

        for (Account account : accounts) {
            // Get category balances for this account
            List<TransactionCategoryBalance> catBalances = categoryBalanceRepository.findByAccountId(account.getAccountId());
            if (catBalances.isEmpty()) {
                continue;
            }

            String groupId = account.getGroupId() != null ? account.getGroupId() : "DEFAULT";
            double totalInterestForAccount = 0.0;

            for (TransactionCategoryBalance catBal : catBalances) {
                if (catBal.getBalance() == null || catBal.getBalance() <= 0) {
                    continue;
                }

                // INT-01: Look up disclosure_group rate
                Optional<DisclosureGroup> discOpt = disclosureGroupRepository
                        .findByGroupIdAndTypeCodeAndCategoryCode(groupId, catBal.getTypeCode(), catBal.getCategoryCode());

                // INT-02: Fall back to DEFAULT if not found
                if (discOpt.isEmpty() && !"DEFAULT".equals(groupId)) {
                    discOpt = disclosureGroupRepository
                            .findByGroupIdAndTypeCodeAndCategoryCode("DEFAULT", catBal.getTypeCode(), catBal.getCategoryCode());
                }

                if (discOpt.isEmpty()) {
                    continue;
                }

                double rate = discOpt.get().getInterestRate();

                // INT-03: Skip if rate = 0
                if (rate == 0.0) {
                    continue;
                }

                // INT-05: Calculate monthly_interest = (balance * rate) / 1200
                double monthlyInterest = (catBal.getBalance() * rate) / 1200.0;
                // Round to 2 decimal places
                monthlyInterest = Math.round(monthlyInterest * 100.0) / 100.0;

                totalInterestForAccount += monthlyInterest;
            }

            if (totalInterestForAccount <= 0) {
                continue;
            }

            // INT-07: Update account: current_balance += total_interest
            account.setCurrentBalance(
                    (account.getCurrentBalance() != null ? account.getCurrentBalance() : 0.0) + totalInterestForAccount);

            // INT-08: Reset cycle counters
            account.setCurrentCycleCredit(0.0);
            account.setCurrentCycleDebit(0.0);
            accountRepository.save(account);

            // INT-09/10: Create system transaction
            // Need a card for this account
            List<CardXref> xrefs = cardXrefRepository.findByAccountId(account.getAccountId());
            String cardNum = xrefs.isEmpty() ? "0000000000000000" : xrefs.get(0).getCardNum();

            String tranId = transactionService.generateNextTranId();
            String now = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

            Transaction txn = new Transaction();
            txn.setTranId(tranId);
            txn.setCardNum(cardNum);
            txn.setTypeCode("01");
            txn.setCategoryCode("05");
            txn.setSource("System");
            txn.setDescription("Int. for a/c " + account.getAccountId());
            txn.setAmount(-totalInterestForAccount); // Interest charges are negative (debit)
            txn.setMerchantId("000000000");
            txn.setMerchantName("");
            txn.setMerchantCity("");
            txn.setMerchantZip("");
            txn.setOrigTimestamp(now);
            txn.setProcTimestamp(now);
            transactionRepository.save(txn);

            totalInterestCharged += totalInterestForAccount;
            accountsProcessed++;
            details.add("Account " + account.getAccountId() + ": interest charged = " +
                    String.format("%.2f", totalInterestForAccount));
        }

        Map<String, Object> summary = new HashMap<>();
        summary.put("accountsProcessed", accountsProcessed);
        summary.put("totalInterestCharged", Math.round(totalInterestCharged * 100.0) / 100.0);
        summary.put("details", details);
        return summary;
    }
}
