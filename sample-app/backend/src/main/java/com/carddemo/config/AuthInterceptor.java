package com.carddemo.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.concurrent.ConcurrentHashMap;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private static final ConcurrentHashMap<String, UserSession> activeSessions = new ConcurrentHashMap<>();

    public record UserSession(String userId, String userType, String firstName, String lastName) {
    }

    public static void addSession(String token, UserSession session) {
        activeSessions.put(token, session);
    }

    public static void removeSession(String token) {
        activeSessions.remove(token);
    }

    public static UserSession getSession(String token) {
        return activeSessions.get(token);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // Allow preflight CORS requests
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        // Allow login endpoint without auth
        String path = request.getRequestURI();
        String method = request.getMethod();
        if ("POST".equalsIgnoreCase(method) && "/api/auth/login".equals(path)) {
            return true;
        }

        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Missing or invalid Authorization header\"}");
            return false;
        }

        String token = authHeader.substring(7);
        UserSession session = activeSessions.get(token);
        if (session == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Invalid or expired token\"}");
            return false;
        }

        request.setAttribute("currentUser", session);
        return true;
    }
}
