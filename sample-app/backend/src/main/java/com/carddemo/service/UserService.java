package com.carddemo.service;

import com.carddemo.dto.PageResponse;
import com.carddemo.model.User;
import com.carddemo.repository.UserRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public PageResponse<Map<String, Object>> listUsers(int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("userId"));
        Page<User> userPage = userRepository.findAll(pageable);

        List<Map<String, Object>> content = userPage.getContent().stream()
                .map(this::stripPassword)
                .collect(Collectors.toList());

        return new PageResponse<>(content, page, size, userPage.getTotalElements(), userPage.getTotalPages());
    }

    public Map<String, Object> getUser(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
        return stripPassword(user);
    }

    @Transactional
    public Map<String, Object> addUser(User user) {
        // Validate userId non-blank
        if (user.getUserId() == null || user.getUserId().isBlank()) {
            throw new IllegalArgumentException("User ID is required");
        }
        // Validate password non-blank
        if (user.getPassword() == null || user.getPassword().isBlank()) {
            throw new IllegalArgumentException("Password is required");
        }
        // Validate firstName non-blank
        if (user.getFirstName() == null || user.getFirstName().isBlank()) {
            throw new IllegalArgumentException("First name is required");
        }
        // Validate lastName non-blank
        if (user.getLastName() == null || user.getLastName().isBlank()) {
            throw new IllegalArgumentException("Last name is required");
        }
        // Validate userType A or U
        if (user.getUserType() == null || (!"A".equals(user.getUserType()) && !"U".equals(user.getUserType()))) {
            throw new IllegalArgumentException("User type must be 'A' or 'U'");
        }
        // Check duplicate
        if (userRepository.existsById(user.getUserId())) {
            throw new IllegalArgumentException("User already exists: " + user.getUserId());
        }

        User saved = userRepository.save(user);
        return stripPassword(saved);
    }

    @Transactional
    public Map<String, Object> updateUser(String userId, User updates) {
        User existing = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));

        boolean changed = false;

        if (updates.getPassword() != null && !updates.getPassword().isBlank()) {
            if (!updates.getPassword().equals(existing.getPassword())) {
                existing.setPassword(updates.getPassword());
                changed = true;
            }
        }

        if (updates.getFirstName() != null) {
            if (updates.getFirstName().isBlank()) {
                throw new IllegalArgumentException("First name cannot be blank");
            }
            if (!updates.getFirstName().equals(existing.getFirstName())) {
                existing.setFirstName(updates.getFirstName());
                changed = true;
            }
        }

        if (updates.getLastName() != null) {
            if (updates.getLastName().isBlank()) {
                throw new IllegalArgumentException("Last name cannot be blank");
            }
            if (!updates.getLastName().equals(existing.getLastName())) {
                existing.setLastName(updates.getLastName());
                changed = true;
            }
        }

        if (updates.getUserType() != null) {
            if (!"A".equals(updates.getUserType()) && !"U".equals(updates.getUserType())) {
                throw new IllegalArgumentException("User type must be 'A' or 'U'");
            }
            if (!updates.getUserType().equals(existing.getUserType())) {
                existing.setUserType(updates.getUserType());
                changed = true;
            }
        }

        if (!changed) {
            throw new IllegalArgumentException("No changes detected");
        }

        User saved = userRepository.save(existing);
        return stripPassword(saved);
    }

    @Transactional
    public void deleteUser(String userId) {
        if (!userRepository.existsById(userId)) {
            throw new IllegalArgumentException("User not found: " + userId);
        }
        // Hard delete per COBOL spec
        userRepository.deleteById(userId);
    }

    private Map<String, Object> stripPassword(User user) {
        Map<String, Object> map = new HashMap<>();
        map.put("userId", user.getUserId());
        map.put("firstName", user.getFirstName());
        map.put("lastName", user.getLastName());
        map.put("userType", user.getUserType());
        return map;
    }
}
