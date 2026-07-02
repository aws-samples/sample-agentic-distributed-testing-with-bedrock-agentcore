package com.carddemo.repository;

import com.carddemo.model.TransactionCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TransactionCategoryRepository extends JpaRepository<TransactionCategory, TransactionCategory.TransactionCategoryId> {

    List<TransactionCategory> findByTypeCode(String typeCode);

    Optional<TransactionCategory> findByTypeCodeAndCategoryCode(String typeCode, String categoryCode);
}
