package com.carddemo.controller;

import com.carddemo.config.AuthInterceptor.UserSession;
import com.carddemo.dto.AccountDetail;
import com.carddemo.model.Account;
import com.carddemo.service.AccountService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final AccountService accountService;

    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    @GetMapping
    public ResponseEntity<?> listAccounts(HttpServletRequest request,
                                          @RequestParam(required = false) String accountId) {
        try {
            UserSession session = (UserSession) request.getAttribute("currentUser");

            if (accountId != null && !accountId.isBlank()) {
                // Search by accountId
                Account account = accountService.getAccount(accountId);
                return ResponseEntity.ok(List.of(account));
            }

            List<Account> accounts = accountService.getAccountsForUser(session.userId(), session.userType());
            return ResponseEntity.ok(accounts);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getAccountDetail(@PathVariable String id) {
        try {
            AccountDetail detail = accountService.getAccountDetail(id);
            return ResponseEntity.ok(detail);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateAccount(@PathVariable String id,
                                           @RequestBody Account updates,
                                           HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            Account updated = accountService.updateAccount(id, updates);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
