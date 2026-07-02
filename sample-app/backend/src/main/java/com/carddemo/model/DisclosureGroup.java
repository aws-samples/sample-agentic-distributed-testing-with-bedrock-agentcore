package com.carddemo.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;

@Entity
@Table(name = "disclosure_groups")
@IdClass(DisclosureGroup.DisclosureGroupId.class)
public class DisclosureGroup {

    @Id
    @Column(name = "group_id")
    private String groupId;

    @Id
    @Column(name = "type_code")
    private String typeCode;

    @Id
    @Column(name = "category_code")
    private String categoryCode;

    @Column(name = "interest_rate")
    private Double interestRate;

    public DisclosureGroup() {
    }

    public String getGroupId() {
        return groupId;
    }

    public void setGroupId(String groupId) {
        this.groupId = groupId;
    }

    public String getTypeCode() {
        return typeCode;
    }

    public void setTypeCode(String typeCode) {
        this.typeCode = typeCode;
    }

    public String getCategoryCode() {
        return categoryCode;
    }

    public void setCategoryCode(String categoryCode) {
        this.categoryCode = categoryCode;
    }

    public Double getInterestRate() {
        return interestRate;
    }

    public void setInterestRate(Double interestRate) {
        this.interestRate = interestRate;
    }

    public static class DisclosureGroupId implements Serializable {

        private String groupId;
        private String typeCode;
        private String categoryCode;

        public DisclosureGroupId() {
        }

        public DisclosureGroupId(String groupId, String typeCode, String categoryCode) {
            this.groupId = groupId;
            this.typeCode = typeCode;
            this.categoryCode = categoryCode;
        }

        public String getGroupId() {
            return groupId;
        }

        public void setGroupId(String groupId) {
            this.groupId = groupId;
        }

        public String getTypeCode() {
            return typeCode;
        }

        public void setTypeCode(String typeCode) {
            this.typeCode = typeCode;
        }

        public String getCategoryCode() {
            return categoryCode;
        }

        public void setCategoryCode(String categoryCode) {
            this.categoryCode = categoryCode;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            DisclosureGroupId that = (DisclosureGroupId) o;
            return Objects.equals(groupId, that.groupId)
                    && Objects.equals(typeCode, that.typeCode)
                    && Objects.equals(categoryCode, that.categoryCode);
        }

        @Override
        public int hashCode() {
            return Objects.hash(groupId, typeCode, categoryCode);
        }
    }
}
