package com.carddemo.controller;

import com.carddemo.config.AuthInterceptor.UserSession;
import com.carddemo.dto.CardDetail;
import com.carddemo.model.Card;
import com.carddemo.service.CardService;
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
@RequestMapping("/api/cards")
public class CardController {

    private final CardService cardService;

    public CardController(CardService cardService) {
        this.cardService = cardService;
    }

    @GetMapping
    public ResponseEntity<?> listCards(HttpServletRequest request,
                                       @RequestParam(required = false) String accountId) {
        try {
            UserSession session = (UserSession) request.getAttribute("currentUser");
            List<Card> cards = cardService.listCards(accountId, session.userType());
            return ResponseEntity.ok(cards);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{cardNum}")
    public ResponseEntity<?> getCardDetail(@PathVariable String cardNum) {
        try {
            CardDetail detail = cardService.getCardDetail(cardNum);
            return ResponseEntity.ok(detail);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{cardNum}")
    public ResponseEntity<?> updateCard(@PathVariable String cardNum,
                                        @RequestBody Card updates) {
        try {
            Card updated = cardService.updateCard(cardNum, updates);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
