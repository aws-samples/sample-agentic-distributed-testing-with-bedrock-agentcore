package com.carddemo.controller;

import com.carddemo.config.AuthInterceptor.UserSession;
import com.carddemo.dto.BatchResult;
import com.carddemo.service.BatchService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;

@RestController
@RequestMapping("/api/batch")
public class BatchController {

    private final BatchService batchService;

    public BatchController(BatchService batchService) {
        this.batchService = batchService;
    }

    @PostMapping("/post-transactions")
    public ResponseEntity<?> postTransactions(HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            BatchResult result = batchService.postTransactions();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/calculate-interest")
    public ResponseEntity<?> calculateInterest(HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            Map<String, Object> summary = batchService.calculateInterest();
            return ResponseEntity.ok(summary);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
