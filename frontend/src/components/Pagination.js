import React from 'react';

export default function Pagination({ currentPage, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange }) {
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  if (totalItems === 0) return null;

  return (
    <div className="pagination-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
        <span>
          Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
        </span>
        <select 
          value={itemsPerPage} 
          onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          style={{ padding: '2px 6px', border: '1px solid var(--border-primary)', borderRadius: '4px', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer' }}
        >
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={500}>500 / page</option>
          <option value={9999999}>All</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button 
          className="btn btn-sm" 
          disabled={currentPage === 1} 
          onClick={() => onPageChange(currentPage - 1)}
          style={{ padding: '4px 10px', backgroundColor: currentPage === 1 ? 'transparent' : 'var(--gray-100)', color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)', cursor: currentPage === 1 ? 'default' : 'pointer' }}
        >
          Prev
        </button>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '13px', fontWeight: 500 }}>
          Page {currentPage} of {totalPages}
        </div>
        <button 
          className="btn btn-sm" 
          disabled={currentPage === totalPages} 
          onClick={() => onPageChange(currentPage + 1)}
          style={{ padding: '4px 10px', backgroundColor: currentPage === totalPages ? 'transparent' : 'var(--gray-100)', color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)', cursor: currentPage === totalPages ? 'default' : 'pointer' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
