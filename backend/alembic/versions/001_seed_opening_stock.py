"""Seed opening stock as real transactions for existing companies

Revision ID: 001_seed_opening_stock
Revises: 
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from decimal import Decimal
from datetime import date

revision = '001_seed_opening_stock'
down_revision = None  # set to your latest revision ID if you have prior migrations
branch_labels = None
depends_on = None

SELLER_NAME  = "Stoc inițial"
SELLER_TAXID = "STOC-INITIAL-0000"
PRODUCT_NAME = "Stoc inițial"
D0 = Decimal(0)


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)

    # ── 1. Ensure the synthetic counterparty exists ────────────────────────
    seller = session.execute(
        sa.text("SELECT id FROM counterparties WHERE tax_id = :tid"),
        {"tid": SELLER_TAXID}
    ).fetchone()

    if not seller:
        session.execute(
            sa.text("INSERT INTO counterparties (name, tax_id) VALUES (:name, :tid)"),
            {"name": SELLER_NAME, "tid": SELLER_TAXID}
        )
        session.flush()
        seller = session.execute(
            sa.text("SELECT id FROM counterparties WHERE tax_id = :tid"),
            {"tid": SELLER_TAXID}
        ).fetchone()

    seller_id = seller[0]

    # ── 2. Find all companies with opening stock that haven't been seeded ──
    companies = session.execute(sa.text("""
        SELECT id, opening_stock_no_vat, opening_stock_vat, opening_stock_total
        FROM companies
        WHERE opening_stock_total > 0
    """)).fetchall()

    for company_id, no_vat, vat, total in companies:
        no_vat = Decimal(str(no_vat))
        vat    = Decimal(str(vat))
        total  = Decimal(str(total))

        # Skip if a seeded transaction already exists for this company
        already = session.execute(sa.text("""
            SELECT t.id FROM transactions t
            WHERE t.company_id = :cid AND t.seller_id = :sid
            LIMIT 1
        """), {"cid": company_id, "sid": seller_id}).fetchone()

        if already:
            continue  # already seeded (idempotent)

        # ── 3. Ensure the synthetic product exists for this company ────────
        product = session.execute(sa.text("""
            SELECT id FROM products
            WHERE company_id = :cid AND lower(name) = lower(:pname)
        """), {"cid": company_id, "pname": PRODUCT_NAME}).fetchone()

        if not product:
            session.execute(sa.text("""
                INSERT INTO products (company_id, name) VALUES (:cid, :pname)
            """), {"cid": company_id, "pname": PRODUCT_NAME})
            session.flush()
            product = session.execute(sa.text("""
                SELECT id FROM products
                WHERE company_id = :cid AND lower(name) = lower(:pname)
            """), {"cid": company_id, "pname": PRODUCT_NAME}).fetchone()

        product_id = product[0]

        # ── 4. Create the transaction header (date = today) ────────────────
        session.execute(sa.text("""
            INSERT INTO transactions (company_id, date, seller_id, invoice_number, register_entry_number)
            VALUES (:cid, :d, :sid, NULL, NULL)
        """), {"cid": company_id, "d": date.today(), "sid": seller_id})
        session.flush()

        tx = session.execute(sa.text("""
            SELECT id FROM transactions
            WHERE company_id = :cid AND seller_id = :sid
            ORDER BY id DESC LIMIT 1
        """), {"cid": company_id, "sid": seller_id}).fetchone()
        tx_id = tx[0]

        # ── 5. Compute item fields ─────────────────────────────────────────
        if no_vat > D0:
            tf  = float(1 + vat / no_vat)
            rnt = total / Decimal(tf)
            rv  = total - rnt
            mu  = rnt - no_vat
        else:
            tf  = 1.0
            rnt = total
            rv  = D0
            mu  = D0

        # ── 6. Create the transaction item ─────────────────────────────────
        session.execute(sa.text("""
            INSERT INTO transaction_items
                (transaction_id, product_id,
                 purchase_no_tax, purchase_tax_amount, total_purchase,
                 tax_factor, total_resale, resale_no_tax, resale_vat, markup)
            VALUES
                (:txid, :pid,
                 :pnt, :pvat, :tp,
                 :tf, :tr, :rnt, :rv, :mu)
        """), {
            "txid": tx_id, "pid": product_id,
            "pnt": no_vat, "pvat": vat, "tp": total,
            "tf": tf, "tr": total, "rnt": rnt, "rv": rv, "mu": mu,
        })
        session.flush()

        # ── 7. Upsert inventory ────────────────────────────────────────────
        existing_inv = session.execute(sa.text("""
            SELECT id FROM inventory
            WHERE company_id = :cid AND product_id = :pid
        """), {"cid": company_id, "pid": product_id}).fetchone()

        if existing_inv:
            session.execute(sa.text("""
                UPDATE inventory
                SET stock_no_vat = stock_no_vat + :rnt,
                    stock_vat    = stock_vat    + :rv,
                    stock_total  = stock_total  + :tr
                WHERE company_id = :cid AND product_id = :pid
            """), {"rnt": rnt, "rv": rv, "tr": total, "cid": company_id, "pid": product_id})
        else:
            session.execute(sa.text("""
                INSERT INTO inventory (company_id, product_id, stock_no_vat, stock_vat, stock_total)
                VALUES (:cid, :pid, :rnt, :rv, :tr)
            """), {"cid": company_id, "pid": product_id, "rnt": rnt, "rv": rv, "tr": total})

    session.commit()


def downgrade() -> None:
    """
    Remove all seeded opening-stock transactions and their inventory impact.
    Does NOT restore the original opening_stock_* values on companies
    (they are still there in the column, untouched).
    """
    bind = op.get_bind()
    session = Session(bind=bind)

    seller = session.execute(
        sa.text("SELECT id FROM counterparties WHERE tax_id = :tid"),
        {"tid": SELLER_TAXID}
    ).fetchone()

    if not seller:
        return  # nothing to undo

    seller_id = seller[0]

    # Find all seeded transactions
    seeded_txs = session.execute(sa.text("""
        SELECT t.id, t.company_id, ti.product_id, ti.resale_no_tax, ti.resale_vat, ti.total_resale
        FROM transactions t
        JOIN transaction_items ti ON ti.transaction_id = t.id
        WHERE t.seller_id = :sid
    """), {"sid": seller_id}).fetchall()

    for tx_id, company_id, product_id, rnt, rv, tr in seeded_txs:
        rnt = Decimal(str(rnt)); rv = Decimal(str(rv)); tr = Decimal(str(tr))

        # Reverse inventory
        session.execute(sa.text("""
            UPDATE inventory
            SET stock_no_vat = stock_no_vat - :rnt,
                stock_vat    = stock_vat    - :rv,
                stock_total  = stock_total  - :tr
            WHERE company_id = :cid AND product_id = :pid
        """), {"rnt": rnt, "rv": rv, "tr": tr, "cid": company_id, "pid": product_id})

        # Delete items and transaction
        session.execute(sa.text("DELETE FROM transaction_items WHERE transaction_id = :txid"), {"txid": tx_id})
        session.execute(sa.text("DELETE FROM transactions WHERE id = :txid"), {"txid": tx_id})

    session.commit()