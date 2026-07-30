import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export function DropdownMenu({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState({});

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        menuRef.current && !menuRef.current.contains(event.target) &&
        buttonRef.current && !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const isNearBottom = window.innerHeight - rect.bottom < 150;
      
      setMenuStyle({
        position: 'fixed',
        top: isNearBottom ? 'auto' : rect.bottom + 4,
        bottom: isNearBottom ? window.innerHeight - rect.top + 4 : 'auto',
        right: window.innerWidth - rect.right,
        backgroundColor: 'var(--bg-card)', 
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-md)',
        borderRadius: '6px',
        padding: '4px 0',
        minWidth: '120px',
        maxHeight: '260px',
        overflowY: 'auto',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column'
      });
    }
  }, [isOpen]);

  return (
    <>
      <button 
        ref={buttonRef}
        className="btn btn-icon" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ padding: '4px 8px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-primary)' }}
      >
        &#8942;
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="dropdown-menu" ref={menuRef} style={menuStyle}>
          {children}
        </div>,
        document.body
      )}
    </>
  );
}

export function DropdownItem({ onClick, children, danger }) {
  return (
    <button 
      onClick={onClick} 
      style={{
        padding: '8px 16px',
        background: 'none',
        border: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        fontSize: '14px',
        color: danger ? 'var(--red-text)' : 'var(--text-primary)',
        width: '100%',
      }}
      onMouseEnter={(e) => e.target.style.backgroundColor = danger ? 'var(--red-50)' : 'var(--bg-primary)'}
      onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
    >
      {children}
    </button>
  );
}
