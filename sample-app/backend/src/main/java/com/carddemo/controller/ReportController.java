package com.carddemo.controller;

import com.carddemo.dto.ReportData;
import com.carddemo.service.ReportService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @PostMapping("/transactions")
    public ResponseEntity<?> generateTransactionReport(@RequestBody Map<String, String> request) {
        try {
            String reportType = request.get("reportType");
            String startDate = request.get("startDate");
            String endDate = request.get("endDate");

            ReportData report = reportService.generateTransactionReport(reportType, startDate, endDate);
            return ResponseEntity.ok(report);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
