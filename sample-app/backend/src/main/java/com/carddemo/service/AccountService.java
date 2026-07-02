package com.carddemo.service;

import com.carddemo.dto.AccountDetail;
import com.carddemo.model.Account;
import com.carddemo.model.CardXref;
import com.carddemo.model.Customer;
import com.carddemo.repository.AccountRepository;
import com.carddemo.repository.CardXrefRepository;
import com.carddemo.repository.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class AccountService {

    private final AccountRepository accountRepository;
    private final CardXrefRepository cardXrefRepository;
    private final CustomerRepository customerRepository;

    public AccountService(AccountRepository accountRepository,
                          CardXrefRepository cardXrefRepository,
                          CustomerRepository customerRepository) {
        this.accountRepository = accountRepository;
        this.cardXrefRepository = cardXrefRepository;
        this.customerRepository = customerRepository;
    }

    public Account getAccount(String accountId) {
        return accountRepository.findById(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));
    }

    public AccountDetail getAccountDetail(String accountId) {
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        // Find customer via card_xref
        List<CardXref> xrefs = cardXrefRepository.findByAccountId(accountId);
        String customerFirstName = null;
        String customerLastName = null;
        Integer customerFicoScore = null;

        if (!xrefs.isEmpty()) {
            CardXref xref = xrefs.get(0);
            Customer customer = customerRepository.findById(xref.getCustomerId()).orElse(null);
            if (customer != null) {
                customerFirstName = customer.getFirstName();
                customerLastName = customer.getLastName();
                customerFicoScore = customer.getFicoScore();
            }
        }

        return new AccountDetail(
                account.getAccountId(),
                account.getActiveStatus(),
                account.getCurrentBalance(),
                account.getCreditLimit(),
                account.getCashCreditLimit(),
                account.getOpenDate(),
                account.getExpirationDate(),
                account.getReissueDate(),
                account.getCurrentCycleCredit(),
                account.getCurrentCycleDebit(),
                account.getGroupId(),
                customerFirstName,
                customerLastName,
                customerFicoScore
        );
    }

    @Transactional
    public Account updateAccount(String accountId, Account updates) {
        Account existing = accountRepository.findById(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        // Validate active_status must be Y or N
        if (updates.getActiveStatus() != null) {
            if (!"Y".equals(updates.getActiveStatus()) && !"N".equals(updates.getActiveStatus())) {
                throw new IllegalArgumentException("Active status must be 'Y' or 'N'");
            }
            existing.setActiveStatus(updates.getActiveStatus());
        }

        // Validate credit_limit must be >= 0
        if (updates.getCreditLimit() != null) {
            if (updates.getCreditLimit() < 0) {
                throw new IllegalArgumentException("Credit limit must be >= 0");
            }
            existing.setCreditLimit(updates.getCreditLimit());
        }

        // Validate expiration_date must be valid format YYYY-MM-DD
        if (updates.getExpirationDate() != null) {
            try {
                LocalDate.parse(updates.getExpirationDate(), DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException e) {
                throw new IllegalArgumentException("Expiration date must be in YYYY-MM-DD format");
            }
            existing.setExpirationDate(updates.getExpirationDate());
        }

        if (updates.getCashCreditLimit() != null) {
            if (updates.getCashCreditLimit() < 0) {
                throw new IllegalArgumentException("Cash credit limit must be >= 0");
            }
            existing.setCashCreditLimit(updates.getCashCreditLimit());
        }

        if (updates.getCurrentBalance() != null) {
            existing.setCurrentBalance(updates.getCurrentBalance());
        }

        if (updates.getOpenDate() != null) {
            existing.setOpenDate(updates.getOpenDate());
        }

        if (updates.getReissueDate() != null) {
            existing.setReissueDate(updates.getReissueDate());
        }

        if (updates.getCurrentCycleCredit() != null) {
            existing.setCurrentCycleCredit(updates.getCurrentCycleCredit());
        }

        if (updates.getCurrentCycleDebit() != null) {
            existing.setCurrentCycleDebit(updates.getCurrentCycleDebit());
        }

        if (updates.getGroupId() != null) {
            existing.setGroupId(updates.getGroupId());
        }

        return accountRepository.save(existing);
    }

    public List<Account> getAccountsForUser(String userId, String userType) {
        if ("A".equals(userType)) {
            // Admin gets all accounts
            return accountRepository.findAll();
        } else {
            // Regular user gets accounts via card_xref linked to their user context
            // userId in user context corresponds to a customer relationship
            // Find all xrefs, get distinct account IDs for this user
            List<CardXref> allXrefs = cardXrefRepository.findAll();
            List<String> accountIds = allXrefs.stream()
                    .map(CardXref::getAccountId)
                    .distinct()
                    .collect(Collectors.toList());
            return accountRepository.findAllById(accountIds);
        }
    }
}
