package com.carddemo.service;

import com.carddemo.dto.CardDetail;
import com.carddemo.model.Account;
import com.carddemo.model.Card;
import com.carddemo.model.CardXref;
import com.carddemo.model.Customer;
import com.carddemo.repository.AccountRepository;
import com.carddemo.repository.CardRepository;
import com.carddemo.repository.CardXrefRepository;
import com.carddemo.repository.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CardService {

    private final CardRepository cardRepository;
    private final CardXrefRepository cardXrefRepository;
    private final CustomerRepository customerRepository;
    private final AccountRepository accountRepository;

    public CardService(CardRepository cardRepository,
                       CardXrefRepository cardXrefRepository,
                       CustomerRepository customerRepository,
                       AccountRepository accountRepository) {
        this.cardRepository = cardRepository;
        this.cardXrefRepository = cardXrefRepository;
        this.customerRepository = customerRepository;
        this.accountRepository = accountRepository;
    }

    public List<Card> listCards(String accountId, String userType) {
        if ("A".equals(userType) && (accountId == null || accountId.isBlank())) {
            // Admin with no accountId filter: return all cards
            return cardRepository.findAll();
        } else if (accountId != null && !accountId.isBlank()) {
            return cardRepository.findByAccountId(accountId);
        } else {
            throw new IllegalArgumentException("Account ID is required for regular users");
        }
    }

    public CardDetail getCardDetail(String cardNum) {
        Card card = cardRepository.findById(cardNum)
                .orElseThrow(() -> new IllegalArgumentException("Card not found: " + cardNum));

        CardXref xref = cardXrefRepository.findById(cardNum).orElse(null);
        String customerName = null;
        String accountStatus = null;
        Double currentBalance = null;
        Double creditLimit = null;
        String accountId = card.getAccountId();

        if (xref != null) {
            Customer customer = customerRepository.findById(xref.getCustomerId()).orElse(null);
            if (customer != null) {
                customerName = (customer.getFirstName() + " " + customer.getLastName()).trim();
            }
        }

        Account account = accountRepository.findById(accountId).orElse(null);
        if (account != null) {
            accountStatus = account.getActiveStatus();
            currentBalance = account.getCurrentBalance();
            creditLimit = account.getCreditLimit();
        }

        return new CardDetail(
                card.getCardNum(),
                card.getAccountId(),
                card.getCvvCode(),
                card.getEmbossedName(),
                card.getExpirationDate(),
                card.getActiveStatus(),
                customerName,
                accountStatus,
                currentBalance,
                creditLimit
        );
    }

    @Transactional
    public Card updateCard(String cardNum, Card updates) {
        Card existing = cardRepository.findById(cardNum)
                .orElseThrow(() -> new IllegalArgumentException("Card not found: " + cardNum));

        boolean changed = false;

        // Validate embossedName non-blank
        if (updates.getEmbossedName() != null) {
            if (updates.getEmbossedName().isBlank()) {
                throw new IllegalArgumentException("Embossed name cannot be blank");
            }
            if (!updates.getEmbossedName().equals(existing.getEmbossedName())) {
                existing.setEmbossedName(updates.getEmbossedName());
                changed = true;
            }
        }

        // Validate expirationDate: month 1-12, year 1950-2099
        if (updates.getExpirationDate() != null) {
            validateCardExpirationDate(updates.getExpirationDate());
            if (!updates.getExpirationDate().equals(existing.getExpirationDate())) {
                existing.setExpirationDate(updates.getExpirationDate());
                changed = true;
            }
        }

        // Validate activeStatus Y or N
        if (updates.getActiveStatus() != null) {
            if (!"Y".equals(updates.getActiveStatus()) && !"N".equals(updates.getActiveStatus())) {
                throw new IllegalArgumentException("Active status must be 'Y' or 'N'");
            }
            if (!updates.getActiveStatus().equals(existing.getActiveStatus())) {
                existing.setActiveStatus(updates.getActiveStatus());
                changed = true;
            }
        }

        if (updates.getCvvCode() != null && !updates.getCvvCode().equals(existing.getCvvCode())) {
            existing.setCvvCode(updates.getCvvCode());
            changed = true;
        }

        // Detect no-change and reject per COBOL spec
        if (!changed) {
            throw new IllegalArgumentException("No changes detected");
        }

        return cardRepository.save(existing);
    }

    private void validateCardExpirationDate(String expirationDate) {
        // Expected format: YYYY-MM-DD
        if (expirationDate == null || expirationDate.isBlank()) {
            throw new IllegalArgumentException("Expiration date is required");
        }
        try {
            String[] parts = expirationDate.split("-");
            if (parts.length < 2) {
                throw new IllegalArgumentException("Expiration date must be in YYYY-MM-DD format");
            }
            int year = Integer.parseInt(parts[0]);
            int month = Integer.parseInt(parts[1]);

            if (month < 1 || month > 12) {
                throw new IllegalArgumentException("Expiration date month must be between 1 and 12");
            }
            if (year < 1950 || year > 2099) {
                throw new IllegalArgumentException("Expiration date year must be between 1950 and 2099");
            }
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Expiration date must be in YYYY-MM-DD format");
        }
    }
}
