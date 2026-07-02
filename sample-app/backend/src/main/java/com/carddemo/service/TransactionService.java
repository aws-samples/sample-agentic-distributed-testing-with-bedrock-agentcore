package com.carddemo.service;

import com.carddemo.dto.PageResponse;
import com.carddemo.dto.TransactionAddRequest;
import com.carddemo.dto.TransactionDetail;
import com.carddemo.model.CardXref;
import com.carddemo.model.Transaction;
import com.carddemo.model.TransactionCategory;
import com.carddemo.model.TransactionType;
import com.carddemo.repository.CardXrefRepository;
import com.carddemo.repository.TransactionCategoryRepository;
import com.carddemo.repository.TransactionRepository;
import com.carddemo.repository.TransactionTypeRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class TransactionService {

    private final TransactionRepository transactionRepository;
    private final TransactionTypeRepository transactionTypeRepository;
    private final TransactionCategoryRepository transactionCategoryRepository;
    private final CardXrefRepository cardXrefRepository;

    public TransactionService(TransactionRepository transactionRepository,
                              TransactionTypeRepository transactionTypeRepository,
                              TransactionCategoryRepository transactionCategoryRepository,
                              CardXrefRepository cardXrefRepository) {
        this.transactionRepository = transactionRepository;
        this.transactionTypeRepository = transactionTypeRepository;
        this.transactionCategoryRepository = transactionCategoryRepository;
        this.cardXrefRepository = cardXrefRepository;
    }

    public PageResponse<TransactionDetail> listTransactions(String accountId, String cardNum, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "origTimestamp"));
        Page<Transaction> txnPage;

        if (cardNum != null && !cardNum.isBlank()) {
            txnPage = transactionRepository.findByCardNum(cardNum, pageable);
        } else if (accountId != null && !accountId.isBlank()) {
            // Find all cards for account via xref
            List<CardXref> xrefs = cardXrefRepository.findByAccountId(accountId);
            List<String> cardNums = xrefs.stream()
                    .map(CardXref::getCardNum)
                    .collect(Collectors.toList());
            if (cardNums.isEmpty()) {
                return new PageResponse<>(List.of(), page, size, 0, 0);
            }
            txnPage = transactionRepository.findByCardNumIn(cardNums, pageable);
        } else {
            txnPage = transactionRepository.findAll(pageable);
        }

        List<TransactionDetail> details = txnPage.getContent().stream()
                .map(this::toTransactionDetail)
                .collect(Collectors.toList());

        return new PageResponse<>(details, page, size, txnPage.getTotalElements(), txnPage.getTotalPages());
    }

    public TransactionDetail getTransaction(String tranId) {
        Transaction txn = transactionRepository.findById(tranId)
                .orElseThrow(() -> new IllegalArgumentException("Transaction not found: " + tranId));
        return toTransactionDetail(txn);
    }

    @Transactional
    public TransactionDetail addTransaction(TransactionAddRequest request) {
        // Validate mandatory fields per COBOL spec
        if (request.cardNum() == null || request.cardNum().isBlank()) {
            throw new IllegalArgumentException("Card number is required");
        }
        if (request.typeCode() == null || request.typeCode().isBlank()) {
            throw new IllegalArgumentException("Type code is required");
        }
        // Type/category must be numeric
        if (!request.typeCode().matches("\\d+")) {
            throw new IllegalArgumentException("Type code must be numeric");
        }
        if (request.categoryCode() == null || request.categoryCode().isBlank()) {
            throw new IllegalArgumentException("Category code is required");
        }
        if (!request.categoryCode().matches("\\d+")) {
            throw new IllegalArgumentException("Category code must be numeric");
        }
        if (request.source() == null || request.source().isBlank()) {
            throw new IllegalArgumentException("Source is required");
        }
        if (request.description() == null || request.description().isBlank()) {
            throw new IllegalArgumentException("Description is required");
        }
        if (request.amount() == null) {
            throw new IllegalArgumentException("Amount is required");
        }
        if (request.merchantId() == null || request.merchantId().isBlank()) {
            throw new IllegalArgumentException("Merchant ID is required");
        }
        if (request.merchantName() == null || request.merchantName().isBlank()) {
            throw new IllegalArgumentException("Merchant name is required");
        }
        if (request.merchantCity() == null || request.merchantCity().isBlank()) {
            throw new IllegalArgumentException("Merchant city is required");
        }
        if (request.merchantZip() == null || request.merchantZip().isBlank()) {
            throw new IllegalArgumentException("Merchant zip is required");
        }

        // Validate origTimestamp if provided
        String origTimestamp = request.origTimestamp();
        if (origTimestamp != null && !origTimestamp.isBlank()) {
            try {
                LocalDateTime.parse(origTimestamp, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
            } catch (Exception e) {
                throw new IllegalArgumentException("Original timestamp must be in format yyyy-MM-dd HH:mm:ss");
            }
        } else {
            origTimestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }

        // Resolve card/account via xref
        cardXrefRepository.findById(request.cardNum())
                .orElseThrow(() -> new IllegalArgumentException("Card not found in cross-reference: " + request.cardNum()));

        // Auto-generate tranId (query max + 1, padded to 16 chars)
        String tranId = generateNextTranId();

        String procTimestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

        Transaction txn = new Transaction();
        txn.setTranId(tranId);
        txn.setCardNum(request.cardNum());
        txn.setTypeCode(request.typeCode());
        txn.setCategoryCode(request.categoryCode());
        txn.setSource(request.source());
        txn.setDescription(request.description());
        txn.setAmount(request.amount());
        txn.setMerchantId(request.merchantId());
        txn.setMerchantName(request.merchantName());
        txn.setMerchantCity(request.merchantCity());
        txn.setMerchantZip(request.merchantZip());
        txn.setOrigTimestamp(origTimestamp);
        txn.setProcTimestamp(procTimestamp);

        transactionRepository.save(txn);
        return toTransactionDetail(txn);
    }

    public String generateNextTranId() {
        return transactionRepository.findTopByOrderByTranIdDesc()
                .map(t -> {
                    try {
                        long current = Long.parseLong(t.getTranId());
                        return String.format("%016d", current + 1);
                    } catch (NumberFormatException e) {
                        // If the last tranId isn't purely numeric, fall back
                        return String.format("%016d", System.currentTimeMillis());
                    }
                })
                .orElse("0000000000000001");
    }

    private TransactionDetail toTransactionDetail(Transaction txn) {
        String typeDesc = null;
        String catDesc = null;

        if (txn.getTypeCode() != null) {
            typeDesc = transactionTypeRepository.findById(txn.getTypeCode())
                    .map(TransactionType::getTypeDescription)
                    .orElse(null);
        }

        if (txn.getTypeCode() != null && txn.getCategoryCode() != null) {
            catDesc = transactionCategoryRepository
                    .findByTypeCodeAndCategoryCode(txn.getTypeCode(), txn.getCategoryCode())
                    .map(TransactionCategory::getCategoryDescription)
                    .orElse(null);
        }

        return new TransactionDetail(
                txn.getTranId(),
                txn.getCardNum(),
                txn.getTypeCode(),
                txn.getCategoryCode(),
                txn.getSource(),
                txn.getDescription(),
                txn.getAmount(),
                txn.getMerchantId(),
                txn.getMerchantName(),
                txn.getMerchantCity(),
                txn.getMerchantZip(),
                txn.getOrigTimestamp(),
                txn.getProcTimestamp(),
                typeDesc,
                catDesc
        );
    }
}
