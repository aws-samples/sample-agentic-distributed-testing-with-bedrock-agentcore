package com.carddemo.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "accounts")
public class Account {

    @Id
    @Column(name = "account_id")
    private String accountId;

    @Column(name = "active_status")
    private String activeStatus;

    @Column(name = "current_balance")
    private Double currentBalance;

    @Column(name = "credit_limit")
    private Double creditLimit;

    @Column(name = "cash_credit_limit")
    private Double cashCreditLimit;

    @Column(name = "open_date")
    private String openDate;

    @Column(name = "expiration_date")
    private String expirationDate;

    @Column(name = "reissue_date")
    private String reissueDate;

    @Column(name = "current_cycle_credit")
    private Double currentCycleCredit;

    @Column(name = "current_cycle_debit")
    private Double currentCycleDebit;

    @Column(name = "group_id")
    private String groupId;

    public Account() {
    }

    public String getAccountId() {
        return accountId;
    }

    public void setAccountId(String accountId) {
        this.accountId = accountId;
    }

    public String getActiveStatus() {
        return activeStatus;
    }

    public void setActiveStatus(String activeStatus) {
        this.activeStatus = activeStatus;
    }

    public Double getCurrentBalance() {
        return currentBalance;
    }

    public void setCurrentBalance(Double currentBalance) {
        this.currentBalance = currentBalance;
    }

    public Double getCreditLimit() {
        return creditLimit;
    }

    public void setCreditLimit(Double creditLimit) {
        this.creditLimit = creditLimit;
    }

    public Double getCashCreditLimit() {
        return cashCreditLimit;
    }

    public void setCashCreditLimit(Double cashCreditLimit) {
        this.cashCreditLimit = cashCreditLimit;
    }

    public String getOpenDate() {
        return openDate;
    }

    public void setOpenDate(String openDate) {
        this.openDate = openDate;
    }

    public String getExpirationDate() {
        return expirationDate;
    }

    public void setExpirationDate(String expirationDate) {
        this.expirationDate = expirationDate;
    }

    public String getReissueDate() {
        return reissueDate;
    }

    public void setReissueDate(String reissueDate) {
        this.reissueDate = reissueDate;
    }

    public Double getCurrentCycleCredit() {
        return currentCycleCredit;
    }

    public void setCurrentCycleCredit(Double currentCycleCredit) {
        this.currentCycleCredit = currentCycleCredit;
    }

    public Double getCurrentCycleDebit() {
        return currentCycleDebit;
    }

    public void setCurrentCycleDebit(Double currentCycleDebit) {
        this.currentCycleDebit = currentCycleDebit;
    }

    public String getGroupId() {
        return groupId;
    }

    public void setGroupId(String groupId) {
        this.groupId = groupId;
    }
}
