package com.carddemo.dto;

public record CardDetail(
        String cardNum,
        String accountId,
        String cvvCode,
        String embossedName,
        String expirationDate,
        String activeStatus,
        String customerName,
        String accountStatus,
        Double currentBalance,
        Double creditLimit
) {
}
