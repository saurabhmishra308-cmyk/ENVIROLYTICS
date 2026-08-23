import pandas as pd
import io
from datetime import datetime
from typing import List, Dict, Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT

class DataExportService:
    """Service for exporting data to CSV and PDF formats."""
    
    @staticmethod
    def to_csv(data: List[Dict], filename: str = "export.csv") -> bytes:
        """Convert data to CSV format."""
        df = pd.DataFrame(data)
        
        # Format datetime columns
        for col in df.columns:
            if 'timestamp' in col.lower() or 'date' in col.lower():
                df[col] = pd.to_datetime(df[col], format='mixed', errors='coerce', utc=True).dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Convert to CSV bytes
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        return csv_buffer.getvalue().encode('utf-8')
    
    @staticmethod
    def to_pdf(data: List[Dict], title: str, filename: str = "export.pdf") -> bytes:
        """Convert data to PDF format with table."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        elements = []
        styles = getSampleStyleSheet()
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            textColor=colors.HexColor('#1a2332'),
            spaceAfter=20,
            alignment=TA_CENTER
        )
        elements.append(Paragraph(title, title_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Company header
        header_style = ParagraphStyle(
            'Header',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors.HexColor('#4a9fd8'),
            spaceAfter=10,
            alignment=TA_CENTER
        )
        elements.append(Paragraph("Envirolytics Sustainability Private Limited", header_style))
        elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", header_style))
        elements.append(Spacer(1, 0.3*inch))
        
        if data:
            df = pd.DataFrame(data)
            
            # Format data
            for col in df.columns:
                if 'timestamp' in col.lower() or 'date' in col.lower():
                    df[col] = pd.to_datetime(df[col], format='mixed', errors='coerce', utc=True).dt.strftime('%Y-%m-%d %H:%M')
                elif df[col].dtype in ['float64', 'float32']:
                    df[col] = df[col].round(2)
            
            # Prepare table data
            table_data = [df.columns.tolist()] + df.values.tolist()
            
            # Create table
            table = Table(table_data, repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a9fd8')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
            ]))
            elements.append(table)
        else:
            elements.append(Paragraph("No data available", styles['Normal']))
        
        doc.build(elements)
        return buffer.getvalue()

class ExcelImportService:
    """Service for importing data from Excel/CSV files."""

    @staticmethod
    def parse_file(file_content: bytes, filename: str) -> List[Dict]:
        """Parse Excel (.xlsx/.xls) or CSV (.csv) file → list of dicts.

        CSV files are parsed with `pandas.read_csv`; Excel via `pandas.read_excel`.
        The `filename` extension decides which parser is used.
        """
        name = (filename or "").lower()
        buf = io.BytesIO(file_content)
        if name.endswith(".csv"):
            df = pd.read_csv(buf)
        elif name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(buf)
        else:
            raise ValueError("Unsupported file type. Use .csv, .xlsx or .xls")
        df = df.where(pd.notnull(df), None)
        # Strip whitespace from column names to be forgiving
        df.columns = [str(c).strip() for c in df.columns]
        return df.to_dict("records")

    @staticmethod
    def parse_excel(file_content: bytes) -> List[Dict]:
        """Parse Excel file and return list of dictionaries. (Legacy signature — CSV
        callers should use parse_file which sniffs the extension.)"""
        df = pd.read_excel(io.BytesIO(file_content))

        # Convert NaN to None
        df = df.where(pd.notnull(df), None)

        # Convert to list of dicts
        return df.to_dict('records')

    @staticmethod
    def _normalize_ts(v):
        if v is None or v == "":
            return None
        try:
            ts = pd.to_datetime(v, errors="coerce", utc=True)
            if pd.isna(ts):
                return None
            return ts.isoformat()
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def validate_flowmeter_data(data: List[Dict]) -> tuple[List[Dict], List[str]]:
        """Validate imported flowmeter rows.

        Required columns: hardware_id, timestamp, and ONE of
          - flow_rate_m3h   (canonical unit — preferred)
          - flow_rate_lpm   (legacy — L/M)
          - flow_rate_lph   (legacy — L/H)
        Preferred totaliser columns (new minimal template):
          - totaliser_start_reading   (m³ at start of period)
          - totaliser_end_reading     (m³ at end of period — cumulative)
        Legacy totaliser columns are still accepted for backward compat:
          - forward_totalizer, initial_forward_totalizer,
            final_forward_totalizer, tot1..2, rtot1..2, reverse_totalizer.
        Optional: temperature, unit_name, unit_code, signal_strength,
                  imei, imsi, firmware_version.

        DAILY BOOKKEEPING RULE — today's `totaliser_start_reading` must
        equal yesterday's `totaliser_end_reading` for the same
        hardware_id. If the CSV leaves `totaliser_start_reading` blank
        we auto-derive it from the previous row (same hardware_id,
        immediately-earlier timestamp) inside the same file. If the
        blank is on the very first row for that device, the API layer
        (`api_admin.import_data`) fills the gap from the latest
        historical DB reading.

        Missing optional numerics default to 0. Whatever flow unit the CSV
        supplies is coerced into all three canonical fields at write time.
        """
        valid_data: List[Dict] = []
        errors: List[str] = []
        flow_cols = ("flow_rate_m3h", "flow_rate_lpm", "flow_rate_lph")

        # ----- Column name aliases (new template → internal fields) -----
        def _pick(row: Dict, *names):
            for n in names:
                if row.get(n) not in (None, ""):
                    return row[n]
            return None

        for idx, row in enumerate(data, start=2):  # spreadsheet rows start at 2 (header = row 1)
            for base in ("hardware_id", "timestamp"):
                if row.get(base) in (None, ""):
                    errors.append(f"Row {idx}: missing required column '{base}'")
                    row["_bad"] = True
                    break
            if row.get("_bad"):
                continue
            if not any(row.get(c) not in (None, "") for c in flow_cols):
                errors.append(f"Row {idx}: must supply one of {flow_cols}")
                continue
            ts = ExcelImportService._normalize_ts(row.get("timestamp"))
            if not ts:
                errors.append(f"Row {idx}: invalid timestamp '{row.get('timestamp')}'")
                continue
            row["timestamp"] = ts
            try:
                # Parse whichever flow columns are present
                for c in flow_cols:
                    if row.get(c) not in (None, ""):
                        row[c] = float(row[c])
                # Derive the two missing flow columns from the one that was
                # supplied. m³/h is the source of truth.
                if row.get("flow_rate_m3h") is not None:
                    m3h = float(row["flow_rate_m3h"])
                elif row.get("flow_rate_lph") is not None:
                    m3h = float(row["flow_rate_lph"]) / 1000.0
                else:
                    m3h = float(row["flow_rate_lpm"]) * 0.06  # L/M → m³/h
                row["flow_rate_m3h"] = round(m3h, 4)
                row["flow_rate_lph"] = round(m3h * 1000.0, 4)
                row["flow_rate_lpm"] = round(row["flow_rate_lph"] / 60.0, 4)

                # ----- Totaliser start / end reading normalization -----
                # New template column names take precedence, legacy
                # column names are accepted as fallback.
                start_raw = _pick(row, "totaliser_start_reading", "initial_forward_totalizer")
                end_raw = _pick(row, "totaliser_end_reading", "final_forward_totalizer", "forward_totalizer")

                start_val = float(start_raw) if start_raw not in (None, "") else None
                end_val = float(end_raw) if end_raw not in (None, "") else None

                # Persist the canonical names the reports UI already knows.
                if start_val is not None:
                    row["initial_forward_totalizer"] = round(start_val, 4)
                    row["totaliser_start_reading"] = round(start_val, 4)
                else:
                    # Mark for later back-fill from previous row / DB.
                    row.pop("initial_forward_totalizer", None)
                    row.pop("totaliser_start_reading", None)

                if end_val is not None:
                    row["forward_totalizer"] = round(end_val, 4)
                    row["final_forward_totalizer"] = round(end_val, 4)
                    row["totaliser_end_reading"] = round(end_val, 4)
                else:
                    # No end reading is an error — start alone is useless.
                    row["forward_totalizer"] = 0.0

                # Fill remaining optional numerics with 0 if missing.
                for col in ("tot1", "tot2", "rtot1", "rtot2",
                            "reverse_totalizer", "temperature", "signal_strength"):
                    if row.get(col) not in (None, ""):
                        row[col] = float(row[col])
                    else:
                        row[col] = 0.0 if col != "signal_strength" else 0
            except (ValueError, TypeError) as e:
                errors.append(f"Row {idx}: invalid numeric value — {e}")
                continue
            row.setdefault("unit_code", 6)      # M3/H
            row.setdefault("unit_name", "m3/h")
            row["canonical_unit"] = "m3/h"
            row["hardware_id"] = str(row["hardware_id"]).strip()
            valid_data.append(row)

        # ----- Back-fill blank totaliser_start_reading from prior row -----
        # Sort in-file rows per device by timestamp; each row's start
        # equals the previous row's end. Rows still blank after this pass
        # are handled by api_admin.import_data via a DB lookup.
        by_hw: Dict[str, List[Dict]] = {}
        for r in valid_data:
            by_hw.setdefault(r["hardware_id"], []).append(r)
        for hw, rows in by_hw.items():
            rows.sort(key=lambda x: str(x.get("timestamp") or ""))
            prev_end = None
            for r in rows:
                if r.get("initial_forward_totalizer") is None and prev_end is not None:
                    r["initial_forward_totalizer"] = prev_end
                    r["totaliser_start_reading"] = prev_end
                cur_end = r.get("final_forward_totalizer")
                if cur_end is None:
                    cur_end = r.get("forward_totalizer")
                if cur_end is not None:
                    prev_end = cur_end

        return valid_data, errors

    @staticmethod
    def validate_dwlr_data(data: List[Dict]) -> tuple[List[Dict], List[str]]:
        """Validate imported DWLR rows.

        Required columns: hardware_id, timestamp, level_mwc.
        Optional: signal (dBm), imei.
        """
        valid_data: List[Dict] = []
        errors: List[str] = []
        for idx, row in enumerate(data, start=2):
            missing = [f for f in ("hardware_id", "timestamp", "level_mwc")
                       if row.get(f) in (None, "")]
            if missing:
                errors.append(f"Row {idx}: missing required column(s) {missing}")
                continue
            ts = ExcelImportService._normalize_ts(row.get("timestamp"))
            if not ts:
                errors.append(f"Row {idx}: invalid timestamp '{row.get('timestamp')}'")
                continue
            try:
                level = float(row["level_mwc"])
            except (ValueError, TypeError):
                errors.append(f"Row {idx}: level_mwc must be numeric (mWC)")
                continue
            values = {"LEVEL": level}
            if row.get("signal") not in (None, ""):
                try:
                    values["SIGNAL"] = int(float(row["signal"]))
                except (ValueError, TypeError):
                    pass
            imei = str(row.get("imei") or "").strip() or None
            valid_data.append({
                "hardware_id": str(row["hardware_id"]).strip(),
                "instrument_type": "dwlr",
                "timestamp": ts,
                "values": values,
                "imei": imei,
            })
        return valid_data, errors

    # --- CSV template builders ---------------------------------------
    @staticmethod
    def flowmeter_template_csv() -> bytes:
        """Sample CSV template with the minimal columns admins fill by hand.

        Two example rows are included to illustrate the daily rule:
        each day's `totaliser_start_reading` MUST equal the previous
        day's `totaliser_end_reading` for the same device. If left
        blank on import the value is auto-derived from the previous
        row (either in this same file, or the latest historical reading
        already stored for that hardware_id).
        """
        cols = [
            "hardware_id",
            "timestamp",
            "flow_rate_m3h",
            "totaliser_start_reading",   # m³, cumulative at start of period
            "totaliser_end_reading",     # m³, cumulative at end of period
            "signal_strength",
            "unit_name",
            "firmware_version",
        ]
        samples = [
            # Day 1 — first row, admin fills the very first opening
            # reading manually. Start = end at t0 if unknown.
            {
                "hardware_id": "FM_PLANT_A_01",
                "timestamp": "2026-07-01 09:00:00",
                "flow_rate_m3h": "2.4582",
                "totaliser_start_reading": "1250.75",
                "totaliser_end_reading": "1309.75",
                "signal_strength": "13",
                "unit_name": "m3/h",
                "firmware_version": "4G-1",
            },
            # Day 2 — start MUST equal previous day's end (1309.75).
            {
                "hardware_id": "FM_PLANT_A_01",
                "timestamp": "2026-07-02 09:00:00",
                "flow_rate_m3h": "2.6117",
                "totaliser_start_reading": "1309.75",
                "totaliser_end_reading": "1372.43",
                "signal_strength": "13",
                "unit_name": "m3/h",
                "firmware_version": "4G-1",
            },
        ]
        buf = io.StringIO()
        pd.DataFrame(samples, columns=cols).to_csv(buf, index=False)
        return buf.getvalue().encode("utf-8")

    @staticmethod
    def dwlr_template_csv() -> bytes:
        cols = ["hardware_id", "timestamp", "level_mwc", "signal", "imei"]
        sample = ["DWLR_BOREWELL_01", "2026-07-01 09:00:00", "12.45", "13", "860738070478155"]
        buf = io.StringIO()
        w = pd.DataFrame([dict(zip(cols, sample))], columns=cols)
        w.to_csv(buf, index=False)
        return buf.getvalue().encode("utf-8")
