package com.carddemo.service;

import com.carddemo.config.AuthInterceptor;
import com.carddemo.config.AuthInterceptor.UserSession;
import com.carddemo.dto.LoginResponse;
import com.carddemo.model.User;
import com.carddemo.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class AuthService {

    private final UserRepository userRepository;

    public AuthService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public LoginResponse login(String userId, String password) {
        if (userId == null || password == null) {
            throw new IllegalArgumentException("User ID and password are required");
        }

        // COBOL spec: case-insensitive comparison - convert both to uppercase
        String upperUserId = userId.toUpperCase();
        String upperPassword = password.toUpperCase();

        User user = userRepository.findById(upperUserId)
                .orElseThrow(() -> new IllegalArgumentException("Invalid credentials"));

        if (!user.getPassword().toUpperCase().equals(upperPassword)) {
            throw new IllegalArgumentException("Invalid credentials");
        }

        String token = UUID.randomUUID().toString();
        UserSession session = new UserSession(user.getUserId(), user.getUserType(), user.getFirstName(), user.getLastName());
        AuthInterceptor.addSession(token, session);

        return new LoginResponse(token, user.getUserId(), user.getUserType(), user.getFirstName(), user.getLastName());
    }

    public void logout(String token) {
        if (token != null) {
            AuthInterceptor.removeSession(token);
        }
    }
}
