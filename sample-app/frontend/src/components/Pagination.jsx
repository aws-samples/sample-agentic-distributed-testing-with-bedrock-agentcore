import React from 'react';

export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        className="btn btn-sm"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        F7=Backward
      </button>

      <span style={{ color: '#00ccff', padding: '0 12px' }}>
        Page {page + 1} of {totalPages}
      </span>

      <button
        className="btn btn-sm"
        disabled={page >= totalPages - 1}
        onClick={() => onPageChange(page + 1)}
      >
        F8=Forward
      </button>
    </div>
  );
}
