package com.carddemo.dto;

import java.util.List;

public record ReportData(
        String reportType,
        String startDate,
        String endDate,
        List<TransactionDetail> entries,
        double totalAmount
) {
}
