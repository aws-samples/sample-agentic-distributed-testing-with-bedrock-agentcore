package com.carddemo.service;

import com.carddemo.model.Account;
import com.carddemo.model.CardXref;
import com.carddemo.model.Transaction;
import com.carddemo.repository.AccountRepository;
import com.carddemo.repository.CardXrefRepository;
import com.carddemo.repository.TransactionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

@Service
public class BillingService {

    private final AccountRepository accountRepository;
    private final CardXrefRepository cardXrefRepository;
    private final TransactionRepository transactionRepository;
    private final TransactionService transactionService;

    public BillingService(AccountRepository accountRepository,
                          CardXrefRepository cardXrefRepository,
                          TransactionRepository transactionRepository,
                          TransactionService transactionService) {
        this.accountRepository = accountRepository;
        this.cardXrefRepository = cardXrefRepository;
        this.transactionRepository = transactionRepository;
        this.transactionService = transactionService;
    }

    @Transactional
    public Map<String, Object> payBill(String accountId) {
        // BIL-01: Account must exist
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        // BIL-02: current_balance > 0
        if (account.getCurrentBalance() == null || account.getCurrentBalance() <= 0) {
            throw new IllegalArgumentException("Account has no outstanding balance to pay");
        }

        // BIL-03: Payment amount = full current_balance
        double paymentAmount = account.getCurrentBalance();

        // Need a card number for the transaction - get first card from xref
        List<CardXref> xrefs = cardXrefRepository.findByAccountId(accountId);
        if (xrefs.isEmpty()) {
            throw new IllegalArgumentException("No card associated with account: " + accountId);
        }
        String cardNum = xrefs.get(0).getCardNum();

        // BIL-05: Create transaction with specific fields
        String tranId = transactionService.generateNextTranId();
        String now = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

        Transaction txn = new Transaction();
        txn.setTranId(tranId);
        txn.setCardNum(cardNum);
        txn.setTypeCode("02");           // Payment type
        txn.setCategoryCode("0001");     // Bill Payment category
        txn.setSource("POS TERM");
        txn.setDescription("BILL PAYMENT - ONLINE");
        txn.setAmount(paymentAmount);    // Positive amount for payment
        txn.setMerchantId("999999999");
        txn.setMerchantName("BILL PAYMENT");
        txn.setMerchantCity("N/A");
        txn.setMerchantZip("N/A");
        txn.setOrigTimestamp(now);
        txn.setProcTimestamp(now);

        transactionRepository.save(txn);

        // Update account: current_balance = 0
        account.setCurrentBalance(0.0);
        accountRepository.save(account);

        return Map.of(
                "transactionId", tranId,
                "amountPaid", paymentAmount
        );
    }
}
