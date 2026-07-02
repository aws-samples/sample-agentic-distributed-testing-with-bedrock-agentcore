package com.carddemo.dto;

public record AccountDetail(
        String accountId,
        String activeStatus,
        Double currentBalance,
        Double creditLimit,
        Double cashCreditLimit,
        String openDate,
        String expirationDate,
        String reissueDate,
        Double currentCycleCredit,
        Double currentCycleDebit,
        String groupId,
        String customerFirstName,
        String customerLastName,
        Integer customerFicoScore
) {
}
