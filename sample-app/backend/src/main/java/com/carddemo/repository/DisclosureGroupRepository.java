package com.carddemo.repository;

import com.carddemo.model.DisclosureGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DisclosureGroupRepository extends JpaRepository<DisclosureGroup, DisclosureGroup.DisclosureGroupId> {

    List<DisclosureGroup> findByGroupId(String groupId);

    Optional<DisclosureGroup> findByGroupIdAndTypeCodeAndCategoryCode(String groupId, String typeCode, String categoryCode);
}
