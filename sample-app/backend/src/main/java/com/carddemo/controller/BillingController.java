package com.carddemo.controller;

import com.carddemo.service.BillingService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/billing")
public class BillingController {

    private final BillingService billingService;

    public BillingController(BillingService billingService) {
        this.billingService = billingService;
    }

    @PostMapping("/pay")
    public ResponseEntity<?> payBill(@RequestBody Map<String, String> request) {
        try {
            String accountId = request.get("accountId");
            if (accountId == null || accountId.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Account ID is required"));
            }
            Map<String, Object> result = billingService.payBill(accountId);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
