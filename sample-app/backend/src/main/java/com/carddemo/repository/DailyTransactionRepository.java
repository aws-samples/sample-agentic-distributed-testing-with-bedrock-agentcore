package com.carddemo.repository;

import com.carddemo.model.DailyTransaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DailyTransactionRepository extends JpaRepository<DailyTransaction, String> {
}
