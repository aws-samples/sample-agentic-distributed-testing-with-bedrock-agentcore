package com.carddemo.service;

import com.carddemo.dto.ReportData;
import com.carddemo.dto.TransactionDetail;
import com.carddemo.model.Transaction;
import com.carddemo.model.TransactionCategory;
import com.carddemo.model.TransactionType;
import com.carddemo.repository.TransactionCategoryRepository;
import com.carddemo.repository.TransactionRepository;
import com.carddemo.repository.TransactionTypeRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class ReportService {

    private final TransactionRepository transactionRepository;
    private final TransactionTypeRepository transactionTypeRepository;
    private final TransactionCategoryRepository transactionCategoryRepository;

    public ReportService(TransactionRepository transactionRepository,
                         TransactionTypeRepository transactionTypeRepository,
                         TransactionCategoryRepository transactionCategoryRepository) {
        this.transactionRepository = transactionRepository;
        this.transactionTypeRepository = transactionTypeRepository;
        this.transactionCategoryRepository = transactionCategoryRepository;
    }

    public ReportData generateTransactionReport(String reportType, String startDate, String endDate) {
        String resolvedStart;
        String resolvedEnd;

        switch (reportType != null ? reportType.toUpperCase() : "CUSTOM") {
            case "MONTHLY" -> {
                // Auto-calculate 1st to last of current month
                YearMonth currentMonth = YearMonth.now();
                resolvedStart = currentMonth.atDay(1).format(DateTimeFormatter.ISO_LOCAL_DATE) + " 00:00:00";
                resolvedEnd = currentMonth.atEndOfMonth().format(DateTimeFormatter.ISO_LOCAL_DATE) + " 23:59:59";
            }
            case "YEARLY" -> {
                // Jan 1 to Dec 31 of current year
                int year = LocalDate.now().getYear();
                resolvedStart = year + "-01-01 00:00:00";
                resolvedEnd = year + "-12-31 23:59:59";
            }
            default -> {
                // Custom: use provided dates
                if (startDate == null || endDate == null) {
                    throw new IllegalArgumentException("Start date and end date are required for custom reports");
                }
                // Ensure timestamps have time component
                resolvedStart = startDate.contains(" ") ? startDate : startDate + " 00:00:00";
                resolvedEnd = endDate.contains(" ") ? endDate : endDate + " 23:59:59";
            }
        }

        List<Transaction> transactions = transactionRepository.findByOrigTimestampBetween(resolvedStart, resolvedEnd);

        List<TransactionDetail> entries = transactions.stream()
                .map(txn -> {
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
                })
                .collect(Collectors.toList());

        double totalAmount = entries.stream()
                .mapToDouble(e -> e.amount() != null ? e.amount() : 0.0)
                .sum();

        return new ReportData(
                reportType != null ? reportType.toUpperCase() : "CUSTOM",
                resolvedStart,
                resolvedEnd,
                entries,
                totalAmount
        );
    }
}
