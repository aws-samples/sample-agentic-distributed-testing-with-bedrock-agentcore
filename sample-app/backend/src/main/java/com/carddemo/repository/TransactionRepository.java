package com.carddemo.repository;

import com.carddemo.model.Transaction;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TransactionRepository extends JpaRepository<Transaction, String> {

    Page<Transaction> findByCardNumIn(List<String> cardNums, Pageable pageable);

    Page<Transaction> findByCardNum(String cardNum, Pageable pageable);

    Optional<Transaction> findTopByOrderByTranIdDesc();

    @Query("SELECT t FROM Transaction t WHERE t.origTimestamp >= :startDate AND t.origTimestamp <= :endDate ORDER BY t.origTimestamp")
    List<Transaction> findByOrigTimestampBetween(@Param("startDate") String startDate, @Param("endDate") String endDate);
}
