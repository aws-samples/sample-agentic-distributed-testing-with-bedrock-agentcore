package com.carddemo.controller;

import com.carddemo.config.AuthInterceptor.UserSession;
import com.carddemo.dto.PageResponse;
import com.carddemo.model.User;
import com.carddemo.service.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<?> listUsers(HttpServletRequest request,
                                       @RequestParam(defaultValue = "0") int page,
                                       @RequestParam(defaultValue = "10") int size) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        PageResponse<Map<String, Object>> response = userService.listUsers(page, size);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getUser(@PathVariable String id, HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            Map<String, Object> user = userService.getUser(id);
            return ResponseEntity.ok(user);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping
    public ResponseEntity<?> addUser(@RequestBody User user, HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            Map<String, Object> created = userService.addUser(user);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateUser(@PathVariable String id,
                                        @RequestBody User updates,
                                        HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            Map<String, Object> updated = userService.updateUser(id, updates);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteUser(@PathVariable String id, HttpServletRequest request) {
        UserSession session = (UserSession) request.getAttribute("currentUser");
        if (!"A".equals(session.userType())) {
            return ResponseEntity.status(403).body(Map.of("error", "Admin access required"));
        }

        try {
            userService.deleteUser(id);
            return ResponseEntity.ok(Map.of("message", "User deleted successfully"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        }
    }
}
