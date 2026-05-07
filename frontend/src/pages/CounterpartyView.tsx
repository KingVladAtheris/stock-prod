import { useEffect, useState } from 'react';
import type { Company } from '../types';
import { getCounterpartiesUsage, updateCounterparty, deleteCounterparty } from '../api';
import type { CounterpartyUsage } from '../api';
import styles from './InventoryView.module.css';
import sumStyles from './Summary.module.css';

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

interface Props { company: Company; onBack: () => void; }

export default function CounterpartyView({ company, onBack }: Props) {
  const [items, setItems]       = useState<CounterpartyUsage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [textFilter, setFilter] = useState('');

  // Edit modal state
  const [editTarget, setEditTarget] = useState<CounterpartyUsage | null>(null);
  const [editName, setEditName]     = useState('');
  const [editTaxId, setEditTaxId]   = useState('');
  const [editError, setEditError]   = useState('');

  const load = () => {
    setLoading(true);
    getCounterpartiesUsage(company.id)
      .then(data => setItems(data.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [company.id]);

  const shown = items.filter(i =>
    !textFilter.trim() ||
    i.name.toLowerCase().includes(textFilter.toLowerCase()) ||
    i.tax_id.toLowerCase().includes(textFilter.toLowerCase())
  );

  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async (cp: CounterpartyUsage) => {
    if (cp.used_on_dates.length > 0) {
      const lines = cp.used_on_dates.map(entry => {
        const [companyName, iso] = entry.split('|');
        const [y, m, d] = iso.split('-');
        return `${companyName}: ${d}/${m}/${y}`;
      });
      setDeleteError(`"${cp.name}" este în uz:\n${lines.join('\n')}`);
      return;
    }
    setDeleteError('');
    try {
      await deleteCounterparty(cp.id);
      load();
    } catch (e: any) { setDeleteError((e as Error).message); }
  };

  const openEdit = (cp: CounterpartyUsage) => {
    setEditTarget(cp); setEditName(cp.name); setEditTaxId(cp.tax_id); setEditError('');
  };

  const handleEdit = async () => {
    if (!editTarget || !editName.trim() || !editTaxId.trim()) {
      setEditError('Toate câmpurile sunt obligatorii.'); return;
    }
    try {
      await updateCounterparty(editTarget.id, { name: editName.trim(), tax_id: editTaxId.trim() });
      setEditTarget(null); load();
    } catch (e: any) { setEditError((e as Error).message); }
  };

  return (
    <div className={sumStyles.page}>
      <header className={sumStyles.header}>
        <div className={sumStyles.headerLeft}>
          <button className={sumStyles.backBtn} onClick={onBack}>← Înapoi</button>
          <div className={sumStyles.titleBlock}>
            <span className={sumStyles.mainTitle}>Terti</span>
            <span className={sumStyles.subTitle}>{company.name}</span>
          </div>
        </div>
      </header>

      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="Filtrează terti..."
          value={textFilter}
          onChange={e => setFilter(e.target.value)}
          autoFocus
        />
        {textFilter && (
          <button className={styles.filterClear} onClick={() => setFilter('')}>×</button>
        )}
        <span className={styles.filterCount}>
          {shown.length} {shown.length === 1 ? 'tert' : 'terti'}
        </span>
      </div>

      <div className={sumStyles.tableWrap}>
        {loading && <div className={sumStyles.empty}>Se încarcă...</div>}
        {error && <div className={sumStyles.errorBar}>{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div className={sumStyles.empty}>
            {textFilter ? 'Niciun tert nu corespunde filtrului.' : 'Nu există tert.'}
          </div>
        )}
        {!loading && shown.length > 0 && (
          <table className={sumStyles.table}>
            {deleteError && (
              <div className={sumStyles.errorBar} onClick={() => setDeleteError('')} style={{ whiteSpace: 'pre-line', cursor: 'pointer' }}>
                {deleteError} <span style={{ float: 'right' }}>×</span>
              </div>
            )}
            <thead>
              <tr>
                <th className={`${sumStyles.th} ${sumStyles.left}`}>Denumire</th>
                <th className={`${sumStyles.th} ${sumStyles.left}`}>CUI</th>
                <th className={`${sumStyles.th}`} style={{ width: 80 }}/>
              </tr>
            </thead>
            <tbody>
              {shown.map(cp => {
                const inUse = cp.used_on_dates.length > 0;
                const tooltip = inUse
                  ? `Tert este în uz:\n${cp.used_on_dates.map(fmtDate).join('\n')}`
                  : '';
                return (
                  <tr key={cp.id} className={sumStyles.row}>
                    <td className={`${sumStyles.td} ${sumStyles.left} ${sumStyles.label}`}>{cp.name}</td>
                    <td className={`${sumStyles.td} ${sumStyles.left}`} style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{cp.tax_id}</td>
                    <td className={`${sumStyles.td}`}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => openEdit(cp)}
                          style={{
                            padding: '2px 10px', borderRadius: 4, border: '1px solid var(--border)',
                            background: 'var(--surface)', cursor: 'pointer', fontSize: 13,
                          }}
                        >✎</button>
                        <button
                          onClick={() => handleDelete(cp)}
                          style={{
                            padding: '2px 10px', borderRadius: 4, border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: inUse ? 'var(--muted)' : 'var(--danger, #c0392b)',
                            cursor: inUse ? 'not-allowed' : 'pointer',
                            fontSize: 13, opacity: inUse ? 0.5 : 1,
                          }}
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      {editTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={e => e.target === e.currentTarget && setEditTarget(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 10, padding: 28,
            width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 16 }}>Editează tert</h3>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Denumire</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border)', marginBottom: 12,
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CUI / Tax ID</label>
            <input
              value={editTaxId}
              onChange={e => setEditTaxId(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border)', marginBottom: 12,
                fontSize: 14, fontFamily: 'monospace', boxSizing: 'border-box',
              }}
              onKeyDown={e => e.key === 'Enter' && handleEdit()}
            />
            {editError && <p style={{ color: 'var(--danger, #c0392b)', fontSize: 13, margin: '0 0 10px' }}>{editError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditTarget(null)} style={{
                padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--surface)', cursor: 'pointer', fontSize: 14,
              }}>Anulare</button>
              <button onClick={handleEdit} style={{
                padding: '7px 16px', borderRadius: 6, border: 'none',
                background: 'var(--accent, #2563eb)', color: '#fff',
                cursor: 'pointer', fontSize: 14,
              }}>Salvează</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}