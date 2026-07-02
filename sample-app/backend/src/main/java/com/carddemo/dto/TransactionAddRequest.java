package com.carddemo.dto;

public record TransactionAddRequest(
        String cardNum,
        String typeCode,
        String categoryCode,
        String source,
        String description,
        Double amount,
        String merchantId,
        String merchantName,
        String merchantCity,
        String merchantZip,
        String origTimestamp
) {
}
